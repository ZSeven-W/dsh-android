/**
 * Shared runtime for the model-facing Android tools: device resolution, the
 * screenshot store, the interaction router, and the schemas every result
 * shape reuses.
 *
 * This is the layer dsh-ios kept inline in its (1742-line) tools.ts. Here it
 * is its own module so the tool DEFINITIONS stay readable and so the UI/OCR/
 * row tool families can share exactly one screenshot layout and one device
 * summary — three independent capture paths writing into one directory is a
 * real overwrite hazard (see `ScreenshotStore`), and it only stays safe while
 * they all go through this code.
 *
 * Everything here is re-exported from `./tools.js`, which is the import path
 * the sibling tool modules use.
 * @module @zseven-w/dsh-android/tool-support
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AndroidDevice, AndroidDeviceDetails } from './adb.js'
import { ANDROID_BUTTONS, type AndroidHostController } from './android-host.js'

/** The device summary every tool result carries. */
export interface AndroidDeviceInfo {
  serial: string
  /** Marketing model when the device answers getprop, else the serial. */
  name: string
  /** `ro.build.version.release`, or '' when the device did not answer. */
  androidVersion: string
  /** adb connection state (`device`, `offline`, `unauthorized`, …). */
  state: string
}

/** Screenshot summary — the value the tools return instead of image bytes. */
export interface AndroidScreenshotResult {
  path: string
  bytes: number
  width?: number
  height?: number
  device: AndroidDeviceInfo
}

export type AndroidInteractAction = 'tap' | 'type' | 'button' | 'gesture' | 'scroll'

export interface AndroidInteractArgs {
  device?: string
  action: AndroidInteractAction
  x?: number
  y?: number
  text?: string
  name?: string
  json?: JsonValue
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
}

/** Settle delay after an interaction, before the effect screenshot. */
export const INTERACT_SETTLE_MS = 300

/**
 * The band every scroll stays inside, as a fraction of the travelling axis.
 * Android's gesture navigation owns the bottom strip (back/home/recents swipe)
 * and both side edges (back gesture), and a swipe that starts inside one of
 * those is eaten by the system before the app ever sees it. dsh-ios clamps to
 * the same 8%..92% for the home-indicator strip.
 */
export const SCROLL_BAND_MIN = 0.08
export const SCROLL_BAND_MAX = 0.92

/** Seconds one scroll's `input swipe` takes — fast enough to read as a flick. */
export const SCROLL_DURATION_S = 0.3

export const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const
export const INTERACT_ACTIONS = ['tap', 'type', 'button', 'gesture', 'scroll'] as const

export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function renderJson(_args: unknown, value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * Shared device object schema used by every tool result. Kept `as const` so
 * `defineTool` can infer the concrete output value type (an interface-typed
 * schema would widen to an empty object under the DSL's inference).
 */
export const deviceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serial: { type: 'string', required: true },
    name: { type: 'string', required: true },
    androidVersion: { type: 'string', required: true },
    state: { type: 'string', required: true },
  },
} as const

/** One installed package, as `android_list_apps` reports it. */
export const appSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    packageName: { type: 'string', required: true },
    label: { type: 'string', required: true },
    version: { type: 'string' },
    versionCode: { type: 'integer' },
    system: { type: 'boolean', required: true },
    apkPath: { type: 'string' },
  },
} as const

/** Degradation guard: throws the explanatory error when adb is unresolvable. */
export function assertAdbAvailable(host: AndroidHostController, tool: string): void {
  if (host.available) return
  const reason = host.toolchain.binary.reason ?? 'adb was not found'
  throw new Error(
    `${tool}: adb is unavailable — ${reason}. Install the Android SDK platform-tools, put adb on PATH, or `
    + 'set the ADB environment variable to the executable, then retry.',
  )
}

/** The device summary a tool result carries, from a listing row + getprop. */
export function deviceSummary(device: AndroidDevice, details?: AndroidDeviceDetails): AndroidDeviceInfo {
  return {
    serial: device.serial,
    name: details?.model ?? device.model ?? device.serial,
    androidVersion: details?.androidVersion ?? '',
    state: device.state,
  }
}

/**
 * Resolve the device a tool operates on and enrich it for the result. The
 * resolution itself lives in the host (explicit serial → streamed → the only
 * online device → an explanatory throw); this only adds the getprop details
 * every result shape wants, and re-prefixes the error with the calling tool.
 */
