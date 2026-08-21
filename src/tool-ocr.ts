/**
 * Vision-OCR tools: `android_find_text`, `android_tap_text`, `android_wait_for`.
 *
 * The uiautomator hierarchy (tool-uitree.ts) stays the primary observer; these
 * three cover what it cannot see. On Android that gap is wide and common:
 * Jetpack Compose without `semantics`, Flutter, React Native's older bridge,
 * WebView content behind one opaque node, Unity/Unreal game surfaces, and
 * anything drawn into a `SurfaceView` all dump as a single unlabeled box. OCR
 * reads them anyway, because its only input is the PNG that
 * `adb exec-out screencap` already produces.
 *
 * COORDINATES: exactly one space. The helper emits boxes in image pixels, the
 * screenshot IS the display, and `AndroidHostController.tap` takes normalized
 * 0..1 of that same frame — so a tap is `center / screenshot size`, with no
 * point/pixel scale factor and no rotation inverse anywhere (the frame follows
 * the display rotation; docs/contract.zh.md). Rects are therefore reported in
 * PIXELS and can be reasoned about directly against android_ui_tree bounds.
 *
 * `android_wait_for` polls the same capture+OCR pipeline; a timeout is a
 * normal `matched:false` answer, never an error, so it can gate an action on a
 * condition without the model looping android_find_text by hand.
 * @module @zseven-w/dsh-android/tool-ocr
 */

import {
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  filterOcrItems,
  pixelRectToNormalizedCenter,
  rectCenter,
  type OcrItem,
  type OcrRect,
} from './ocr-backend.js'
import {
  OCR_POLL_INTERVAL_MS,
  ScreenshotStore,
  TAP_SETTLE_MS,
  boundsSchema,
  captureScreenshot,
  deviceSchema,
  deviceSummaryOf,
  errorMessage,
  expectedSchema,
  losslessNumber,
  pointSchema,
  readOcrOnce,
  renderJson,
  requirePixelSize,
  round2,
  round4,
  runOcr,
  runTapExpectation,
  screenshotMeta,
  sizeSchema,
  sleep,
  pollForText,
  tapExpectation,
  type AndroidDeviceInfo,
  type AndroidToolHost,
  type AndroidUiToolsOptions,
  type OcrExpectationResult,
  type OcrSnapshot,
} from './tool-uitree.js'

/** Registered Vision-OCR tool names, in registration order. */
export const ANDROID_OCR_TOOL_NAMES = ['android_find_text', 'android_tap_text', 'android_wait_for'] as const

/** Default minimum OCR confidence (0.3 — the useful floor for CJK labels). */
export const OCR_DEFAULT_MIN_CONFIDENCE = 0.3

/** Output cap for the item list (same 40 KB budget as the UI tree). */
const OCR_CAP_BYTES = 40 * 1024

/** Default / maximum budget for `android_wait_for`. */
const WAIT_DEFAULT_TIMEOUT_MS = 8000
const WAIT_MAX_TIMEOUT_MS = 60_000

/** Validate/parse the optional min_confidence argument. */
export function sanitizeMinConfidence(value: number | undefined): number {
  if (value === undefined) return OCR_DEFAULT_MIN_CONFIDENCE
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('min_confidence must be a number within 0..1')
  }
  return value
}

function roundRect(rect: OcrRect): OcrRect {
  return { x: round2(rect.x), y: round2(rect.y), w: round2(rect.w), h: round2(rect.h) }
}

/** One `android_find_text` item (rect in image pixels). */
export interface AndroidFindTextItem {
  text: string
  confidence: number
  rect: OcrRect
}

export interface AndroidFindTextResult {
  device: AndroidDeviceInfo
  /** Screenshot size in PIXELS — the same space the rects live in. */
  screen: { width: number; height: number }
  count: number
  items: AndroidFindTextItem[]
  /** True when low-confidence items were dropped to fit the output cap. */
  truncated?: boolean
  hint?: string
}

