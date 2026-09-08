/**
 * Host-independent Android QA backend for dsh-android.
 *
 * This module is the QA-facing driver: a small, serial-explicit device surface
 * (discover / launchApp / observe / tap / type / scroll / key / screenshot /
 * dispose) that the QA wrapper (repo dsh-qa) drives against a real emulator or
 * USB device. It REUSES the plugin's existing adb toolchain, launch helper,
 * UI-tree parser and host text/button helpers — there is no second adb
 * implementation here.
 *
 * Host independence: this file and everything it imports (adb.ts, uitree.ts,
 * android-host.ts, build-run.ts, frame-source.ts) depend only on Node builtins.
 * Importing "@zseven-w/dsh-android/driver" therefore never loads
 * "@deepseek-ai/cordis", "@deepseek-ai/dsh-tools", or the plugin entry.
 *
 * Coordinate contract (declare it to the adapter): tap() and scroll() use
 * DISPLAY PIXELS, origin top-left — the same space as the uiautomator "bounds"
 * and this module's observe() frame/screen. The plugin host's
 * AndroidHostController.tap/drag surface is normalized 0..1 and is
 * intentionally NOT routed through here, so QA pixel coordinates from
 * observe() need no transform. observe() returns screen (pixels) and
 * coordinateSpace: "display-pixels".
 *
 * @module @zseven-w/dsh-android/qa-driver
 */

import { AdbError, AdbToolchain, type AdbBinary, type AndroidDevice, type AndroidDeviceDetails } from './adb.js'
import { ANDROID_BUTTONS, escapeInputText, isInputTextSafe, NON_ASCII_TYPE_HINT } from './android-host.js'
import { launchPackage, launchPackageCommand } from './build-run.js'
import { pngDimensions } from './frame-source.js'
import {
  UI_TREE_CAP_BYTES,
  buildCompactTree,
  capTreeToBytes,
  countNodes,
  readUiTree,
  screenBoundsOf,
  type UiTreeNode,
} from './uitree.js'

const DEFAULT_TIMEOUT_MS = 30_000
const SCROLL_BAND_MIN = 0.08
const SCROLL_BAND_MAX = 0.92
const SCROLL_DURATION_MS = 300
const SCROLL_DEFAULT_AMOUNT = 0.6

/** Coordinate space this backend declares for tap/scroll/observe. */
export const ANDROID_QA_COORDINATE_SPACE = 'display-pixels' as const

/**
 * The toolchain slice the driver needs. AdbToolchain satisfies it
 * structurally, and QA can inject a plain object fake for the routing tests.
 */
export interface AndroidQaToolchain {
  readonly available: boolean
  requireAdb(): string
  listDevices(): Promise<AndroidDevice[]>
  onlineDevices(): Promise<AndroidDevice[]>
  deviceDetails(device: AndroidDevice): Promise<AndroidDeviceDetails>
  screenSize(serial: string): Promise<{ width: number; height: number }>
  shell(
    serial: string,
    command: readonly string[],
    options?: { timeoutMs?: number; maxBuffer?: number; signal?: AbortSignal },
  ): Promise<string>
  execOut(
    serial: string,
    command: readonly string[],
    options?: { timeoutMs?: number; maxBuffer?: number; signal?: AbortSignal },
  ): Promise<Buffer>
}

export type AndroidQaDeviceState = AndroidDevice['state']

/** One device as discover() reports it (the listing row plus best-effort getprop). */
export interface AndroidQaDevice {
  serial: string
  state: AndroidQaDeviceState
  emulator: boolean
  model?: string
  product?: string
  transportId?: string
  manufacturer?: string
  androidVersion?: string
  sdk?: number
  avdName?: string
}

/** Current foreground app, read from real adb state. "raw" is the matched line. */
export interface AndroidQaForeground {
  packageName?: string
  activity?: string
  raw: string
}

