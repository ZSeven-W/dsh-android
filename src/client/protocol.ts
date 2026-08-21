/**
 * Browser-side wire contract for the dsh-android device cards and panel.
 *
 * Pure helpers only — nothing touches the DOM at module scope, and every
 * function exported here is safe to call from Node, so the dev-panel-smoke
 * script drives the exact bytes the panel sends in a browser.
 *
 * Contract summary (host side, see src/stream-routes.ts):
 * - `output.presentationMeta` rides into `ToolResultNode.meta` verbatim with
 *   kinds `android-stream` | `android-screenshot` | `android-build-run`.
 * - `POST /_dsh/dsh-android/grant` re-mints origin-relative capability URLs
 *   at render time; tokens expire within 10 minutes. `{kind:'stream'}` →
 *   `{streamUrl, expiresAt, device}` — there is **no wsUrl**: this plugin has
 *   NO WebSocket at all. `{kind:'screenshot', path}` → `{screenshotUrl,
 *   expiresAt}`.
 * - `POST /_dsh/dsh-android/switch-device {device}` → the grant shape plus
 *   `{device, deviceName}`; only ONLINE serials are accepted (an AVD boot
 *   takes minutes and belongs to the `android_boot` tool).
 * - `POST /_dsh/dsh-android/devices {}` → `{devices:[{serial,state,kind,
 *   model?,streaming?}], avds:[string]}` — ONE array (emulators and phones
 *   stream through the same code path), plus the machine's AVD names.
 * - `POST /_dsh/dsh-android/capture {device?}` → `{screenshotUrl, path,
 *   bytes, expiresAt}`.
 * - `POST /_dsh/dsh-android/status {device?}` → `{running, serial?,
 *   deviceName?}`.
 * - `POST /_dsh/dsh-android/control {device, action}` — the ONE control
 *   channel: tap / drag (NORMALIZED 0..1 of the streamed frame) / button /
 *   type / rotate. A rotate answers `{rotation: 0..3}`.
 * - `POST /_dsh/dsh-android/device-action {device?, action}` → `{action}`.
 * - Every failure is `{ok:false, code, error}`; the UI localizes off the
 *   CODE and keeps the host's English `error` as the fallback.
 *
 * COORDINATE SPACE: an Android `screencap` frame follows the DISPLAY
 * rotation (a landscape app streams 2400×1080) and `input tap` addresses the
 * same space, so normalized pointer coordinates over the displayed box go
 * STRAIGHT to `/control` — there is no framebuffer/display mismatch and no
 * inverse rotation anywhere in this client.
 * @module @zseven-w/dsh-android/client/protocol
 */

/** Wire tool names the client registers conversation cards for. */
export const ANDROID_CARD_TOOLS = {
  boot: 'android_boot',
  screenshot: 'android_screenshot',
  interact: 'android_interact',
  buildRun: 'android_build_run',
} as const

/** HTTP prefix owned by the dsh-android web routes. */
export const PLUGIN_ROUTE_PREFIX = '/_dsh/dsh-android'

/** The grant endpoint the cards/panel POST to at render time. */
export const GRANT_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/grant`

/** The read-only stream-status endpoint the input-dock capsule polls. */
export const STATUS_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/status`

/** The fresh-screenshot endpoint the panel toolbar's 截图 button POSTs to. */
export const CAPTURE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/capture`

/** The device-switch endpoint the panel header's device picker POSTs to. */
export const SWITCH_DEVICE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/switch-device`

/** The pickable-device listing endpoint the picker refreshes on open. */
export const DEVICES_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/devices`

/** The single control endpoint (tap/drag/button/type/rotate). */
export const CONTROL_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/control`

