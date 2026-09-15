/**
 * Capability tokens and the transport fence for the dsh-android web routes.
 *
 * Ported from dsh-ios stream-routes.ts with the same security posture:
 * - HMAC-SHA256 capabilities `base64url(payload).base64url(mac)`, signed with
 *   a 32-byte per-DSH-home key (`<DSH_HOME>/cache/dsh-android/
 *   stream-access.key`, 0600, created atomically); tokens expire within 10
 *   minutes.
 * - Every route also applies the loopback/trusted transport fence (peer
 *   address, loopback Host, Fetch-Metadata/Origin) BEFORE any capability is
 *   consulted — Host/Origin are caller-controlled data, so a LAN client
 *   cannot spoof localhost and a DNS-rebinding Host is rejected.
 * - The screenshot route serves exactly one directory, walked with lstat
 *   (no symlinks) and finished with a realpath containment check.
 * @module @zseven-w/dsh-android/stream-access
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SERIAL_PATTERN } from './adb.js'

/** Hard capability lifetime (tokens expire within 10 minutes). */
export const TOKEN_TTL_MS = 10 * 60 * 1000

/**
 * Hosts this deployment deliberately serves, in the `host` or `host:port` form
 * of an HTTP authority; the port-less form matches any port.
 *
 * Why this exists. The fence below refuses anything whose peer is not loopback,
 * because a client on the LAN can reach the dsh Web port directly and claim
 * `Host: localhost` — the peer address is the only part of a request a remote
 * caller cannot write, so it decides. That reasoning holds when the peer IS the
 * browser. Behind a reverse proxy it is not: the last hop is made by a process
 * on this machine, so the peer is genuinely loopback while the Host the proxy
 * forwards is the deployment's public name, and every route answers 403. The
 * plugin then works only through an SSH tunnel, and not behind the deployment
 * shape DSH documents for itself: DSH's own `--trusted-host` values are the twin
 * of this list, and its webserver consults them for exactly this reason.
 *
 * Listing an authority here is the operator stating: requests arriving under
 * this name have passed whatever authentication this deployment put in front of
 * it. Two properties are load-bearing:
 *
 * - The peer-address check still applies first, so a LAN client on the web port
 *   is refused however it writes its Host header, and a forged
 *   `X-Forwarded-Host` cannot invent an entry that is not on this list.
 * - The default is empty, which keeps the shipped behaviour byte-for-byte.
 */
export type AndroidTrustConfig = {
  /** Extra request authorities accepted in addition to a loopback Host. */
  trustedAuthorities?: readonly string[]
}

/** One configured entry, pre-split so no call site has to parse it twice.
 *
 * `authority` is what a `Host` header may say (`host[:port]`), `origin` is what
 * an `Origin` header may say (`scheme://host[:port]`), and both always carry a
 * port — a written one, or the scheme's default. An `Origin` is an origin, and
 * an origin includes its port: another application on the same hostname but a
 * different port is a different origin, browsers treat it as `same-site` rather
 * than `cross-site`, and a state-changing POST from it would execute.
 */
type MintedAuthority = { authority: string; origin: string; hostname: string; portless: boolean; authoredScheme: boolean }

let trustedAuthorities: readonly MintedAuthority[] = []

/** The port written at the end of an authority, if one is written at all. */
function writtenPort(value: string): string | undefined {
  // A scheme's colon is not a port separator, so the search starts after it.
  const scheme = value.indexOf('://')
  const from = scheme === -1 ? 0 : scheme + 3
  const separator = value.lastIndexOf(':')
  if (separator < from) return undefined
  // A bracketed IPv6 literal keeps its colons inside the brackets, so only a
  // colon AFTER the closing bracket can be a port.
  const bracket = value.indexOf(']')
  if (value.startsWith('[') && bracket !== -1 && separator < bracket) return undefined
  const port = value.slice(separator + 1)
  return port === '' ? undefined : port
}

/**
 * Normalize one operator entry to an authority plus the origin it stands for,
 * or nothing.
 *
 * A written port survives even when it is the scheme's default, because the
 * operator wrote it and the check should honour that; a port that is absent
 * becomes the scheme's default, because `Origin` always carries one.
 */