/** A node frame in display pixels, origin top-left. */
export interface AndroidQaFrame {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One QA-facing view node. "password" marks a secure/password text field whose
 * text/content-desc/name are withheld (omitted) in this result.
 */
export interface AndroidQaNode {
  role: string
  className: string
  resourceId?: string
  name?: string
  text?: string
  contentDesc?: string
  frame: AndroidQaFrame
  enabled: boolean
  focused: boolean
  clickable: boolean
  scrollable: boolean
  password: boolean
  packageName?: string
  children: AndroidQaNode[]
}

export interface AndroidQaObserveResult {
  serial: string
  /** Foreground package name, when foregroundApp() resolved one. */
  packageName?: string
  foreground?: AndroidQaForeground
  /** A foreground read failure is surfaced here, never a silent empty app identity. */
  readError?: string
  /** Display size in pixels (the tap/scroll coordinate space). */
  screen: { width: number; height: number }
  coordinateSpace: 'display-pixels'
  rotation?: number
  nodes: AndroidQaNode[]
  nodeCount: number
  truncated: boolean
  budgetBytes: number
}

export interface AndroidQaObserveOptions {
  timeoutMs?: number
  signal?: AbortSignal
  maxDepth?: number
  filter?: string
  capBytes?: number
}

export interface AndroidQaLaunchResult {
  serial: string
  packageName: string
  /** The monkey invocation that was issued. */
  command: string[]
  /** Raw monkey output — an honest receipt, NOT a success claim. */
  output: string
}

export interface AndroidQaScreenshot {
  serial: string
  png: Buffer
  width?: number
  height?: number
}

export type AndroidQaScrollDirection = 'up' | 'down' | 'left' | 'right'

export interface AndroidQaOptions {
  /** adb executable path, or a pre-resolved binary. Defaults to resolveAdbBinary(). */
  adb?: string | AdbBinary
  /** Injected toolchain (real or fake); wins over "adb". */
  toolchain?: AndroidQaToolchain
  /** Default per-operation timeout (default 30_000). */
  timeoutMs?: number
  /** Master cancellation: aborts in-flight and future calls. */
  signal?: AbortSignal
}

export interface AndroidQaOperationOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface AndroidQaBackend {
  readonly disposed: boolean
  readonly toolchain: AndroidQaToolchain
  discover(): Promise<AndroidQaDevice[]>
  foregroundApp(serial: string, options?: AndroidQaOperationOptions): Promise<AndroidQaForeground>
  launchApp(serial: string, packageName: string, options?: AndroidQaOperationOptions): Promise<AndroidQaLaunchResult>
  observe(serial: string, options?: AndroidQaObserveOptions): Promise<AndroidQaObserveResult>
  tap(serial: string, x: number, y: number, options?: AndroidQaOperationOptions): Promise<void>
  type(serial: string, text: string, options?: AndroidQaOperationOptions): Promise<void>
  scroll(serial: string, direction: AndroidQaScrollDirection, amount?: number, options?: AndroidQaOperationOptions): Promise<void>
  key(serial: string, key: string, options?: AndroidQaOperationOptions): Promise<void>
  screenshot(serial: string, options?: AndroidQaOperationOptions): Promise<AndroidQaScreenshot>
  dispose(): Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireSerial(serial: string): void {
  if (typeof serial !== 'string' || serial.trim() === '') {
    throw new TypeError('dsh-android: a device serial is required — the QA backend never selects a device implicitly')
  }
}

function binaryFromPath(command: string): AdbBinary {
  return { available: true, source: 'env', command }
}

function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return AbortSignal.any(present)
}

function clampBand(value: number): number {
  return Math.min(SCROLL_BAND_MAX, Math.max(SCROLL_BAND_MIN, value))
}

/** A display rectangle/geometry in display pixels. */
interface QaSize {
  width: number
  height: number
}

function isUsableSize(size: QaSize | undefined): boolean {
  return size !== undefined && Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width > 0 && size.height > 0
}

/**
 * Surface.ROTATION_1 (landscape/right) and ROTATION_3 (landscape/left) put the
 * display in the swapped orientation relative to `wm size`'s natural/override
 * geometry. ROTATION_0 and ROTATION_2 keep the natural dimensions.
 */
function isKnownRotation(rotation: number | undefined): rotation is 0 | 1 | 2 | 3 {
  return rotation === 0 || rotation === 1 || rotation === 2 || rotation === 3
}

function orientedDisplaySize(natural: QaSize, rotation: 0 | 1 | 2 | 3): QaSize {
  return rotation === 1 || rotation === 3
    ? { width: natural.height, height: natural.width }
    : { width: natural.width, height: natural.height }
}

/**
 * Identify the orientation-aware display geometry from one FRESH UI-tree dump.
 * `screenSize()` reports the natural (override-aware) orientation — it does not
 * rotate — so the tree's own `rotation` attribute is applied here. When that
 * rotation is missing/invalid the tree's live window roots (already in current
 * display pixels) are the honest evidence; only when neither is available do we
 * settle for the plain natural/override size.
 */
function displayGeometryOf(
  natural: QaSize | undefined,
  rotation: number | undefined,
  treeScreen: QaSize,
): QaSize {
  // Known rotation: the natural/override geometry is authoritative and mapped
  // through rotation (no double swap, no stale cached value).
  if (natural !== undefined && isUsableSize(natural) && isKnownRotation(rotation)) {
    return orientedDisplaySize({ width: natural.width, height: natural.height }, rotation)
  }
  // Missing/invalid rotation: the dump's live roots are the honest evidence —
  // they already live in current display pixels.
  if (treeScreen.width > 0 && treeScreen.height > 0) {
    return { width: treeScreen.width, height: treeScreen.height }
  }
  // Last resort: the only geometry we know is the natural one.
  if (natural !== undefined && natural.width > 0 && natural.height > 0) {
    return { width: natural.width, height: natural.height }
  }
  return { width: treeScreen.width, height: treeScreen.height }
}

/** One scroll's pixel swipe path; direction names the CONTENT (down = finger up). */
function scrollPixelPath(
  size: { width: number; height: number },
  direction: AndroidQaScrollDirection,
  amount: number,
): { fromX: number; fromY: number; toX: number; toY: number } {
  const vertical = direction === 'up' || direction === 'down'
  const anchor = 0.5
  const delta = (direction === 'down' || direction === 'right' ? -1 : 1) * amount
  const from = clampBand(anchor)
  const to = clampBand(from + delta)
  if (vertical) {
    return {
      fromX: Math.round(anchor * size.width),
      fromY: Math.round(from * size.height),
      toX: Math.round(anchor * size.width),
      toY: Math.round(to * size.height),
    }
  }
  return {
    fromX: Math.round(from * size.width),
    fromY: Math.round(anchor * size.height),
    toX: Math.round(to * size.width),
    toY: Math.round(anchor * size.height),
  }
}

/** The component token (pkg/activity) inside a Window{...} / ActivityRecord{...} record. */
function componentTokenFromRecord(line: string): string | undefined {
  const open = line.indexOf('{')
  if (open < 0) return undefined
  const close = line.indexOf('}', open + 1)
  const body = line.slice(open + 1, close < 0 ? line.length : close)
  for (const token of body.split(/\s+/)) {
    if (token !== '' && token.includes('/')) return token
  }
  return undefined
}

function parseComponent(token: string): { packageName: string; activity: string } | undefined {
  const slash = token.indexOf('/')
  if (slash <= 0 || slash >= token.length - 1) return undefined
  const packageName = token.slice(0, slash)
  const activityPart = token.slice(slash + 1)
  if (packageName === '' || activityPart === '') return undefined
  const activity = activityPart.startsWith('.') ? packageName + activityPart : activityPart
  return { packageName, activity }
}

function foregroundFromLine(line: string): AndroidQaForeground | undefined {
  const token = componentTokenFromRecord(line)
  if (token === undefined) return { raw: line }
  const parsed = parseComponent(token)
  if (parsed === undefined) return { raw: line }
  return { packageName: parsed.packageName, activity: parsed.activity, raw: line }
}

function findFocusLine(out: string, prefixes: readonly string[]): string | undefined {
  for (const raw of out.split('\n')) {
    const line = raw.trim()
    if (prefixes.some(prefix => line.startsWith(prefix))) return line
  }
  return undefined
}

/** Map one UiTreeNode to the QA-facing DTO, withholding password values. */
function toQaNode(node: UiTreeNode): AndroidQaNode {
  const password = node.password === true
  const text = password ? undefined : node.text
  const contentDesc = password ? undefined : node.contentDesc
  const name = text ?? contentDesc
  const qa: AndroidQaNode = {
    role: node.type,
    className: node.className ?? node.type,
    frame: { x: node.bounds.x, y: node.bounds.y, width: node.bounds.w, height: node.bounds.h },
    enabled: node.enabled !== false,
    focused: node.focused === true,
    clickable: node.clickable === true,
    scrollable: node.scrollable === true,
    password,
    children: node.children.map(toQaNode),
  }
  if (node.resourceId !== undefined) qa.resourceId = node.resourceId
  if (name !== undefined) qa.name = name
  if (text !== undefined) qa.text = text
  if (contentDesc !== undefined) qa.contentDesc = contentDesc
  if (node.packageName !== undefined) qa.packageName = node.packageName
  return qa
}

class AndroidQaBackendImpl implements AndroidQaBackend {
  readonly toolchain: AndroidQaToolchain
  #disposed = false
  readonly #ownedAbort = new AbortController()
  readonly #masterSignal: AbortSignal | undefined
  readonly #timeoutMs: number

