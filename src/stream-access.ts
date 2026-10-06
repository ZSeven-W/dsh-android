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

/** Extra public authorities served only through an authenticating loopback proxy. */
export type AndroidTrustConfig = {
  trustedAuthorities?: readonly string[]
}

/** Header authority and canonical browser-origin policy remain separate. */
type MintedAuthority = {
  authority: string
  origin: string
  hostname: string
  port?: string
  scheme?: 'http:' | 'https:'
  portless: boolean
  authoredScheme: boolean
}

let trustedAuthorities: readonly MintedAuthority[] = []

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80'
}

/** Read only a validated authority, never a URL scheme or IPv6 inner colon. */
function writtenPort(authority: string): string | undefined {
  const separator = authority.lastIndexOf(':')
  if (separator === -1) return undefined
  const bracket = authority.indexOf(']')
  if (authority.startsWith('[') && bracket !== -1 && separator < bracket) return undefined
  const port = authority.slice(separator + 1)
  return port === '' ? undefined : String(Number(port))
}

function authorityOfUrl(value: string): string {
  return value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0] ?? ''
}

function normalizeAuthorityEntry(entry: string): MintedAuthority | undefined {
  const value = entry.trim()
  if (value === '') return undefined
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  const parsed = hasScheme ? (() => { try { return new URL(value) } catch { return undefined } })() : parseAuthority(value)
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return undefined
  if (parsed.hostname === '' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
    || parsed.username !== '' || parsed.password !== '') return undefined
  const port = writtenPort(hasScheme ? authorityOfUrl(value) : value)
  const hostname = parsed.hostname.toLowerCase()
  return {
    authority: parsed.host.toLowerCase(),
    origin: hasScheme ? parsed.origin : '',
    hostname,
    ...(port === undefined && !hasScheme ? {} : { port: port ?? defaultPort(parsed.protocol) }),
    ...(hasScheme ? { scheme: parsed.protocol as 'http:' | 'https:' } : {}),
    portless: port === undefined,
    authoredScheme: hasScheme,
  }
}

export function mintTrustedAuthorities(entries: readonly string[] | undefined): readonly MintedAuthority[] {
  if (entries === undefined) return []
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
    throw new TypeError('dsh-android: trustedAuthorities must be an array of strings')
  }
  const minted = new Map<string, MintedAuthority>()
  for (const entry of entries) {
    const value = normalizeAuthorityEntry(entry)
    if (value === undefined) continue
    // Two schemes or a narrow and broad authority on the same hostname must
    // coexist; accepting one cannot hide another explicitly configured origin.
    const key = `${value.hostname}|${value.scheme ?? '*'}|${value.port ?? '*'}|${value.portless}`
    minted.set(key, value)
  }
  return [...minted.values()].sort((left, right) => left.authority.localeCompare(right.authority)
    || left.origin.localeCompare(right.origin))
}

export function configureTrustedAuthorities(config: AndroidTrustConfig | undefined): readonly MintedAuthority[] {
  trustedAuthorities = mintTrustedAuthorities(config?.trustedAuthorities)
  return trustedAuthorities
}

function trustedEntriesForHost(authority: URL, header: string): readonly MintedAuthority[] {
  const port = writtenPort(header)
  return trustedAuthorities.filter(entry => entry.hostname === authority.hostname.toLowerCase()
    && (entry.portless || entry.port === port
      // Browser Hosts omit default ports. The arriving HTTP hop may be a TLS
      // proxy, so the configured Origin, checked separately, pins the scheme.
      || (port === undefined && (entry.port === '80' || entry.port === '443'))))
}

function matchesTrustedOrigin(entry: MintedAuthority, origin: URL): boolean {
  if (origin.hostname.toLowerCase() !== entry.hostname) return false
  if (entry.scheme !== undefined && entry.scheme !== origin.protocol) return false
  const actualPort = origin.port || defaultPort(origin.protocol)
  return actualPort === (entry.port ?? defaultPort(origin.protocol))
}

function hostMatchesOrigin(authority: URL, origin: URL, header: string): boolean {
  // Keep an explicitly written :80 even though parsing a Host through an HTTP
  // URL removes it; it is not :443 merely because the Origin uses HTTPS.
  const authorityPort = writtenPort(header) ?? defaultPort(origin.protocol)
  return authority.hostname.toLowerCase() === origin.hostname.toLowerCase()
    && authorityPort === (origin.port || defaultPort(origin.protocol))
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
  return isLoopbackHostname(authority.hostname) || trustedEntriesForHost(authority, req.headers.host as string).length > 0
}

function isTrustedBrowserRequest(req: IncomingMessage, requireOrigin: boolean, entries: readonly MintedAuthority[] | undefined): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  if (typeof origin !== 'string') return false
  const authority = requestAuthority(req)
  if (authority === undefined) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== ''
      || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return false
    // A configured authority is compared against the origin the operator listed
    // for it, which is the only way a proxied deployment can be checked at all:
    // the browser sends the PUBLIC origin (usually with no port, because 443 is
    // implicit) while the proxy forwards its own Host, so comparing the two
    // headers with each other refuses a same-origin request. It is not a reason
    // to drop the port from the comparison — see `matchesTrustedOrigin`.
    if (entries !== undefined) return entries.some(entry => matchesTrustedOrigin(entry, parsed))
    // A loopback Host is a specific origin, so the port has to agree: the DSH
    // webserver answers on one port, and another application on the same
    // hostname must not be able to drive these routes.
    return hostMatchesOrigin(authority, parsed, req.headers.host as string)
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
  // A loopback Host is the local-browser case and is judged on its own: letting
  // an allowlist entry (an operator may well list `localhost` for an SSH tunnel)
  // redirect it into the configured-origin branch would make listing an entry
  // NARROW the fence, refusing the local panel on its own port.
  const entries = authority === undefined || isLoopbackHostname(authority.hostname)
    ? undefined
    : trustedEntriesForHost(authority, req.headers.host as string)
  return isTrustedBrowserRequest(req, requireOrigin, entries)
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