function normalizeAuthorityEntry(entry: string): MintedAuthority | undefined {
  const trimmed = entry.trim()
  if (trimmed === '') return undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // A pasted origin is the normal way to fill this in, so accept it — but only
    // when the URL is nothing BUT an origin, and without a path or credentials.
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
      if (parsed.hostname === '' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return undefined
      // The canonical URL drops a default port, so the written one is read from
      // the input: `https://host:443` means 443, and the operator wrote it.
      const port = writtenPort(trimmed) ?? parsed.port
      const scheme = parsed.protocol.slice(0, -1)
      // Built from the hostname, not from `parsed.host`: a URL with no port at
      // all would otherwise carry its scheme into the authority.
      const host = parsed.hostname.toLowerCase()
      const authority = port === '' ? host : `${host}:${port}`
      return { authority, origin: `${scheme}://${authority}`, hostname: host, portless: false, authoredScheme: true }
    } catch {
      return undefined
    }
  }
  // A scheme belongs to the branch above; one here means the value carries
  // something this form cannot, so it is refused rather than parsed as a path.
  if (trimmed.includes('://')) return undefined
  // Reuse the request side's parser so both sides agree on what a bare
  // authority is: a path, query, fragment, or userinfo disqualifies it.
  const parsed = parseAuthority(trimmed)
  if (parsed === undefined) return undefined
  const hostname = parsed.hostname.toLowerCase()
  const port = writtenPort(trimmed) ?? parsed.port
  if (hostname === '') return undefined
  if (port === '') {
    // No port is not "any port": the origin check needs one, and both schemes'
    // defaults are what an operator writing a bare host means. Record the pair
    // so a request may match either, which is what makes a plain `dsh.example.com`
    // work for both http and https deployments.
    return { authority: hostname, origin: '', hostname, portless: true, authoredScheme: false }
  }
  const authority = `${hostname}:${port}`
  return { authority, origin: `http://${authority}`, hostname, portless: false, authoredScheme: false }
}

/**
 * Reduce operator input to sorted, de-duplicated authorities, discarding
 * anything that is not one. Exported because the shape is worth pinning in a
 * test of its own: these entries are written by hand in a YAML patch file, and
 * a typo that silently mints nothing looks exactly like an empty list.
 */
export function mintTrustedAuthorities(entries: readonly string[] | undefined): readonly MintedAuthority[] {
  if (entries === undefined) return []
  const minted = new Map<string, MintedAuthority>()
  for (const entry of entries) {
    if (typeof entry !== 'string') continue
    const mintedEntry = normalizeAuthorityEntry(entry)
    if (mintedEntry === undefined || mintedEntry.authority === '') continue
    minted.set(mintedEntry.authority, mintedEntry)
  }
  return [...minted.values()].sort((left, right) => (left.authority < right.authority ? -1 : 1))
}

/**
 * Install the operator's trusted-authority list. Called by the plugin before it
 * mounts its routes; empty, or never called, leaves the fence exactly as
 * shipped.
 */
export function configureTrustedAuthorities(config: AndroidTrustConfig | undefined): void {
  trustedAuthorities = mintTrustedAuthorities(config?.trustedAuthorities)
}

/**
 * The entry a request's Host header names, or undefined. Compared by hostname
 * rather than by slicing on ':', which would cut an IPv6 literal in half.
 */
function trustedEntryForHost(authority: URL): MintedAuthority | undefined {
  const host = authority.host.toLowerCase()
  const hostname = authority.hostname.toLowerCase()
  for (const entry of trustedAuthorities) {
    if (entry.authority === host) return entry
    if (entry.portless && entry.hostname === hostname) return entry
  }
  return undefined
}

/**
 * Whether the browser's Origin is the origin the matched entry stands for, or
 * one of the two the pair of a port-less entry stands for (`''` records the
 * pair). The port is compared as part of it: an origin is scheme, host AND
 * port, so accepting any port on a trusted hostname would let any application
 * on that host issue state-changing requests to these routes.
 */