  constructor(options: AndroidQaOptions = {}) {
    this.#masterSignal = options.signal
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (options.toolchain !== undefined) {
      this.toolchain = options.toolchain
    } else if (options.adb !== undefined) {
      this.toolchain = new AdbToolchain(typeof options.adb === 'string' ? binaryFromPath(options.adb) : options.adb)
    } else {
      this.toolchain = new AdbToolchain()
    }
  }

  get disposed(): boolean {
    return this.#disposed
  }

  async discover(): Promise<AndroidQaDevice[]> {
    this.#ensureUsable()
    const devices = await this.toolchain.listDevices()
    const result: AndroidQaDevice[] = []
    for (const device of devices) {
      const entry: AndroidQaDevice = {
        serial: device.serial,
        state: device.state,
        emulator: device.emulator,
        ...(device.model === undefined ? {} : { model: device.model }),
        ...(device.product === undefined ? {} : { product: device.product }),
        ...(device.transportId === undefined ? {} : { transportId: device.transportId }),
      }
      if (device.state === 'device') {
        const details = await this.toolchain.deviceDetails(device).catch(() => undefined)
        if (details !== undefined) {
          if (details.model !== undefined) entry.model = details.model
          if (details.manufacturer !== undefined) entry.manufacturer = details.manufacturer
          if (details.androidVersion !== undefined) entry.androidVersion = details.androidVersion
          if (details.sdk !== undefined) entry.sdk = details.sdk
          if (details.avdName !== undefined) entry.avdName = details.avdName
        }
      }
      result.push(entry)
    }
    return result
  }