export async function resolveTarget(
  host: AndroidHostController,
  tool: string,
  serial: string | undefined,
): Promise<{ device: AndroidDevice; summary: AndroidDeviceInfo }> {
  assertAdbAvailable(host, tool)
  let device: AndroidDevice
  try {
    device = await host.resolveTarget(serial === undefined || serial.trim() === '' ? undefined : serial.trim())
  } catch (error) {
    const message = errorMessage(error)
    throw new Error(message.startsWith(`${tool}:`) ? message : `${tool}: ${message.replace(/^dsh-android: /, '')}`)
  }
  const details = await host.toolchain.deviceDetails(device).catch(() => undefined)
  return { device, summary: deviceSummary(device, details) }
}

/**
 * Per-device screenshot paths inside the SHARED cache directory
 * (`<tmp>/dsh-android/screenshots/screenshot-<serial>-<n>.png`, the exact
 * directory the signed screenshot route serves).
 *
 * Three independent counters write into that directory — this store, the UI
 * tools' twin, and the panel capture route — so each scans the directory once
 * and their counters collide. Skipping names that already exist on disk is
 * what keeps a later write from overwriting an earlier capture whose signed
 * URL is still live.
 */
export class ScreenshotStore {
  readonly #root: string
  readonly #next = new Map<string, number>()

  constructor(root: string) {
    this.#root = root
  }

  /** The directory captures land in (shared with the screenshot route). */
  get root(): string {
    return this.#root
  }

