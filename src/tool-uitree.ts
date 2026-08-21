/**
 * Model-facing semantic UI tools: `android_ui_tree` dumps the frontmost
 * window's uiautomator view hierarchy (text, content-desc, resource-id,
 * class, pixel bounds, enabled/clickable/scrollable/focused flags) and
 * `android_tap_element` taps a node by IDENTITY — the agent reasons over real
 * UI semantics instead of guessing normalized coordinates off a screenshot.
 *
 * One backend, not two (docs/architecture.zh.md, decision 3): emulators and
 * physical devices both answer `adb shell uiautomator dump`, so there is no
 * WebDriverAgent/AXe split, no snapshot-depth ladder, and no helper to
 * install. The matching rules are the ones the dsh-ios twin proved out —
 * exact selector match first, then case-insensitive contains, nested
 * duplicates collapsed into one containment chain, an off-screen/disabled
 * gate before any tap, and an ambiguity error that LISTS the candidates —
 * they just read Android's resource-id / text / content-desc instead of iOS's
 * identifier / label (see uitree.ts, `resolveTapTarget`).
 *
 * After the tap the tool settles ~300 ms and captures a fresh screenshot with
 * exactly the same summary and presentationMeta shape as `android_interact`,
 * so the effect is visible in the transcript. `expect_text` / `expect_gone`
 * turn a tap and its verification into ONE round trip by polling the OCR path
 * (ocr-backend.ts) for up to ~4 s — the model should never screenshot-and-
 * compare pixels to find out whether a tap landed.
 *
 * This module also owns the plumbing the sibling tool modules share: the
 * screenshot store (a twin of the one in tools.ts, writing into the same
 * `stream-access.screenshotDir()` so every capture can be granted a signed
 * URL), the device summary + JSON schemas, and the OCR poll helpers.
 * @module @zseven-w/dsh-android/tool-uitree
 */

import {
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AndroidDevice } from './adb.js'
import {
  ensureOcrBinary,
  execOcr,
  filterOcrItems,
  parseOcrOutput,
  type OcrItem,
} from './ocr-backend.js'
import {
  UI_TREE_TRUNCATED_HINT,
  boundsCenter,
  buildCompactTree,
  capTreeToBytes,
  countNodes,
  hasLabeledNode,
  readUiTree,
  resolveTapTarget,
  screenBoundsOf,
  type UiBounds,
  type UiTreeNode,
  type UiTreeToolchain,
} from './uitree.js'

/** Registered UI tool names, in registration order. */
export const ANDROID_UI_TOOL_NAMES = ['android_ui_tree', 'android_tap_element'] as const

/** Settle delay after a tap, before the effect screenshot. */
export const TAP_SETTLE_MS = 300

/**
 * Poll budget (ms) for a tap tool's `expect_text` / `expect_gone` assertion.
 * One capture+OCR round trip costs ~0.6–1 s on an emulator, so 4000 ms allows
 * a couple of polls without turning a tap into another full android_wait_for.
 */
export const TAP_EXPECTATION_BUDGET_MS = 4000

/** Interval between OCR polls (screencap + Vision, ~0.6 s per round trip). */
export const OCR_POLL_INTERVAL_MS = 600

/**
 * The subset of `AndroidHostController` every tool module here consumes.
 * Declaring it structurally keeps the smoke able to inject a fake host
 * without a device (the DI seam the dsh-ios tools use for `SimHostController`).
 */
export interface AndroidToolHost {
  toolchain: UiTreeToolchain
  /** Explicit serial → streamed device → the only online device, else throw. */
  resolveTarget(serial?: string): Promise<AndroidDevice>
  /** Tap at normalized 0..1 coordinates of the current frame. */
  tap(serial: string, x: number, y: number): Promise<void>
  /** Capture a fresh PNG, independent of the stream loop. */
  screenshot(serial: string): Promise<{ png: Buffer; width?: number; height?: number }>
}

/** Device summary carried by every tool result and presentationMeta. */
export interface AndroidDeviceInfo {
  serial: string
  name?: string
  androidVersion?: string
  state: string
}