  async foregroundApp(serial: string, options: AndroidQaOperationOptions = {}): Promise<AndroidQaForeground> {
    this.#ensureUsable()
    requireSerial(serial)
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    return this.#readForeground(serial, timeoutMs, signal)
  }

  async launchApp(serial: string, packageName: string, options: AndroidQaOperationOptions = {}): Promise<AndroidQaLaunchResult> {
    this.#ensureUsable()
    requireSerial(serial)
    if (typeof packageName !== 'string' || packageName.trim() === '') {
      throw new TypeError('dsh-android: launchApp requires a non-empty packageName')
    }
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    const command = launchPackageCommand(packageName)
    const output = await launchPackage(this.toolchain, serial, packageName, {
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })
    return { serial, packageName, command, output }
  }

  async observe(serial: string, options: AndroidQaObserveOptions = {}): Promise<AndroidQaObserveResult> {
    this.#ensureUsable()
    requireSerial(serial)
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    const capBytes = options.capBytes ?? UI_TREE_CAP_BYTES

    const parsed = await readUiTree(this.toolchain, serial, {
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })

    // `screenSize()` reports the natural/override orientation and never rotates.
    // The FRESH UI-tree dump just read above carries the current rotation
    // (0/2 natural, 1/3 swapped), so derive the live display geometry from the
    // two together. If rotation is missing the dump's own live roots remain the
    // honest evidence of the current display pixel space.
    const treeScreen = screenBoundsOf(parsed.roots)
    let natural: QaSize | undefined
    try {
      const size = await this.toolchain.screenSize(serial)
      if (isUsableSize(size)) natural = { width: size.width, height: size.height }
    } catch {
      // Fall back to the UI-tree evidence below (no geometry is fabricated).
    }
    const screen = displayGeometryOf(natural, parsed.rotation, treeScreen)

    let foreground: AndroidQaForeground | undefined
    let readError: string | undefined
    try {
      foreground = await this.#readForeground(serial, timeoutMs, signal)
    } catch (error) {
      readError = errorMessage(error)
    }

    const compact = buildCompactTree(parsed.roots, options.maxDepth, options.filter)
    const capped = capTreeToBytes(compact.tree, capBytes)
    const nodes = capped.tree.map(node => toQaNode(node))
    const nodeCount = capped.tree.reduce((sum, node) => sum + countNodes(node), 0)

    return {
      serial,
      ...(foreground?.packageName === undefined ? {} : { packageName: foreground.packageName }),
      ...(foreground === undefined ? {} : { foreground }),
      ...(readError === undefined ? {} : { readError }),
      screen,
      coordinateSpace: 'display-pixels',
      ...(isKnownRotation(parsed.rotation) ? { rotation: parsed.rotation } : {}),
      nodes,
      nodeCount,
      truncated: capped.truncated,
      budgetBytes: capBytes,
    }
  }