export interface AndroidTapTextResult {
  action: 'tap-text'
  text: string
  confidence: number
  /** Matched text box in image pixels. */
  rect: OcrRect
  /** Tapped point in image pixels. */
  center: { x: number; y: number }
  /** The normalized 0..1 coordinates actually sent to the device. */
  tap: { x: number; y: number }
  expected?: OcrExpectationResult
  path: string
  bytes: number
  width?: number
  height?: number
  device: AndroidDeviceInfo
}

/** One matched OCR item as `android_wait_for` reports it (pixels). */
export interface AndroidWaitForItem {
  text: string
  confidence: number
  rect: OcrRect
}

/** A timeout is a normal `matched:false`, never a throw. */
export interface AndroidWaitForResult {
  device: AndroidDeviceInfo
  matched: boolean
  waitedMs: number
  text: string
  mode: 'appear' | 'disappear'
  item?: AndroidWaitForItem
}

export interface AndroidOcrTools {
  androidFindText: ToolDefinition
  androidTapText: ToolDefinition
  androidWaitFor: ToolDefinition
}

/**
 * Resolve one OCR text target with the SAME rules as android_tap_element:
 * exact (case-sensitive) equality first, then case-insensitive contains;
 * several distinct matches raise a candidate-list error (text + confidence +
 * rect, capped at 8).
 */
export function resolveOcrTextTarget(
  items: readonly OcrItem[],
  query: string,
  /** Every OCR item BEFORE the confidence filter, for the near-miss report. */
  unfiltered: readonly OcrItem[] = items,
  minConfidence = 0,
): { item: OcrItem; matchedBy: 'exact' | 'contains' } {
  const matches = (pool: readonly OcrItem[], mode: 'exact' | 'contains'): OcrItem[] => mode === 'exact'
    ? pool.filter(item => item.text === query)
    : pool.filter(item => item.text.toLowerCase().includes(query.toLowerCase()))
  let pool = matches(items, 'exact')
  let matchedBy: 'exact' | 'contains' = 'exact'
  if (pool.length === 0) {
    pool = matches(items, 'contains')
    matchedBy = 'contains'
  }
  if (pool.length === 0) {
    // "Not on screen" and "on screen but you filtered it out" are different
    // problems with different fixes, and the OCR reads Chinese text at
    // 0.3–0.6 far more often than Latin text — a caller who raised
    // min_confidence silently loses exactly the labels they were aiming at.
    const nearMiss = [...matches(unfiltered, 'exact'), ...matches(unfiltered, 'contains')]
      .filter(item => item.confidence < minConfidence)
      .sort((a, b) => b.confidence - a.confidence)[0]
    if (nearMiss !== undefined) {
      throw new Error(
        `android_tap_text: ${JSON.stringify(nearMiss.text)} IS on the current screen, but its OCR `
        + `confidence ${nearMiss.confidence.toFixed(2)} is below min_confidence ${minConfidence.toFixed(2)} — `
        + 'pass a lower min_confidence (CJK labels commonly read 0.3–0.6) or tap it by resource-id with '
        + 'android_tap_element',
      )
    }
    throw new Error(
      `android_tap_text: no recognized text matches ${JSON.stringify(query)} on the current screen — `
      + 'run android_find_text to see everything the OCR read, or android_ui_tree if the label may be an '
      + 'icon-only control with a content-desc',
    )
  }
  const unique = pool.filter((item, index) => !pool.slice(0, index).some(other =>
    other.text === item.text
    && other.rect.x === item.rect.x && other.rect.y === item.rect.y
    && other.rect.w === item.rect.w && other.rect.h === item.rect.h))
  if (unique.length > 1) {
    const shown = unique.slice(0, 8)
    const more = unique.length - shown.length
    throw new Error(
      `android_tap_text: ${unique.length} OCR matches for ${JSON.stringify(query)} — use a more specific query, `
      + 'or raise min_confidence to drop weak matches. Candidates:\n'
      + shown.map((item, index) =>
        `  ${index + 1}) text=${JSON.stringify(item.text)} confidence=${round2(item.confidence)} `
        + `rect={x:${round2(item.rect.x)},y:${round2(item.rect.y)},w:${round2(item.rect.w)},h:${round2(item.rect.h)}}`).join('\n')
      + (more > 0 ? `\n  …and ${more} more` : ''),
    )
  }
  return { item: unique[0]!, matchedBy }
}