function matchesTrustedOrigin(entry: MintedAuthority, origin: URL): boolean {
  if (entry.portless) {
    // A bare host stands for that host on either scheme's DEFAULT port, so the
    // port has to be the default for the scheme the Origin states.
    const defaultPort = origin.protocol === 'https:' ? '443' : '80'
    return (origin.protocol === 'http:' || origin.protocol === 'https:')
      && origin.hostname.toLowerCase() === entry.hostname
      && (origin.port === '' || origin.port === defaultPort)
  }
  // A written scheme pins it. A bare authority carries no scheme, so what it can
  // honestly stand for is `http://` — the scheme the request side parses every
  // bare authority under — while an `https` origin is listed as a pasted origin
  // if that is what the deployment serves. A bare HOST (no port at all) is the
  // portable entry: it takes either scheme on that scheme's default port.
  return entry.origin === `${origin.protocol.slice(0, -1)}://${origin.host.toLowerCase()}`
}

/**
 * Whether the Origin names the same origin as the Host it arrived with. Used
 * when the Host is a loopback authority, which is a specific origin — scheme
 * aside, because the arriving request's scheme is not in either header.
 */
function hostMatchesOrigin(authority: URL, origin: URL): boolean {
  const authorityPort = authority.port === '' ? (origin.protocol === 'https:' ? '443' : '80') : authority.port
  const originPort = origin.port === '' ? (origin.protocol === 'https:' ? '443' : '80') : origin.port
  return authority.hostname.toLowerCase() === origin.hostname.toLowerCase() && authorityPort === originPort
}

const KEY_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const MAX_TOKEN_LENGTH = 16 * 1024
/** Signing may run ahead of verification by this much before the TTL cap trips. */
const CLOCK_SKEW_MS = 60 * 1000
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024

export interface StreamTokenPayload {
  v: 1
  kind: 'android-stream'
  serial: string
  exp: number
}

export interface ScreenshotTokenPayload {
  v: 1
  kind: 'android-screenshot'
  path: string
  exp: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStreamPayload(value: unknown): StreamTokenPayload | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.v !== 1
    || value.kind !== 'android-stream'
    || typeof value.serial !== 'string'
    || !SERIAL_PATTERN.test(value.serial)
    || typeof value.exp !== 'number'
    || !Number.isSafeInteger(value.exp)
  ) return undefined
  return { v: 1, kind: 'android-stream', serial: value.serial, exp: value.exp }
}

function parseScreenshotPayload(value: unknown): ScreenshotTokenPayload | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.v !== 1
    || value.kind !== 'android-screenshot'
    || typeof value.path !== 'string'
    || !isAbsolute(value.path)
    || typeof value.exp !== 'number'
    || !Number.isSafeInteger(value.exp)
  ) return undefined
  return { v: 1, kind: 'android-screenshot', path: value.path, exp: value.exp }
}

function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  return env === undefined || env.length === 0 ? join(homedir(), '.dsh') : resolve(env)
}

/** Plugin-managed state root (mirrors the dsh-ios convention). */
export function stateRoot(): string {
  return join(dshHome(), 'cache', 'dsh-android')
}

/**
 * Screenshot cache: the only directory the screenshot route will serve.
 * Shared with the tools' capture store so every android_screenshot output
 * can be granted a capability without further configuration.
 */
export function screenshotDir(): string {
  return join(tmpdir(), 'dsh-android', 'screenshots')
}

function mac(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload).digest()
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

async function readKeyFile(path: string): Promise<Buffer> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('dsh-android stream access key is not a regular file')
  const key = await readFile(path)
  if (key.length !== KEY_BYTES) throw new Error('dsh-android stream access key has an invalid length')
  return key
}

/** Load or atomically create the per-DSH-home signing key (0600). */
export async function prepareStreamAccessKey(): Promise<Buffer> {
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 })
  const path = join(stateRoot(), 'stream-access.key')
  try {
    return await readKeyFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const candidate = randomBytes(KEY_BYTES)
  try {
    await writeFile(path, candidate, { flag: 'wx', mode: 0o600 })
    return candidate
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return readKeyFile(path)
  }
}

/** HMAC capability encoder/verifier for stream and screenshot URLs. */
export class StreamAccessController {
  #routeCount = 0
  #keyPromise: Promise<Buffer> | undefined

  constructor(private readonly resolveKey: () => Promise<Buffer> = prepareStreamAccessKey) {}