export interface AndroidUiToolsOptions {
  /** Plugin-owned cache root for screenshots (default `<tmp>/dsh-android`). */
  cacheDir?: string
}

/** The two `android_ui_*` tool definitions bound to one host controller. */
export interface AndroidUiTools {
  androidUiTree: ToolDefinition
  androidTapElement: ToolDefinition
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/**
 * Flatten negative zero. `-0` does NOT survive a JSON round trip
 * (`stringify` writes `0`), so DSH's lossless boundary would reject the WHOLE
 * tool result rather than the one coordinate. Every rounded number these
 * modules emit goes through here.
 */
export function losslessNumber(value: number): number {
  return value === 0 ? 0 : value
}

export function round2(value: number): number {
  return losslessNumber(Math.round(value * 100) / 100)
}

/** Normalized coordinates are reported at 4 decimals (sub-pixel on any phone). */
export function round4(value: number): number {
  return losslessNumber(Math.round(value * 10_000) / 10_000)
}

export function renderJson(_args: unknown, value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Compact summary of one adb device row (no extra round trip). */
export function deviceSummaryOf(device: AndroidDevice): AndroidDeviceInfo {
  return {
    serial: device.serial,
    ...(device.model === undefined ? {} : { name: device.model }),
    state: device.state,
  }
}

/** Shared device object schema — one stable shape across every tool. */
export const deviceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serial: { type: 'string', required: true },
    name: { type: 'string' },
    androidVersion: { type: 'string' },
    state: { type: 'string', required: true },
  },
} as const

/** A box in display pixels (bounds and row frames share the shape). */
export const boundsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    w: { type: 'number', required: true },
    h: { type: 'number', required: true },
  },
} as const

export const pointSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
  },
} as const

export const sizeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
  },
} as const

export const expectedSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    mode: { type: 'string', required: true, enum: ['appear', 'disappear'] },
    matched: { type: 'boolean', required: true },
    waitedMs: { type: 'integer', required: true },
  },
} as const

// ── screenshot store (twin of the one in tools.ts) ───────────────────────────

/**
 * Stable per-device screenshot paths, in the SAME directory the panel capture
 * route serves: `<cacheDir>/screenshots/screenshot-<serial>-<n>.png`, where
 * the default `cacheDir` makes that exactly `stream-access.screenshotDir()`.
 * Three independent counters share that directory (this store, the twin in
 * tools.ts, and the capture route), so a name that already exists on disk is
 * skipped — a later writer can never overwrite a capture whose signed URL is
 * still live.
 */
export class ScreenshotStore {
  readonly #root: string
  #next = new Map<string, number>()

  constructor(cacheDir: string) {
    this.#root = join(cacheDir, 'screenshots')
  }