/** Cap the OCR item list (~40 KB): drop the lowest-confidence tail first. */
function capOcrItems(items: AndroidFindTextItem[]): { items: AndroidFindTextItem[]; truncated: boolean } {
  const bytes = (list: AndroidFindTextItem[]): number => Buffer.byteLength(JSON.stringify(list), 'utf8')
  if (bytes(items) <= OCR_CAP_BYTES) return { items, truncated: false }
  const kept = [...items]
  while (bytes(kept) > OCR_CAP_BYTES && kept.length > 1) kept.pop()
  return { items: kept, truncated: true }
}

const ocrItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    rect: { ...boundsSchema, required: true },
  },
} as const

/** Create the three Vision-OCR tool definitions bound to one host. */
export function createAndroidOcrTools(host: AndroidToolHost, options: AndroidUiToolsOptions = {}): AndroidOcrTools {
  const cacheDir = options.cacheDir ?? join(tmpdir(), 'dsh-android')
  const screenshots = new ScreenshotStore(cacheDir)

  const androidFindText = defineTool({
    name: 'android_find_text',
    description: 'OCR the CURRENT screen of a connected Android device or emulator with the plugin-compiled '
      + 'Vision helper (accurate recognition, zh-Hans + en-US, compiled with swiftc on first use into '
      + '~/Library/Caches/dsh-android/bin/ocr; the device side is plain screencap, but recognition needs a '
      + 'macOS host). Use this when android_ui_tree returns no labels — Jetpack Compose without semantics, '
      + 'Flutter, a WebView, a game or video surface all dump as one unlabeled node — for text rendered as '
      + 'graphics (badge counts, prices baked into images), or to independently verify what is on screen. '
      + 'Captures a fresh screenshot, then returns {device, screen size in PIXELS, items:[{text, confidence, '
      + 'rect}]}. Rects are pixel boxes with the origin at the top-left, the SAME space android_ui_tree '
      + 'bounds use, so they can be tapped via android_tap_text or compared directly. Items are '
      + 'confidence-sorted and the list is capped at ~40 KB (truncated=true drops the lowest-confidence tail '
      + '— narrow with query or raise min_confidence). Icon-only controls carry no OCR text: look for their '
      + 'content-desc in android_ui_tree, or use android_ui_rows for list items.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices. Defaults to the currently streamed device, '
          + 'else the only connected one.',
      },
      query: {
        type: 'string',
        description: 'Optional case-insensitive substring filter on the recognized text (e.g. "支付" or '
          + '"Wi-Fi"). Omit to return every item above min_confidence.',
      },
      min_confidence: {
        type: 'number',
        description: 'Minimum recognition confidence 0..1 to include (default 0.3). Raise it to drop noise, '
          + 'lower it to catch faint text.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          screen: { ...sizeSchema, required: true },
          count: { type: 'integer', required: true },
          items: { type: 'array', required: true, items: ocrItemSchema },
          truncated: { type: 'boolean' },
          hint: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => true,
    async execute(args: { serial?: string; query?: string; min_confidence?: number }, exec) {
      const minConfidence = sanitizeMinConfidence(args.min_confidence)
      const device = await host.resolveTarget(args.serial)
      const shot = await captureScreenshot('android_find_text', screenshots, host, device)
      const pixelSize = requirePixelSize(shot, 'android_find_text')
      const items = await runOcr('android_find_text', shot.path, device.serial, exec.signal)
      const converted = filterOcrItems(items, args.query, minConfidence).map(item => ({
        text: item.text,
        confidence: round2(item.confidence),
        rect: roundRect(item.rect),
      }))
      const capped = capOcrItems(converted)
      return {
        device: shot.device,
        screen: { width: pixelSize.width, height: pixelSize.height },
        count: capped.items.length,
        items: capped.items,
        ...(capped.truncated
          ? {
              truncated: true,
              hint: 'The OCR item list exceeded the 40 KB output cap and the lowest-confidence items were '
                + 'dropped. Narrow with query or raise min_confidence.',
            }
          : {}),
      } satisfies AndroidFindTextResult
    },
    presentCall: (args: { query?: string }) => ({
      card: 'generic',
      title: args.query === undefined ? 'Find text on screen' : `Find text "${args.query}" on screen`,
      kind: 'execute',
      rawInput: args.query === undefined ? {} : { query: args.query },
    }),
  })

  const androidWaitFor = defineTool({
    name: 'android_wait_for',
    description: 'Wait until text appears or disappears on a connected Android device or emulator, polling '
      + 'the OCR path (the same capture+OCR pipeline android_find_text uses) every ~600 ms until the '
      + 'condition holds or timeout_ms expires. A timeout is a normal matched:false answer, NEVER an error — '
      + 'use it to gate an action on a condition instead of looping android_find_text yourself or sleeping a '
      + 'guessed number of seconds. mode "appear" waits for the text to show up (a screen finished loading, a '
      + 'toast rendered); mode "disappear" waits for it to be gone (a spinner, a dialog). On a match, item '
      + 'carries the OCR text, confidence and pixel rect.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices. Defaults to the currently streamed device, '
          + 'else the only connected one.',
      },
      text: {
        type: 'string',
        required: true,
        description: 'Text to wait for (case-insensitive substring).',
      },
      mode: {
        type: 'string',
        enum: ['appear', 'disappear'],
        description: 'Wait for the text to appear (default) or disappear.',
      },
      timeout_ms: {
        type: 'integer',
        description: 'How long to poll before giving up, in milliseconds (default 8000, capped at 60000).',
      },
      min_confidence: {
        type: 'number',
        description: 'Minimum recognition confidence 0..1 for a match (default 0.3).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          matched: { type: 'boolean', required: true },
          waitedMs: { type: 'integer', required: true },
          text: { type: 'string', required: true },
          mode: { type: 'string', required: true, enum: ['appear', 'disappear'] },
          item: ocrItemSchema,
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => true,
    async execute(args: {
      serial?: string
      text?: string
      mode?: 'appear' | 'disappear'
      timeout_ms?: number
      min_confidence?: number
    }, exec) {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (text === '') {
        throw new Error('android_wait_for requires a non-empty text to wait for')
      }
      const mode = args.mode === 'disappear' ? 'disappear' : 'appear'
      const timeoutMs = Math.min(
        WAIT_MAX_TIMEOUT_MS,
        Math.max(0, typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms) ? args.timeout_ms : WAIT_DEFAULT_TIMEOUT_MS),
      )
      const minConfidence = sanitizeMinConfidence(args.min_confidence)
      const device = await host.resolveTarget(args.serial)
      // Resolve the summary up front: a zero-budget wait may never poll, and
      // the result must still name the device it answered for.
      const summary = deviceSummaryOf(device)
      let lastSnapshot: OcrSnapshot | undefined
      const outcome = await pollForText(
        async () => {
          lastSnapshot = await readOcrOnce('android_wait_for', screenshots, host, device, exec.signal)
          return lastSnapshot.items
        },
        text,
        mode,
        timeoutMs,
        OCR_POLL_INTERVAL_MS,
        minConfidence,
        exec.signal,
      )
      return {
        device: lastSnapshot?.device ?? summary,
        matched: outcome.matched,
        waitedMs: outcome.waitedMs,
        text,
        mode,
        ...(outcome.item === undefined
          ? {}
          : {
              item: {
                text: outcome.item.text,
                confidence: round2(outcome.item.confidence),
                rect: roundRect(outcome.item.rect),
              },
            }),
      } satisfies AndroidWaitForResult
    },
    presentCall: (args: { text?: string; mode?: string }) => ({
      card: 'generic',
      title: `Wait for text ${JSON.stringify(args.text ?? '')} to ${args.mode === 'disappear' ? 'disappear' : 'appear'}`,
      kind: 'execute',
      rawInput: args.text === undefined ? {} : { text: args.text, mode: args.mode ?? 'appear' },
    }),
  })

  const androidTapText = defineTool({
    name: 'android_tap_text',
    description: 'OCR the CURRENT screen and tap the center of the best text match — the same exact → '
      + 'case-insensitive-contains → candidate-list ambiguity rules as android_tap_element, for text the view '
      + 'hierarchy cannot see (Compose without semantics, Flutter, WebViews, game surfaces, badge counts, '
      + 'text baked into images). Prefer android_tap_element whenever the control HAS a resource-id or '
      + 'content-desc: identity beats pixels. On a real phone every tap has real consequences (posts, likes, '
      + 'purchases, messages): NEVER tap an unidentified control to find out what it does — if a control '
      + 'cannot be identified, STOP and report what you see. OCR boxes are image pixels and the tap is sent '
      + 'as center/screenshot-size, so no scale factor or rotation inverse is involved. After ~300 ms a fresh '
      + 'screenshot is captured with the same summary shape as android_interact. To CONFIRM the tap landed, '
      + 'pass expect_text (text that should appear) or expect_gone (text that should disappear) — the tool '
      + 'polls screen OCR and reports expected.matched in the SAME call. Do NOT screenshot-and-compare pixels '
      + 'to check whether a tap worked.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices. Defaults to the currently streamed device, '
          + 'else the only connected one.',
      },
      query: {
        type: 'string',
        required: true,
        description: 'Text to tap, e.g. "同意并继续" or "Continue". Case-sensitive exact match first, then '
          + 'case-insensitive substring; several distinct matches raise a candidate-list error.',
      },
      min_confidence: {
        type: 'number',
        description: 'Minimum recognition confidence 0..1 for a match (default 0.3).',
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
          action: { type: 'string', required: true, const: 'tap-text' },
          text: { type: 'string', required: true },
          confidence: { type: 'number', required: true },
          rect: { ...boundsSchema, required: true },
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
      query?: string
      min_confidence?: number
      expect_text?: string
      expect_gone?: string
    }, exec) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (query === '') {
        throw new Error('android_tap_text requires a non-empty query (exact match first, then case-insensitive contains)')
      }
      const minConfidence = sanitizeMinConfidence(args.min_confidence)
      const expectation = tapExpectation(args)
      const device = await host.resolveTarget(args.serial)
      const shot = await captureScreenshot('android_tap_text', screenshots, host, device)
      const pixelSize = requirePixelSize(shot, 'android_tap_text')
      const items = await runOcr('android_tap_text', shot.path, device.serial, exec.signal)
      const { item } = resolveOcrTextTarget(filterOcrItems(items, query, minConfidence), query, items, minConfidence)
      const center = rectCenter(item.rect)
      // Pixel center → normalized 0..1 through the screenshot's own size; the
      // host multiplies by the live frame size, which is the same display.
      const normalized = pixelRectToNormalizedCenter(item.rect, pixelSize)
      const tap = { x: round4(normalized.x), y: round4(normalized.y) }
      try {
        await host.tap(device.serial, tap.x, tap.y)
      } catch (error) {
        throw new Error(`android_tap_text: the tap at (${round2(center.x)}, ${round2(center.y)}) px failed: ${errorMessage(error)}`)
      }
      await sleep(TAP_SETTLE_MS)
      const screenshot = await captureScreenshot('android_tap_text', screenshots, host, device)
      const expected = expectation === undefined
        ? undefined
        : await runTapExpectation('android_tap_text', screenshots, host, device, expectation.text, expectation.mode, exec.signal)
      return {
        action: 'tap-text',
        text: item.text,
        confidence: round2(item.confidence),
        rect: roundRect(item.rect),
        center: { x: losslessNumber(round2(center.x)), y: losslessNumber(round2(center.y)) },
        tap,
        ...screenshot,
        ...(expected === undefined ? {} : { expected }),
      } satisfies AndroidTapTextResult
    },
    presentCall: (args: { query?: string }) => ({
      card: 'generic',
      title: `Tap text ${JSON.stringify(args.query ?? '')}`,
      kind: 'execute',
      rawInput: args.query === undefined ? {} : { query: args.query },
    }),
  })

  return { androidFindText, androidTapText, androidWaitFor }
}