  /** Whether at least one HTTP carrier currently owns the routes. */
  get routeAvailable(): boolean {
    return this.#routeCount > 0
  }

  /** Mark one route attachment; the returned disposer removes it. */
  attachRoute(): () => void {
    this.#routeCount += 1
    let active = true
    return () => {
      if (!active) return
      active = false
      this.#routeCount -= 1
    }
  }

  /** Mint a stream capability for one device serial. */
  async signStreamToken(serial: string, options: { ttlMs?: number } = {}): Promise<{ token: string; expiresAt: number }> {
    if (!SERIAL_PATTERN.test(serial)) throw new TypeError('dsh-android: signStreamToken requires a device serial')
    return this.#sign({ v: 1, kind: 'android-stream', serial, exp: Date.now() + this.#ttl(options.ttlMs) })
  }

  /** Mint a screenshot capability for one absolute path in the cache dir. */
  async signScreenshotToken(path: string, options: { ttlMs?: number } = {}): Promise<{ token: string; expiresAt: number }> {
    if (!isAbsolute(path)) throw new TypeError('dsh-android: signScreenshotToken requires an absolute path')
    return this.#sign({ v: 1, kind: 'android-screenshot', path, exp: Date.now() + this.#ttl(options.ttlMs) })
  }

  verifyStreamToken(token: string): Promise<StreamTokenPayload | undefined> {
    return this.#verify(token, parseStreamPayload)
  }

  verifyScreenshotToken(token: string): Promise<ScreenshotTokenPayload | undefined> {
    return this.#verify(token, parseScreenshotPayload)
  }

  #ttl(ttlMs: number | undefined): number {
    if (ttlMs === undefined || !Number.isFinite(ttlMs)) return TOKEN_TTL_MS
    return Math.min(TOKEN_TTL_MS, Math.max(1, Math.floor(ttlMs)))
  }

  #key(): Promise<Buffer> {
    this.#keyPromise ??= this.resolveKey()
    return this.#keyPromise
  }

  async #sign(payload: StreamTokenPayload | ScreenshotTokenPayload): Promise<{ token: string; expiresAt: number }> {
    const key = await this.#key()
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return { token: `${encoded}.${mac(key, encoded).toString('base64url')}`, expiresAt: payload.exp }
  }

  async #verify<Payload>(token: string, parse: (value: unknown) => Payload | undefined): Promise<Payload | undefined> {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) return undefined
    const [encoded, signature] = token.split('.')
    if (encoded === undefined || signature === undefined) return undefined
    const key = await this.#key().catch(() => undefined)
    if (key === undefined) return undefined
    let supplied: Buffer
    try {
      supplied = Buffer.from(signature, 'base64url')
    } catch {
      return undefined
    }
    if (!safeEqual(mac(key, encoded), supplied)) return undefined
    try {
      const payload = parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
      if (payload === undefined) return undefined
      const now = Date.now()
      const expiresAt = (payload as { exp?: unknown }).exp
      if (typeof expiresAt !== 'number' || expiresAt <= now) return undefined
      if (expiresAt - now > TOKEN_TTL_MS + CLOCK_SKEW_MS) return undefined
      return payload
    } catch {
      return undefined
    }
  }
}

// ── loopback / trusted-browser transport fence ───────────────────────────────

function isIpv4LoopbackAddress(address: string): boolean {
  const parts = address.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Trust the transport peer, never forwarded or caller-controlled host data.
 * Node may expose an IPv4 peer directly or as an IPv4-mapped IPv6 address,
 * including the compact hexadecimal form used by some platforms.
 */
export function isLoopbackRemoteAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase().split('%', 1)[0]!
  if (normalized === '::1' || isIpv4LoopbackAddress(normalized)) return true
  if (!normalized.startsWith('::ffff:')) return false
  const mapped = normalized.slice('::ffff:'.length)
  if (isIpv4LoopbackAddress(mapped)) return true
  const hexadecimal = /^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(mapped)
  return hexadecimal !== null && (Number.parseInt(hexadecimal[1]!, 16) >>> 8) === 127
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  return isIpv4LoopbackAddress(hostname)
}