  async tap(serial: string, x: number, y: number, options: AndroidQaOperationOptions = {}): Promise<void> {
    this.#ensureUsable()
    requireSerial(serial)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('dsh-android: tap coordinates must be finite display-pixel numbers')
    }
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    await this.toolchain.shell(serial, ['input', 'tap', String(Math.round(x)), String(Math.round(y))], {
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async type(serial: string, text: string, options: AndroidQaOperationOptions = {}): Promise<void> {
    this.#ensureUsable()
    requireSerial(serial)
    if (typeof text !== 'string' || text === '') {
      throw new TypeError('dsh-android: type requires a non-empty text')
    }
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    const execOptions = { timeoutMs, ...(signal === undefined ? {} : { signal }) }
    if (isInputTextSafe(text)) {
      await this.toolchain.shell(serial, ['input', 'text', escapeInputText(text)], execOptions)
      return
    }
    const imes = await this.toolchain.shell(serial, ['ime', 'list', '-s'], execOptions).catch(() => '')
    if (!imes.includes('com.android.adbkeyboard')) {
      throw new AdbError('dsh-android: ' + NON_ASCII_TYPE_HINT, [])
    }
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    await this.toolchain.shell(serial, ['am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', encoded], execOptions)
  }

  async scroll(
    serial: string,
    direction: AndroidQaScrollDirection,
    amount?: number,
    options: AndroidQaOperationOptions = {},
  ): Promise<void> {
    this.#ensureUsable()
    requireSerial(serial)
    if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
      throw new RangeError('dsh-android: scroll direction must be "up", "down", "left" or "right" (naming the CONTENT)')
    }
    const fraction = amount ?? SCROLL_DEFAULT_AMOUNT
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new RangeError('dsh-android: scroll amount must be within 0..1')
    }
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    const execOptions = { timeoutMs, ...(signal === undefined ? {} : { signal }) }
    // A swipe must stay inside the CURRENT display space. `screenSize()` gives
    // the natural/override (never-rotating) geometry, so read a FRESH UI-tree
    // dump for its rotation attribute and derive the oriented size from the two
    // together — per-call, never cached, so a rotation that changed between two
    // scrolls cannot reuse stale coordinates.
    const parsed = await readUiTree(this.toolchain, serial, execOptions)
    const treeScreen = screenBoundsOf(parsed.roots)
    let natural: QaSize | undefined
    try {
      const size = await this.toolchain.screenSize(serial)
      if (isUsableSize(size)) natural = { width: size.width, height: size.height }
    } catch (error) {
      // Missing/invalid orientation or geometry is handled by displayGeometryOf:
      // the tree's live roots become the fallback evidence when rotation is not
      // available from the dump. Only when both paths fail do we err out with a
      // clear message instead of silently swiping in the wrong space.
      if (!isUsableSize(treeScreen)) {
        throw new AdbError(
          'dsh-android: cannot determine the display geometry of ' + serial
          + ' for an oriented scroll (`wm size`: ' + errorMessage(error)
          + '; the UI dump reported no usable window bounds). Wake and settle the device, then retry.',
          [],
        )
      }
    }
    const display = displayGeometryOf(natural, parsed.rotation, treeScreen)
    if (!isUsableSize(display)) {
      throw new AdbError(
        'dsh-android: cannot determine a usable display geometry of ' + serial
        + ' for an oriented scroll (wm size and UI-tree bounds both failed). Wake and settle the device, then retry.',
        [],
      )
    }
    const path = scrollPixelPath(display, direction, fraction)
    await this.toolchain.shell(serial, [
      'input', 'swipe',
      String(path.fromX), String(path.fromY), String(path.toX), String(path.toY), String(SCROLL_DURATION_MS),
    ], { timeoutMs: timeoutMs + SCROLL_DURATION_MS, ...(signal === undefined ? {} : { signal }) })
  }

