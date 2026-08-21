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

function requestAuthority(req: IncomingMessage): URL | undefined {
  const host = req.headers.host
  if (typeof host !== 'string') return undefined
  try {
    const parsed = new URL(`http://${host}`)
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  if (!isLoopbackRemoteAddress(req.socket?.remoteAddress)) return false
  const authority = requestAuthority(req)
  return authority !== undefined && isLoopbackHostname(authority.hostname)
}

function isTrustedBrowserRequest(req: IncomingMessage, requireOrigin: boolean): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  if (typeof origin !== 'string') return false
  const authority = requestAuthority(req)
  if (authority === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host === authority.host
  } catch {
    return false
  }
}

/** The transport fence applied to every dsh-android route. */
export function isTrustedRequest(req: IncomingMessage, requireOrigin: boolean): boolean {
  return isLoopbackRequest(req) && isTrustedBrowserRequest(req, requireOrigin)
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