/** Parse a bare `host[:port]` authority, rejecting anything with more in it. */
function parseAuthority(authority: string): URL | undefined {
  try {
    const parsed = new URL(`http://${authority}`)
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

function requestAuthority(req: IncomingMessage): URL | undefined {
  const host = req.headers.host
  if (typeof host !== 'string') return undefined
  return parseAuthority(host)
}

function isTrustedTransportRequest(req: IncomingMessage): boolean {
  // Half one is unchanged and not configurable: the peer must be loopback, so a
  // LAN client on the web port cannot pass however it writes its Host header.
  if (!isLoopbackRemoteAddress(req.socket?.remoteAddress)) return false
  const authority = requestAuthority(req)
  if (authority === undefined) return false
  // Half two: either the Host itself is loopback, or the operator listed the
  // authority their reverse proxy forwards.
  return isLoopbackHostname(authority.hostname) || trustedEntryForHost(authority) !== undefined
}

function isTrustedBrowserRequest(req: IncomingMessage, requireOrigin: boolean, entry: MintedAuthority | undefined): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  if (typeof origin !== 'string') return false
  const authority = requestAuthority(req)
  if (authority === undefined) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.hostname === '') return false
    // A configured authority is compared against the origin the operator listed
    // for it, which is the only way a proxied deployment can be checked at all:
    // the browser sends the PUBLIC origin (usually with no port, because 443 is
    // implicit) while the proxy forwards its own Host, so comparing the two
    // headers with each other refuses a same-origin request. It is not a reason
    // to drop the port from the comparison — see `matchesTrustedOrigin`.
    if (entry !== undefined) return matchesTrustedOrigin(entry, parsed)
    // A loopback Host is a specific origin, so the port has to agree: the DSH
    // webserver answers on one port, and another application on the same
    // hostname must not be able to drive these routes.
    return hostMatchesOrigin(authority, parsed)
  } catch {
    return false
  }
}

/** The transport fence applied to every dsh-android route. */
export function isTrustedRequest(req: IncomingMessage, requireOrigin: boolean): boolean {
  // The transport decides first, and it is the half that actually refuses a
  // remote caller; the header checks are only meaningful after it passes.
  if (!isTrustedTransportRequest(req)) return false
  const authority = requestAuthority(req)
  const entry = authority === undefined ? undefined : trustedEntryForHost(authority)
  return isTrustedBrowserRequest(req, requireOrigin, entry)
}

// ── screenshot path containment ──────────────────────────────────────────────

export type ScreenshotVerdict = 'ok' | 'outside' | 'missing'

/**
 * Walk `path` from the screenshot cache root with `lstat` (refusing any
 * symbolic link) and finish with a `realpath` containment check.
 */
export async function classifyScreenshotPath(path: string): Promise<ScreenshotVerdict> {
  const root = screenshotDir()
  await mkdir(root, { recursive: true, mode: 0o700 }).catch(() => {})
  if (!isAbsolute(path)) return 'outside'
  const rel = relative(root, path)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'outside'
  let current = root
  const parts = rel.split(sep)
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === undefined || part.length === 0 || part === '.' || part === '..') return 'outside'
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch {
      return 'missing'
    }
    if (info.isSymbolicLink()) return 'outside'
    const final = index === parts.length - 1
    if (final ? !info.isFile() : !info.isDirectory()) return 'missing'
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)])
  const relReal = relative(realRoot, realFile)
  if (relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) return 'outside'
  return 'ok'
}

/**
 * Open the verified screenshot with `O_NOFOLLOW`, bounded in size, and
 * re-validate containment so a file swapped for a symlink between minting
 * and fetching is never served.
 */
export async function openVerifiedScreenshot(path: string): Promise<{ bytes: Buffer } | undefined> {
  const verdict = await classifyScreenshotPath(path)
  if (verdict !== 'ok') return undefined
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const handle = await open(path, fsConstants.O_RDONLY | noFollow).catch(() => undefined)
  if (handle === undefined) return undefined
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size <= 0 || info.size > MAX_SCREENSHOT_BYTES) return undefined
    const bytes = await handle.readFile()
    if (await classifyScreenshotPath(path) !== 'ok') return undefined
    return { bytes }
  } finally {
    await handle.close().catch(() => {})
  }
}