  nextPath(serial: string): string {
    mkdirSync(this.#root, { recursive: true })
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

/** Read PNG dimensions from the IHDR chunk (best effort, 24-byte header). */
export function readPngSize(path: string): { width: number; height: number } | undefined {
  try {
    const fd = openSync(path, 'r')
    try {
      const header = Buffer.alloc(24)
      if (readSync(fd, header, 0, 24, 0) !== 24) return undefined
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const isPng = header.subarray(0, 8).equals(pngSignature)
      const isIhdr = header.subarray(12, 16).toString('ascii') === 'IHDR'
      if (!isPng || !isIhdr) return undefined
      return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

/** One captured screenshot, in the summary shape every visual tool returns. */
export interface ScreenshotCapture {
  path: string
  bytes: number
  width?: number
  height?: number
  device: AndroidDeviceInfo
}

/** Capture one screenshot into the store (same summary as android_screenshot). */
export async function captureScreenshot(
  tool: string,
  store: ScreenshotStore,
  host: AndroidToolHost,
  device: AndroidDevice,
): Promise<ScreenshotCapture> {
  let shot: { png: Buffer; width?: number; height?: number }
  try {
    shot = await host.screenshot(device.serial)
  } catch (error) {
    throw new Error(`${tool}: the screencap of ${device.serial} failed: ${errorMessage(error)}`)
  }
  const path = store.nextPath(device.serial)
  try {
    writeFileSync(path, shot.png)
  } catch (error) {
    throw new Error(`${tool}: could not write the screenshot to ${path}: ${errorMessage(error)}`)
  }
  const bytes = statSync(path).size
  const size = readPngSize(path)
    ?? (shot.width !== undefined && shot.height !== undefined ? { width: shot.width, height: shot.height } : undefined)
  return {
    path,
    bytes,
    ...(size === undefined ? {} : { width: size.width, height: size.height }),
    device: deviceSummaryOf(device),
  }
}

/** Screenshot presentation envelope — identical across every visual tool. */
export function screenshotMeta(value: unknown): JsonValue {
  const result = value as { path: string; device: AndroidDeviceInfo }
  return {
    kind: 'android-screenshot',
    screenshotPath: result.path,
    path: result.path,
    device: { ...result.device },
  }
}

// ── OCR poll helpers (shared with tool-ocr.ts and the tap expectations) ──────

/** The optional post-tap outcome assertion (expect_text / expect_gone). */
export interface OcrExpectationResult {
  text: string
  mode: 'appear' | 'disappear'
  matched: boolean
  waitedMs: number
}

/** One poll cycle's answer, shared by android_wait_for and the tap tools. */
export interface OcrPollOutcome {
  matched: boolean
  waitedMs: number
  /** The matched OCR item, in image PIXELS. */
  item?: OcrItem
}

/** Resolve the compiled Vision helper and OCR one PNG into parsed items. */
export async function runOcr(
  tool: string,
  imagePath: string,
  deviceLabel: string,
  signal?: AbortSignal,
): Promise<OcrItem[]> {
  const binary = await ensureOcrBinary()
  if (!binary.available) {
    throw new Error(
      `${tool}: the Vision OCR helper is unavailable`
      + `${binary.reason === undefined ? '' : ` (${binary.reason})`}; ${binary.installHint}`,
    )
  }
  try {
    return parseOcrOutput((await execOcr(binary, imagePath, signal)).stdout)
  } catch (error) {
    throw new Error(`${tool}: OCR failed for ${deviceLabel}: ${errorMessage(error)}`)
  }
}

/** One capture+OCR round trip: items plus the screenshot's pixel size. */
export interface OcrSnapshot {
  items: OcrItem[]
  pixelSize: { width: number; height: number }
  path: string
  bytes: number
  device: AndroidDeviceInfo
}

/** Screenshot pixel size is REQUIRED for OCR coordinate math. */
export function requirePixelSize(shot: ScreenshotCapture, tool: string): { width: number; height: number } {
  if (typeof shot.width !== 'number' || typeof shot.height !== 'number' || shot.width <= 0 || shot.height <= 0) {
    throw new Error(
      `${tool}: could not determine the screenshot pixel size of ${shot.device.serial} (unreadable PNG header) — `
      + 're-run android_screenshot to confirm the device is producing frames',
    )
  }
  return { width: shot.width, height: shot.height }
}

/** The shared capture+OCR pipeline (`android_find_text`'s, reused everywhere). */
export async function readOcrOnce(
  tool: string,
  store: ScreenshotStore,
  host: AndroidToolHost,
  device: AndroidDevice,
  signal?: AbortSignal,
): Promise<OcrSnapshot> {
  const shot = await captureScreenshot(tool, store, host, device)
  const pixelSize = requirePixelSize(shot, tool)
  const items = await runOcr(tool, shot.path, shot.device.serial, signal)
  return { items, pixelSize, path: shot.path, bytes: shot.bytes, device: shot.device }
}

/** True when any OCR item matches the text (exact first, then contains). */
export function ocrTextPresent(items: readonly OcrItem[], text: string): OcrItem | undefined {
  const exact = items.find(item => item.text === text)
  if (exact !== undefined) return exact
  const needle = text.toLowerCase()
  return items.find(item => item.text.toLowerCase().includes(needle))
}

/**
 * Poll the OCR path until `text` appears or disappears (or the budget runs
 * out). One shared helper for `android_wait_for` and the tap tools'
 * `expect_text` / `expect_gone` assertions — a timeout is a normal
 * `matched: false`, never a throw. `read` is the injectable capture+OCR seam
 * (the tools pass a closure over `readOcrOnce`; the smoke passes a stub).
 */
export async function pollForText(
  read: () => Promise<readonly OcrItem[]>,
  text: string,
  mode: 'appear' | 'disappear',
  timeoutMs: number,
  intervalMs: number,
  minConfidence: number,
  signal?: AbortSignal,
): Promise<OcrPollOutcome> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  for (;;) {
    const items = filterOcrItems(await read(), text, minConfidence)
    const present = ocrTextPresent(items, text)
    const matched = mode === 'appear' ? present !== undefined : present === undefined
    const waitedMs = Date.now() - startedAt
    if (matched) {
      return mode === 'appear' && present !== undefined
        ? { matched: true, waitedMs, item: present }
        : { matched: true, waitedMs }
    }
    if (signal?.aborted === true || Date.now() >= deadline) {
      return { matched: false, waitedMs }
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  }
}

/** Which expectation the tap args carry, or undefined when absent. */
export function tapExpectation(
  args: { expect_text?: string; expect_gone?: string },
): { text: string; mode: 'appear' | 'disappear' } | undefined {
  const expectText = typeof args.expect_text === 'string' && args.expect_text.trim() !== '' ? args.expect_text.trim() : undefined
  const expectGone = typeof args.expect_gone === 'string' && args.expect_gone.trim() !== '' ? args.expect_gone.trim() : undefined
  if (expectText !== undefined && expectGone !== undefined) {
    throw new Error('pass expect_text OR expect_gone, not both — they assert opposite outcomes')
  }
  if (expectText !== undefined) return { text: expectText, mode: 'appear' }
  if (expectGone !== undefined) return { text: expectGone, mode: 'disappear' }
  return undefined
}

/** The tap tools' post-settle outcome assertion, via the shared poll helper. */
export async function runTapExpectation(
  tool: string,
  store: ScreenshotStore,
  host: AndroidToolHost,
  device: AndroidDevice,
  text: string,
  mode: 'appear' | 'disappear',
  signal?: AbortSignal,
): Promise<OcrExpectationResult> {
  const outcome = await pollForText(
    () => readOcrOnce(tool, store, host, device, signal).then(snapshot => snapshot.items),
    text,
    mode,
    TAP_EXPECTATION_BUDGET_MS,
    OCR_POLL_INTERVAL_MS,
    0,
    signal,
  )
  return { text, mode, matched: outcome.matched, waitedMs: outcome.waitedMs }
}

// ── result shapes ────────────────────────────────────────────────────────────

export interface AndroidUiTreeResult {
  device: AndroidDeviceInfo
  /** Display size in pixels, taken from the hierarchy root bounds. */
  screen: { width: number; height: number }
  /** Number of nodes in the returned (possibly pruned) tree. */
  nodeCount: number
  /** True when the 40 KB cap pruned the deepest levels. */
  truncated?: boolean
  /** Guidance: why the read looks the way it does, and what to do next. */
  hint?: string
  /** Compact node tree (recursive; JSON-object typed for the canonical value). */
  tree: Array<Record<string, JsonValue>>
}

export interface AndroidTapElementResult {
  action: 'tap-element'
  element: {
    type: string
    text?: string
    contentDesc?: string
    resourceId?: string
    bounds: UiBounds
  }
  /** Tapped point in display pixels. */
  center: { x: number; y: number }
  /** The normalized 0..1 coordinates actually sent to the device. */
  tap: { x: number; y: number }
  /** Outcome assertion (expect_text/expect_gone), when requested. */
  expected?: OcrExpectationResult
  path: string
  bytes: number
  width?: number
  height?: number
  device: AndroidDeviceInfo
}

/** The case-(c) hint: a deep unfiltered read with no labels at all. */
export const OCR_FALLBACK_HINT = 'The view hierarchy carries no text and no content-desc at all, so this screen '
  + 'exposes no accessibility information (Compose without semantics, Flutter, a WebView, a game surface, or a '
  + 'video/SurfaceView) — run android_find_text to OCR the screen instead.'

/** Case (a): a filter matched nothing — a property of the filter, not the app. */
function filterMissHint(filter: string): string {
  return `The filter ${JSON.stringify(filter)} matched nothing in the dump. A filter miss says nothing about `
    + 'the app — only that no matching node is in what was returned. Re-run WITHOUT a filter to see what is '
    + 'actually there.'
}

/** Case (b): the output cap pruned the deepest levels, so labels may be missing. */
function capPrunedUnlabeledHint(): string {
  return 'The tree was pruned to fit the output cap, so the surviving levels carry no labels — the labeled '
    + 'nodes may sit in the levels that were dropped. Re-run with a smaller max_depth or a filter to narrow '
    + 'the subtree before concluding anything about the app.'
}

/**
 * Assemble one `android_ui_tree` result: compact build (filter/max_depth) →
 * ~40 KB cap → node count and a hint computed from what was actually
 * RETURNED. An unlabeled read is attributed to one of three causes — the
 * filter, the cap, or the app itself — and only the third is ever reported as
 * "this screen exposes no accessibility information" (the WP63 discipline the
 * dsh-ios twin established).
 */
export function buildTreeResult(
  roots: readonly UiTreeNode[],
  screen: { width: number; height: number },
  device: AndroidDeviceInfo,
  args: { max_depth?: number; filter?: string },
): AndroidUiTreeResult {
  const built = buildCompactTree(roots, args.max_depth, args.filter)
  const capped = capTreeToBytes(built.tree)
  const nodeCount = capped.tree.reduce((count, node) => count + countNodes(node), 0)
  const hints: string[] = []
  if (capped.truncated) hints.push(UI_TREE_TRUNCATED_HINT)
  const filterText = args.filter !== undefined ? args.filter.trim() : ''
  if (filterText !== '' && built.count === 0) {
    hints.push(filterMissHint(filterText))
  } else if (!hasLabeledNode(capped.tree)) {
    if (capped.truncated) hints.push(capPrunedUnlabeledHint())
    else hints.push(OCR_FALLBACK_HINT)
  }
  return {
    device,
    screen: { width: round2(screen.width), height: round2(screen.height) },
    nodeCount,
    ...(capped.truncated ? { truncated: true } : {}),
    ...(hints.length > 0 ? { hint: hints.join(' ') } : {}),
    tree: capped.tree as unknown as Array<Record<string, JsonValue>>,
  }
}

/** Recursive node schema is not expressible here; children stay open objects. */
const treeNodeSchema = {
  type: 'object',
  additionalProperties: true,
} as const

/** Create the two `android_ui_*` tool definitions bound to one host. */
export function createAndroidUiTools(host: AndroidToolHost, options: AndroidUiToolsOptions = {}): AndroidUiTools {
  const cacheDir = options.cacheDir ?? join(tmpdir(), 'dsh-android')
  const screenshots = new ScreenshotStore(cacheDir)

  const androidUiTree = defineTool({
    name: 'android_ui_tree',
    description: 'Dump the frontmost window\'s view hierarchy on a connected Android device or emulator '
      + '(uiautomator over plain adb — no helper to install, identical on emulators and phones): every node\'s '
      + 'class (as a short type), text, content-desc, resource-id, and bounds in DISPLAY PIXELS. Use this to '
      + 'find a control by identity and tap it with android_tap_element instead of guessing coordinates off a '
      + 'screenshot. Flags are reported only in their interesting state: enabled appears ONLY when the control '
      + 'is disabled, and focused/clickable/scrollable only when true — an absent flag means enabled / not '
      + 'focused / not clickable / not scrollable. The result also carries the display size in pixels so '
      + 'positions can be reasoned about. Output is capped at ~40 KB: when exceeded, the deepest levels are '
      + 'pruned and truncated=true is set — narrow with max_depth or filter in that case. When the returned '
      + 'tree has no labels at all the hint says WHY: the filter matched nothing, the cap dropped the labeled '
      + 'levels, or the screen genuinely exposes no accessibility information (Compose without semantics, '
      + 'Flutter, a WebView, or a game/video surface) — only the last points at android_find_text. Scrolling '
      + 'lists aggregate each item into one row subtree: use android_ui_rows to enumerate them and '
      + 'android_tap_row to operate inside one.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices (e.g. "emulator-5554" or a USB serial). '
          + 'Defaults to the currently streamed device, else the only connected one.',
      },
      max_depth: {
        type: 'integer',
        description: 'Maximum nesting depth to include (0 = the window roots only). Useful to shrink a large '
          + 'hierarchy — Android view trees are commonly 15–30 levels deep because of layout wrappers.',
      },
      filter: {
        type: 'string',
        description: 'Case-insensitive substring matched against a node\'s text, content-desc, resource-id or '
          + 'type. Matching nodes and their ancestors are kept, everything else is pruned.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          screen: { ...sizeSchema, required: true },
          nodeCount: { type: 'integer', required: true },
          truncated: { type: 'boolean' },
          hint: { type: 'string' },
          tree: { type: 'array', required: true, items: treeNodeSchema },
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => true,
    async execute(args: { serial?: string; max_depth?: number; filter?: string }) {
      const device = await host.resolveTarget(args.serial)
      let roots: UiTreeNode[]
      try {
        roots = (await readUiTree(host.toolchain, device.serial)).roots
      } catch (error) {
        throw new Error(`android_ui_tree: ${errorMessage(error)}`)
      }
      return buildTreeResult(roots, screenBoundsOf(roots), deviceSummaryOf(device), args)
    },
    presentCall: (args: { serial?: string }) => ({
      card: 'generic',
      title: args.serial === undefined ? 'Inspect Android UI tree' : `Inspect UI tree of ${args.serial}`,
      kind: 'execute',
    }),
  })

  const androidTapElement = defineTool({
    name: 'android_tap_element',
    description: 'Tap a view on a connected Android device or emulator by IDENTITY instead of raw '
      + 'coordinates: identifier matches the resource-id, label matches the text OR the content-desc '
      + '(Android splits what one accessibility label holds elsewhere, so one selector covers both). The '
      + 'selector matches exactly first, then case-insensitively as a substring. Nested duplicates — a list '
      + 'row mirroring its text onto a child TextView inside a clickable container — collapse to ONE target, '
      + 'the outermost clickable node of that chain; if several distinct nodes still match, the error lists '
      + 'every candidate with its text, resource-id and bounds. Only on-screen, enabled nodes are tapped: '
      + 'when the only match is scrolled out of view or disabled the tool FAILS with an actionable message '
      + 'instead of tapping dead coordinates (allow_offscreen=true taps an off-screen match anyway; disabled '
      + 'nodes always refuse). The tap lands on the node center, then after ~300 ms a fresh screenshot is '
      + 'captured with the same summary shape as android_interact. To CONFIRM the tap landed, pass expect_text '
      + '(text that should appear) or expect_gone (text that should disappear) — the tool polls the screen OCR '
      + 'for ~4 s and reports expected.matched in the SAME call. Do NOT screenshot-and-compare pixels to check '
      + 'whether a tap worked; use these assertions instead.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices. Defaults to the currently streamed device, '
          + 'else the only connected one.',
      },
      identifier: {
        type: 'string',
        description: 'resource-id to match, e.g. "com.android.settings:id/search_action_bar" (the ":id/name" '
          + 'tail is usually enough as a substring). Exact match first, then case-insensitive substring.',
      },
      label: {
        type: 'string',
        description: 'Visible text or content-desc to match, e.g. "Network & internet". Exact match first, '
          + 'then case-insensitive substring. Icon-only buttons carry a content-desc but no text.',
      },
      allow_offscreen: {
        type: 'boolean',
        description: 'Allow tapping a node whose bounds lie outside the screen (a recycled list row that '
          + 'uiautomator still reports) — the tap lands at the recorded coordinates whatever is displayed '
          + 'there. Default false: such a match fails with a scroll-it-into-view error. Disabled nodes are '
          + 'always refused, regardless of this flag.',
      },
      expect_text: {
        type: 'string',
        description: 'Optional text that should APPEAR after the tap. The tool polls screen OCR for up to '
          + '~4 s and reports expected.matched — one round trip instead of tap + screenshot + manual compare.',
      },
      expect_gone: {
        type: 'string',
        description: 'Optional text that should DISAPPEAR after the tap. Mutually exclusive with expect_text; '
          + 'reported as expected.matched (true = the text is gone).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, const: 'tap-element' },
          element: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              type: { type: 'string', required: true },
              text: { type: 'string' },
              contentDesc: { type: 'string' },
              resourceId: { type: 'string' },
              bounds: { ...boundsSchema, required: true },
            },
          },
          center: { ...pointSchema, required: true },
          tap: { ...pointSchema, required: true },
          expected: expectedSchema,
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer' },
          height: { type: 'integer' },
          device: { ...deviceSchema, required: true },
        },
      },
      render: renderJson,
      presentationMeta: (_args: unknown, value: JsonValue): JsonValue => screenshotMeta(value),
    },
    timeoutMs: 180_000,
    async execute(args: {
      serial?: string
      identifier?: string
      label?: string
      allow_offscreen?: boolean
      expect_text?: string
      expect_gone?: string
    }, exec) {
      const expectation = tapExpectation(args)
      const device = await host.resolveTarget(args.serial)
      let roots: UiTreeNode[]
      try {
        roots = (await readUiTree(host.toolchain, device.serial)).roots
      } catch (error) {
        throw new Error(`android_tap_element: ${errorMessage(error)}`)
      }
      const { node } = resolveTapTarget(roots, { identifier: args.identifier, label: args.label }, {
        allowOffscreen: args.allow_offscreen === true,
        tool: 'android_tap_element',
      })
      const screen = screenBoundsOf(roots)
      if (screen.width <= 0 || screen.height <= 0) {
        throw new Error(
          'android_tap_element: the dump reported a zero-size display, so a tap cannot be placed — '
          + 're-run android_ui_tree once the screen is on and settled',
        )
      }
      const center = boundsCenter(node.bounds)
      // Pixel center → normalized 0..1 of the SAME display space the stream
      // and `input tap` share (docs/contract.zh.md: no rotation inverse).
      const tap = { x: round4(center.x / screen.width), y: round4(center.y / screen.height) }
      try {
        await host.tap(device.serial, tap.x, tap.y)
      } catch (error) {
        throw new Error(`android_tap_element: the tap at (${center.x}, ${center.y}) px failed: ${errorMessage(error)}`)
      }
      await sleep(TAP_SETTLE_MS)
      const screenshot = await captureScreenshot('android_tap_element', screenshots, host, device)
      const expected = expectation === undefined
        ? undefined
        : await runTapExpectation('android_tap_element', screenshots, host, device, expectation.text, expectation.mode, exec.signal)
      return {
        action: 'tap-element',
        element: {
          type: node.type,
          ...(node.text === undefined ? {} : { text: node.text }),
          ...(node.contentDesc === undefined ? {} : { contentDesc: node.contentDesc }),
          ...(node.resourceId === undefined ? {} : { resourceId: node.resourceId }),
          bounds: { ...node.bounds },
        },
        center,
        tap,
        ...screenshot,
        ...(expected === undefined ? {} : { expected }),
      } satisfies AndroidTapElementResult
    },
    presentCall: (args: { identifier?: string; label?: string }) => ({
      card: 'generic',
      title: `Tap element ${args.label ?? args.identifier ?? ''}`,
      kind: 'execute',
      rawInput: {
        ...(args.identifier === undefined ? {} : { identifier: args.identifier }),
        ...(args.label === undefined ? {} : { label: args.label }),
      },
    }),
  })

  return { androidUiTree, androidTapElement }
}