  nextPath(serial: string): string {
    mkdirSync(this.#root, { recursive: true, mode: 0o700 })
    const safe = serial.replace(/[^A-Za-z0-9_-]/g, '_')
    let next = this.#next.get(safe)
    if (next === undefined) {
      next = 0
      const prefix = `screenshot-${safe}-`
      for (const entry of readdirSync(this.#root)) {
        if (!entry.startsWith(prefix) || !entry.endsWith('.png')) continue
        const index = Number(entry.slice(prefix.length, -4))
        if (Number.isInteger(index) && index >= next) next = index + 1
      }
    }
    let path = join(this.#root, `screenshot-${safe}-${next}.png`)
    while (existsSync(path)) {
      next += 1
      path = join(this.#root, `screenshot-${safe}-${next}.png`)
    }
    this.#next.set(safe, next + 1)
    return path
  }
}

/** Capture one PNG into the store and summarize it (never image bytes). */
export async function captureScreenshot(
  host: AndroidHostController,
  store: ScreenshotStore,
  tool: string,
  device: AndroidDevice,
  summary: AndroidDeviceInfo,
): Promise<AndroidScreenshotResult> {
  let shot: { png: Buffer; width?: number; height?: number }
  try {
    shot = await host.screenshot(device.serial)
  } catch (error) {
    throw new Error(
      `${tool}: the screencap on ${device.serial} failed: ${errorMessage(error)} — the device may have gone `
      + 'offline; run android_devices to check',
    )
  }
  const path = store.nextPath(device.serial)
  try {
    writeFileSync(path, shot.png)
  } catch (error) {
    throw new Error(`${tool}: could not write the screenshot to ${path}: ${errorMessage(error)}`)
  }
  const bytes = statSync(path).size
  return {
    path,
    bytes,
    ...(shot.width === undefined ? {} : { width: shot.width }),
    ...(shot.height === undefined ? {} : { height: shot.height }),
    device: summary,
  }
}

/** Screenshot presentation envelope — stable, replayable identifiers only. */
export function screenshotMeta(value: unknown): JsonValue {
  const result = value as unknown as AndroidScreenshotResult
  return {
    kind: 'android-screenshot',
    // `path` and `screenshotPath` are deliberately the same value: the client
    // hydrate check reads one, the capture session reads the other, and one
    // renamed field would silently stop a card from re-minting its URL.
    screenshotPath: result.path,
    path: result.path,
    device: { ...result.device },
  }
}

/** One scroll's finger path in normalized 0..1 frame coordinates. */
export interface ScrollPath {
  fromX: number
  fromY: number
  toX: number
  toY: number
}

function clampBand(value: number): number {
  return Math.min(SCROLL_BAND_MAX, Math.max(SCROLL_BAND_MIN, value))
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The finger path of one scroll. The direction names the CONTENT, matching
 * dsh-ios: `down` reveals content further down the page, which is the finger
 * moving UP (a smaller y). Both endpoints are clamped into the
 * system-gesture-free band, so a swipe can never begin (or end) in Android's
 * navigation strip where the shell would swallow it.
 */
export function androidScrollPath(args: AndroidInteractArgs): ScrollPath {
  const direction = args.direction
  if (direction === undefined || (SCROLL_DIRECTIONS as readonly string[]).indexOf(direction) === -1) {
    throw new Error(
      'android_interact: action "scroll" requires direction "up", "down", "left" or "right"'
      + ` (got ${direction === undefined ? 'nothing' : JSON.stringify(direction)})`,
    )
  }
  const amount = args.amount ?? 0.6
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1) {
    throw new Error(`android_interact: scroll amount must be a number within 0..1, got ${String(amount)}`)
  }
  const anchorX = finiteNumber(args.x) ?? 0.5
  const anchorY = finiteNumber(args.y) ?? 0.5
  if (anchorX < 0 || anchorX > 1 || anchorY < 0 || anchorY > 1) {
    throw new Error(`android_interact: scroll anchor x/y must be within 0..1, got x=${String(args.x)} y=${String(args.y)}`)
  }
  const vertical = direction === 'up' || direction === 'down'
  const anchor = vertical ? anchorY : anchorX
  const delta = (direction === 'down' || direction === 'right' ? -1 : 1) * amount
  const from = clampBand(anchor)
  const to = clampBand(from + delta)
  return vertical
    ? { fromX: anchorX, fromY: from, toX: anchorX, toY: to }
    : { fromX: from, fromY: anchorY, toX: to, toY: anchorY }
}

/**
 * Validate a `gesture` payload into a normalized drag. Android has one gesture
 * primitive (`input swipe`), so a gesture IS a drag — a raw single-frame
 * `{type,x,y}` payload (which serve-sim accepted on iOS) has no meaning here
 * and is refused with the shape that does work.
 */
export function gestureDragOf(json: JsonValue | undefined): {
  fromX: number
  fromY: number
  toX: number
  toY: number
  duration: number
} {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(
      'android_interact: action "gesture" requires a json object describing a drag, e.g. '
      + '{"fromX":0.5,"fromY":0.8,"toX":0.5,"toY":0.2,"duration":0.3} with normalized 0..1 coordinates',
    )
  }
  const record = json as Record<string, unknown>
  const fromX = finiteNumber(record.fromX)
  const fromY = finiteNumber(record.fromY)
  const toX = finiteNumber(record.toX)
  const toY = finiteNumber(record.toY)
  if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
    throw new Error(
      'android_interact: a gesture is a drag on Android (`input swipe`) — pass json '
      + '{"fromX":0.1,"fromY":0.5,"toX":0.9,"toY":0.5,"duration":0.3} with normalized 0..1 coordinates '
      + '(single-frame {"type":"begin",…} payloads are an iOS/serve-sim shape and do nothing here)',
    )
  }
  if (![fromX, fromY, toX, toY].every(value => value >= 0 && value <= 1)) {
    throw new Error('android_interact: gesture from/to coordinates must be normalized 0..1 of the streamed frame')
  }
  const duration = finiteNumber(record.duration) ?? 0.3
  if (duration <= 0 || duration > 5) {
    throw new Error(`android_interact: gesture duration must be within 0..5 seconds, got ${String(duration)}`)
  }
  return { fromX, fromY, toX, toY, duration }
}

/**
 * Perform one validated interaction against the device. Every branch validates
 * BEFORE touching the device, so an argument mistake never lands a half
 * gesture on a real phone.
 */
export async function performInteract(
  host: AndroidHostController,
  serial: string,
  args: AndroidInteractArgs,
): Promise<void> {
  switch (args.action) {
    case 'tap': {
      const x = finiteNumber(args.x)
      const y = finiteNumber(args.y)
      if (x === undefined || y === undefined) {
        throw new Error('android_interact: action "tap" requires numeric x and y (normalized 0..1 of the frame)')
      }
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error(`android_interact: tap x/y must be within 0..1, got x=${String(args.x)} y=${String(args.y)}`)
      }
      await host.tap(serial, x, y)
      return
    }
    case 'type': {
      if (typeof args.text !== 'string' || args.text === '') {
        throw new Error('android_interact: action "type" requires a non-empty text')
      }
      await host.type(serial, args.text)
      return
    }
    case 'button': {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        throw new Error(
          'android_interact: action "button" requires a button name — one of '
          + `${Object.keys(ANDROID_BUTTONS).join(', ')}, or a raw KEYCODE_* name`,
        )
      }
      await host.button(serial, args.name.trim())
      return
    }
    case 'gesture': {
      await host.drag(serial, gestureDragOf(args.json))
      return
    }
    case 'scroll': {
      await host.drag(serial, { ...androidScrollPath(args), duration: SCROLL_DURATION_S })
      return
    }
  }
}