  async key(serial: string, key: string, options: AndroidQaOperationOptions = {}): Promise<void> {
    this.#ensureUsable()
    requireSerial(serial)
    if (typeof key !== 'string' || key === '') {
      throw new TypeError('dsh-android: key requires a button name or a KEYCODE_* name')
    }
    const keycode = (ANDROID_BUTTONS as Record<string, string>)[key]
      ?? (/^KEYCODE_[A-Z0-9_]+$/.test(key) ? key : undefined)
    if (keycode === undefined) {
      throw new AdbError(
        'dsh-android: unknown key ' + JSON.stringify(key) + '; expected one of '
        + Object.keys(ANDROID_BUTTONS).join(', ') + ' or a KEYCODE_* name',
        [],
      )
    }
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    await this.toolchain.shell(serial, ['input', 'keyevent', keycode], {
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async screenshot(serial: string, options: AndroidQaOperationOptions = {}): Promise<AndroidQaScreenshot> {
    this.#ensureUsable()
    requireSerial(serial)
    const signal = this.#signalFor(options.signal)
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    const png = await this.toolchain.execOut(serial, ['screencap', '-p'], {
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })
    if (png.length === 0) {
      throw new AdbError('dsh-android: screencap produced no output', ['screencap', '-p'])
    }
    const size = pngDimensions(png)
    return { serial, png, ...(size === undefined ? {} : size) }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#ownedAbort.abort()
  }

  #ensureUsable(): void {
    if (this.#disposed) throw new Error('dsh-android: the QA backend is disposed')
    if (this.#ownedAbort.signal.aborted || this.#masterSignal?.aborted === true) {
      const error = new Error('dsh-android: the QA backend was cancelled')
      error.name = 'AbortError'
      throw error
    }
  }

  #signalFor(local: AbortSignal | undefined): AbortSignal | undefined {
    return combineSignals([this.#masterSignal, local, this.#ownedAbort.signal])
  }

  async #readForeground(serial: string, timeoutMs: number, signal: AbortSignal | undefined): Promise<AndroidQaForeground> {
    const execOptions = { timeoutMs, ...(signal === undefined ? {} : { signal }) }
    let windowFailure: string | undefined
    try {
      const out = await this.toolchain.shell(serial, ['dumpsys', 'window', 'windows'], execOptions)
      const line = findFocusLine(out, ['mCurrentFocus='])
      if (line !== undefined) {
        const parsed = foregroundFromLine(line)
        if (parsed !== undefined) return parsed
        return { raw: line }
      }
      windowFailure = 'no mCurrentFocus line in dumpsys window output'
    } catch (error) {
      windowFailure = errorMessage(error)
    }
    let activityFailure: string | undefined
    try {
      const out = await this.toolchain.shell(serial, ['dumpsys', 'activity', 'activities'], execOptions)
      const line = findFocusLine(out, ['topResumedActivity=', 'mResumedActivity:', 'ResumedActivity:'])
      if (line !== undefined) {
        const parsed = foregroundFromLine(line)
        if (parsed !== undefined) return parsed
        return { raw: line }
      }
      activityFailure = 'no resumed-activity line in dumpsys activity output'
    } catch (error) {
      activityFailure = errorMessage(error)
    }
    throw new AdbError(
      'dsh-android: could not read the foreground app of ' + serial
      + ' (dumpsys window: ' + windowFailure + '; dumpsys activity: ' + activityFailure + ')',
      [],
    )
  }
}

/** Create the host-independent Android QA backend. */
export function createAndroidQaBackend(options: AndroidQaOptions = {}): AndroidQaBackend {
  return new AndroidQaBackendImpl(options)
}