/** The device-level action endpoint (notification shade, lock, …). */
export const DEVICE_ACTION_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/device-action`

/** The device summary embedded in every presentationMeta envelope. */
export interface AndroidDeviceInfo {
  serial?: string
  name?: string
  androidVersion?: string
  state?: string
}

/** One device from the host `/devices` listing (adb shape, ONE array). */
export interface AndroidDeviceEntry {
  serial: string
  /** adb's device state: `device` (online), `offline`, `unauthorized`, … */
  state: string
  kind: 'emulator' | 'physical'
  model?: string
  /** True for the device the host is currently streaming. */
  streaming?: boolean
}

/** The listing: the devices plus the machine's AVD names (context only). */
export interface AndroidDeviceListing {
  devices: AndroidDeviceEntry[]
  /** AVD names the picker shows as an unclickable "start it with
   * android_boot" hint — booting an emulator takes minutes and is not tied
   * to a serial until it appears, so it is never a click in the panel. */
  avds: string[]
}

/** Only a fully online device can stream or take control ops. */
export function androidDeviceOnline(device: AndroidDeviceEntry): boolean {
  return device.state === 'device'
}

export interface AndroidStreamMeta {
  kind: 'android-stream'
  device: AndroidDeviceInfo
  streamRouteId?: string
}

export interface AndroidScreenshotMeta {
  kind: 'android-screenshot'
  /** Primary path (also exposed as `screenshotPath` by the host). */
  path: string
  screenshotPath?: string
  device: AndroidDeviceInfo
}

export interface AndroidBuildRunMeta {
  kind: 'android-build-run'
  device: AndroidDeviceInfo
  packageName?: string
  apkPath?: string
}

export type AndroidMeta = AndroidStreamMeta | AndroidScreenshotMeta | AndroidBuildRunMeta

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseDevice(value: unknown): AndroidDeviceInfo {
  if (!isRecord(value)) return {}
  return {
    ...(typeof value.serial === 'string' ? { serial: value.serial } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.androidVersion === 'string' ? { androidVersion: value.androidVersion } : {}),
    ...(typeof value.state === 'string' ? { state: value.state } : {}),
  }
}

/**
 * Defensively parse the presentationMeta the host projected into
 * `ToolResultNode.meta`. Unknown or malformed shapes return `undefined` and
 * the card falls back to its plain fallback UI — never a throw.
 */
export function parseAndroidMeta(meta: unknown): AndroidMeta | undefined {
  if (!isRecord(meta)) return undefined
  const device = parseDevice(meta.device)
  if (meta.kind === 'android-stream') {
    const streamRouteId = optionalString(meta, 'streamRouteId')
    return { kind: 'android-stream', device, ...(streamRouteId === undefined ? {} : { streamRouteId }) }
  }
  if (meta.kind === 'android-screenshot') {
    const path = optionalString(meta, 'path') ?? optionalString(meta, 'screenshotPath')
    if (path === undefined) return undefined
    const screenshotPath = optionalString(meta, 'screenshotPath')
    return { kind: 'android-screenshot', path, ...(screenshotPath === undefined ? {} : { screenshotPath }), device }
  }
  if (meta.kind === 'android-build-run') {
    const packageName = optionalString(meta, 'packageName')
    const apkPath = optionalString(meta, 'apkPath')
    return {
      kind: 'android-build-run',
      device,
      ...(packageName === undefined ? {} : { packageName }),
      ...(apkPath === undefined ? {} : { apkPath }),
    }
  }
  return undefined
}

/** Fetch surface the cards use; injectable for tests and headless hosts. */
export type AndroidFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface StreamGrantResponse {
  streamUrl: string
  expiresAt?: number
  device?: string
}

export interface ScreenshotGrantResponse {
  screenshotUrl: string
  expiresAt?: number
}

export type GrantFailure = { ok: false; status?: number; error: string; code?: AndroidRouteErrorCode }

/**
 * Stable failure reasons the routes report alongside their English `error`
 * detail (mirrors `AndroidRouteErrorCode` in src/stream-routes.ts). The host
 * cannot know which language the browser shows, so the UI localizes off the
 * CODE and keeps the English text as the fallback for anything unrecognized.
 */
export type AndroidRouteErrorCode =
  | 'forbidden'
  | 'bad_method'
  | 'bad_content_type'
  | 'bad_request'
  | 'device_unknown'
  | 'device_offline'
  | 'device_unauthorized'
  | 'device_busy'
  | 'stream_not_running'
  | 'stream_failed'
  | 'token_invalid'
  | 'screenshot_missing'
  | 'adb_unavailable'
  | 'unavailable'

const ROUTE_ERROR_COPY_KEYS: Record<AndroidRouteErrorCode, string> = {
  forbidden: 'errForbidden',
  bad_method: 'errBadMethod',
  bad_content_type: 'errBadContentType',
  bad_request: 'errBadRequest',
  device_unknown: 'errDeviceUnknown',
  device_offline: 'errDeviceOffline',
  device_unauthorized: 'errDeviceUnauthorized',
  device_busy: 'errDeviceBusy',
  stream_not_running: 'errStreamNotRunning',
  stream_failed: 'errStreamFailed',
  token_invalid: 'errTokenInvalid',
  screenshot_missing: 'errScreenshotMissing',
  adb_unavailable: 'errAdbUnavailable',
  unavailable: 'errUnavailable',
}

/**
 * Localized text for a route failure: the code wins, the host's English
 * detail is the fallback. `copy` is the locale table (androidCopy(locale)) —
 * passed in rather than imported so this module stays copy-agnostic.
 */
export function androidRouteErrorTextOf(
  failure: { error: string; code?: string },
  copy: Record<string, string>,
): string {
  const key = failure.code === undefined ? undefined : ROUTE_ERROR_COPY_KEYS[failure.code as AndroidRouteErrorCode]
  const localized = key === undefined ? undefined : copy[key]
  return localized ?? failure.error
}

type PostResult = { ok: true; body: Record<string, unknown> } | GrantFailure

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * POST one JSON body and defensively read the answer. NEVER throws: a
 * transport failure, a non-2xx status and a malformed body all resolve to the
 * shared `GrantFailure` shape so every call site has exactly one branch.
 */
async function postJson(
  fetcher: AndroidFetcher,
  path: string,
  body: unknown,
  routeLabel: string,
): Promise<PostResult> {
  let response: Response
  try {
    response = await fetcher(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return { ok: false, error: `${routeLabel} request failed: ${errorMessage(error)}` }
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    value = undefined
  }
  if (!response.ok || !isRecord(value)) {
    const message = isRecord(value) && typeof value.error === 'string'
      ? value.error
      : `${routeLabel} endpoint returned HTTP ${response.status}`
    const code = isRecord(value) && typeof value.code === 'string' ? value.code as AndroidRouteErrorCode : undefined
    return { ok: false, status: response.status, error: message, ...(code === undefined ? {} : { code }) }
  }
  return { ok: true, body: value }
}

function postGrant(fetcher: AndroidFetcher, body: unknown): Promise<PostResult> {
  return postJson(fetcher, GRANT_ROUTE_PATH, body, 'grant')
}

/**
 * The exact grant request body the stream surface sends. With a serial the
 * route starts (or reuses) the stream for that device; without one it falls
 * back to the device the session is already streaming.
 */
export function streamGrantBodyOf(input: { device?: { serial?: string } }): { kind: 'stream'; device?: string } {
  const serial = input.device?.serial
  return typeof serial === 'string' && serial.trim() !== ''
    ? { kind: 'stream', device: serial }
    : { kind: 'stream' }
}

/** POST the grant endpoint and read back the minted capability URL. */
export async function requestStreamGrant(
  fetcher: AndroidFetcher,
  input: { device?: { serial?: string } },
): Promise<{ ok: true; grant: StreamGrantResponse } | GrantFailure> {
  const result = await postGrant(fetcher, streamGrantBodyOf(input))
  if (!result.ok) return result
  const streamUrl = optionalString(result.body, 'streamUrl')
  if (streamUrl === undefined) {
    return { ok: false, error: 'grant response is missing streamUrl' }
  }
  const expiresAt = optionalFiniteNumber(result.body, 'expiresAt')
  const device = optionalString(result.body, 'device')
  return {
    ok: true,
    grant: {
      streamUrl,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(device === undefined ? {} : { device }),
    },
  }
}

/** The exact grant request body the screenshot surface sends. */
export function screenshotGrantBodyOf(path: string): { kind: 'screenshot'; path: string } {
  return { kind: 'screenshot', path }
}

/** POST the grant endpoint for one screenshot path in the plugin cache. */
export async function requestScreenshotGrant(
  fetcher: AndroidFetcher,
  path: string,
): Promise<{ ok: true; grant: ScreenshotGrantResponse } | GrantFailure> {
  const result = await postGrant(fetcher, screenshotGrantBodyOf(path))
  if (!result.ok) return result
  const screenshotUrl = optionalString(result.body, 'screenshotUrl')
  if (screenshotUrl === undefined) {
    return { ok: false, error: 'grant response is missing screenshotUrl' }
  }
  const expiresAt = optionalFiniteNumber(result.body, 'expiresAt')
  return { ok: true, grant: { screenshotUrl, ...(expiresAt === undefined ? {} : { expiresAt }) } }
}

/**
 * Host-side read-only stream status the input-dock capsule polls while the
 * panel is closed (POST `/status`). The host names the device `serial`.
 */
export interface AndroidStreamStatus {
  running: boolean
  serial?: string
  deviceName?: string
}

/**
 * POST the read-only status endpoint and defensively parse the snapshot.
 * The endpoint never starts a stream and never mints capability tokens.
 */
export async function requestAndroidStatus(
  fetcher: AndroidFetcher,
  input: { device?: string } = {},
): Promise<AndroidStreamStatus> {
  const body = typeof input.device === 'string' && input.device !== ''
    ? { device: input.device }
    : {}
  const result = await postJson(fetcher, STATUS_ROUTE_PATH, body, 'status')
  if (!result.ok) return { running: false }
  return {
    running: result.body.running === true,
    ...(typeof result.body.serial === 'string' && result.body.serial !== '' ? { serial: result.body.serial } : {}),
    ...(typeof result.body.deviceName === 'string' && result.body.deviceName !== '' ? { deviceName: result.body.deviceName } : {}),
  }
}

/** A fresh capture minted by the host route. */
export interface AndroidCaptureResponse {
  screenshotUrl: string
  path: string
  bytes: number
  expiresAt?: number
}

/** The exact capture request body the toolbar sends (device optional). */
export function captureBodyOf(input: { device?: string }): { device?: string } {
  return typeof input.device === 'string' && input.device.trim() !== ''
    ? { device: input.device }
    : {}
}

/**
 * POST the capture endpoint and read back a freshly minted screenshot URL.
 * The route captures a NEW PNG of the current streamed (or explicitly named,
 * online) device — no prior presentationMeta path is involved.
 */
export async function requestAndroidCapture(
  fetcher: AndroidFetcher,
  input: { device?: string } = {},
): Promise<{ ok: true; capture: AndroidCaptureResponse } | GrantFailure> {
  const result = await postJson(fetcher, CAPTURE_ROUTE_PATH, captureBodyOf(input), 'capture')
  if (!result.ok) return result
  const screenshotUrl = optionalString(result.body, 'screenshotUrl')
  const path = optionalString(result.body, 'path')
  const bytes = optionalFiniteNumber(result.body, 'bytes')
  if (screenshotUrl === undefined || path === undefined || bytes === undefined) {
    return { ok: false, error: 'capture response is missing screenshotUrl, path or bytes' }
  }
  const expiresAt = optionalFiniteNumber(result.body, 'expiresAt')
  return { ok: true, capture: { screenshotUrl, path, bytes, ...(expiresAt === undefined ? {} : { expiresAt }) } }
}

/** Fresh capability minted by the switch-device route (grant + identity). */
export interface AndroidSwitchResponse {
  streamUrl: string
  expiresAt?: number
  device: string
  deviceName?: string
}

/** The exact switch-device request body the panel picker sends. */
export function switchDeviceBodyOf(serial: string): { device: string } {
  return { device: serial }
}

/**
 * POST the switch-device endpoint: the explicit user gesture that takes over
 * the stream slot for another ONLINE device and mints fresh relative
 * capability URLs for it. An offline/unauthorized target answers a coded 409
 * (this route never boots an AVD — that is `android_boot`).
 */
export async function requestSwitchDevice(
  fetcher: AndroidFetcher,
  serial: string,
): Promise<{ ok: true; switched: AndroidSwitchResponse } | GrantFailure> {
  const result = await postJson(fetcher, SWITCH_DEVICE_ROUTE_PATH, switchDeviceBodyOf(serial), 'switch-device')
  if (!result.ok) return result
  const streamUrl = optionalString(result.body, 'streamUrl')
  const device = optionalString(result.body, 'device')
  if (streamUrl === undefined || device === undefined) {
    return { ok: false, error: 'switch-device response is missing streamUrl or device' }
  }
  const expiresAt = optionalFiniteNumber(result.body, 'expiresAt')
  const deviceName = optionalString(result.body, 'deviceName')
  return {
    ok: true,
    switched: {
      streamUrl,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      device,
      ...(deviceName === undefined ? {} : { deviceName }),
    },
  }
}

/**
 * POST the pickable-device listing endpoint and defensively parse the ONE
 * `devices` array plus the `avds` names. Always resolves (empty on failure) —
 * the picker degrades to the current device and retries on the next open.
 * Host-side ordering (online first, then serial) is preserved as-is.
 */
export async function requestAndroidDevices(fetcher: AndroidFetcher): Promise<AndroidDeviceListing> {
  const result = await postJson(fetcher, DEVICES_ROUTE_PATH, {}, 'devices')
  if (!result.ok || !Array.isArray(result.body.devices)) return { devices: [], avds: [] }
  const devices: AndroidDeviceEntry[] = []
  for (const entry of result.body.devices) {
    if (!isRecord(entry)) continue
    const serial = optionalString(entry, 'serial')
    const state = optionalString(entry, 'state')
    if (serial === undefined || state === undefined) continue
    const model = optionalString(entry, 'model')
    devices.push({
      serial,
      state,
      kind: entry.kind === 'emulator' ? 'emulator' : 'physical',
      ...(model === undefined ? {} : { model }),
      ...(entry.streaming === true ? { streaming: true } : {}),
    })
  }
  const avds: string[] = []
  if (Array.isArray(result.body.avds)) {
    for (const entry of result.body.avds) {
      if (typeof entry === 'string' && entry !== '') avds.push(entry)
    }
  }
  return { devices, avds }
}

// ── control surface (POST /control — the ONE control channel) ────────────────

/**
 * One control action. tap/drag coordinates are NORMALIZED 0..1 of the
 * streamed frame; the host multiplies them by the CURRENT frame size, which
 * follows the display rotation, so the panel never converts anything.
 */
export type AndroidControlAction =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'drag'; fromX: number; fromY: number; toX: number; toY: number; durationMs?: number }
  | { kind: 'button'; name: string }
  | { kind: 'type'; text: string }
  | { kind: 'rotate' }

/** Hardware/navigation buttons `/control` accepts (host: ANDROID_BUTTONS). */
export const ANDROID_BUTTONS = [
  'home',
  'back',
  'recents',
  'power',
  'volume_up',
  'volume_down',
  'menu',
  'enter',
  'delete',
] as const

export type AndroidButtonName = typeof ANDROID_BUTTONS[number]

/** The exact control request body the panel sends. */
export function controlBodyOf(
  device: string,
  action: AndroidControlAction,
): { device: string; action: AndroidControlAction } {
  return { device, action }
}

export interface AndroidControlResult {
  /** The new `user_rotation` value (0..3) after a rotate action. */
  rotation?: number
}

/**
 * POST the control endpoint. Fails fast with the route's coded error; the
 * panel treats control failures as non-fatal (a refused tap stays silent).
 */
export async function postAndroidControl(
  fetcher: AndroidFetcher,
  device: string,
  action: AndroidControlAction,
): Promise<{ ok: true; result: AndroidControlResult } | GrantFailure> {
  const result = await postJson(fetcher, CONTROL_ROUTE_PATH, controlBodyOf(device, action), 'control')
  if (!result.ok) return result
  const rotation = optionalFiniteNumber(result.body, 'rotation')
  return { ok: true, result: { ...(rotation === undefined ? {} : { rotation }) } }
}

/** The device-level actions the host exposes (host: ANDROID_DEVICE_ACTIONS). */
export const ANDROID_DEVICE_ACTIONS = [
  'notifications',
  'quick-settings',
  'lock',
  'wake',
  'assistant',
] as const

export type AndroidDeviceActionName = typeof ANDROID_DEVICE_ACTIONS[number]

/**
 * Run one device-level action. A coded failure comes back through the shared
 * failure shape and the menu keeps itself open for a retry.
 */
export async function postDeviceAction(
  fetcher: AndroidFetcher,
  device: string | undefined,
  action: string,
): Promise<{ ok: true; action: string } | GrantFailure> {
  const body = { action, ...(device === undefined || device === '' ? {} : { device }) }
  const result = await postJson(fetcher, DEVICE_ACTION_ROUTE_PATH, body, 'device-action')
  if (!result.ok) return result
  return { ok: true, action: optionalString(result.body, 'action') ?? action }
}

// ── pointer-gesture coalescing (one gesture → one control action) ────────────

/**
 * `/control` exposes COMPLETE gestures only (`input tap`, `input swipe`) —
 * there is no touch begin/move/end streaming channel — so the panel
 * COALESCES each pointer gesture into ONE action on pointer-up: a still
 * click → `tap`; a moved pointer → one `drag` from the pointer-down anchor
 * to the FINAL release point with the gesture's own duration (clamped), which
 * `input swipe` animates linearly from→to. That reproduces a faithful slow
 * drag or a quick flick without a chain of separate down-up swipes.
 */

/** Movement below this fraction of the frame still counts as a tap. */
export const ANDROID_TAP_SLOP = 0.02

/** Minimum/maximum drag duration sent to the host (seconds). */
export const ANDROID_DRAG_DURATION_MIN_S = 0.05
export const ANDROID_DRAG_DURATION_MAX_S = 2

/** Trailing-edge sampling cadence for drag move bookkeeping (ms). */
export const ANDROID_DRAG_MOVE_SAMPLE_MS = 50

export interface AndroidPoint {
  x: number
  y: number
}

/**
 * One gesture → one control action: tap when the pointer barely moved,
 * otherwise a single drag from anchor to release point over the (clamped)
 * gesture duration.
 */
export function androidGestureActionOf(
  start: AndroidPoint,
  end: AndroidPoint,
  durationMs: number,
): AndroidControlAction {
  const moved = Math.hypot(end.x - start.x, end.y - start.y)
  if (moved < ANDROID_TAP_SLOP) return { kind: 'tap', x: end.x, y: end.y }
  const duration = Math.min(
    ANDROID_DRAG_DURATION_MAX_S,
    Math.max(ANDROID_DRAG_DURATION_MIN_S, durationMs / 1000),
  )
  return {
    kind: 'drag',
    fromX: start.x,
    fromY: start.y,
    toX: end.x,
    toY: end.y,
    durationMs: Math.round(duration * 1000),
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Map a pointer event on an element to normalized 0..1 stream coordinates. */
export function normalizePointerPoint(
  event: { clientX: number; clientY: number },
  bounds: { left: number; top: number; width: number; height: number },
): AndroidPoint {
  const width = bounds.width > 0 ? bounds.width : 1
  const height = bounds.height > 0 ? bounds.height : 1
  return {
    x: clamp01((event.clientX - bounds.left) / width),
    y: clamp01((event.clientY - bounds.top) / height),
  }
}
