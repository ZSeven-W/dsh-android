/**
 * List/feed row tools: `android_ui_rows` and `android_tap_row`.
 *
 * A `RecyclerView` item is a subtree, not an element: its title, subtitle and
 * counters live in scattered TextViews, and its per-item controls (like,
 * bookmark, share) are commonly unlabeled `ImageView`s with neither
 * resource-id nor content-desc. `android_tap_element` cannot reach them —
 * there is no identity to match. These two tools close that gap:
 *
 * `android_ui_rows` turns the dump into ROWS — index, pixel frame, the
 * aggregated label, and the counters parsed GENERICALLY out of that label
 * (number + classifier token, 中文/English; no app vocabulary is hardcoded —
 * see list-rows.ts).
 * `android_tap_row` taps at a RELATIVE position inside row N (fractions of the
 * row frame) instead of guessing absolute screen coordinates, and can verify
 * the action the only reliable way a list app offers: the target counter
 * moving the expected ±1 (`expect_count`).
 *
 * Real-device safety gate: a tap is planned from a FRESH dump, an out-of-range
 * row index FAILS instead of clamping, an `expect_count` key the row's
 * counters do not contain is refused BEFORE any tap (that is exactly the
 * probe-click failure mode on a real account), and verification reports
 * unverified-with-reason instead of guessing.
 * @module @zseven-w/dsh-android/tool-list-rows
 */

import {
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectListRows,
  planRowTap,
  requireCountKey,
  sanitizeCountDelta,
  verifyCountChange,
  type CountCheckResult,
  type ListRow,
} from './list-rows.js'
import {
  OCR_FALLBACK_HINT,
  ScreenshotStore,
  boundsSchema,
  captureScreenshot,
  deviceSchema,
  deviceSummaryOf,
  errorMessage,
  pointSchema,
  renderJson,
  round4,
  screenshotMeta,
  sizeSchema,
  sleep,
  type AndroidDeviceInfo,
  type AndroidToolHost,
  type AndroidUiToolsOptions,
} from './tool-uitree.js'
import {
  hasLabeledNode,
  readUiTree,
  screenBoundsOf,
  type UiTreeNode,
} from './uitree.js'
import { IMAGE_REF_SCHEMA, renderJsonWithImage } from './vision.js'

/** Registered list-row tool names, in registration order. */
export const ANDROID_ROW_TOOL_NAMES = ['android_ui_rows', 'android_tap_row'] as const

/** Settle delay before the post-action verification re-read. */
const TAP_VERIFY_SETTLE_MS = 800

/** Output cap for the row list (same 40 KB budget as the UI tree). */
const ROWS_CAP_BYTES = 40 * 1024

/** Guidance every android_ui_rows result carries about counter keys. */
const COUNTS_NOTE = 'Counters are parsed heuristically from row labels (number + classifier token); '
  + 'keys round-trip — pass a key exactly as listed to android_tap_row.expect_count.'

const countSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', required: true },
    value: { type: 'number', required: true },
  },
} as const

const rowSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'integer', required: true },
    type: { type: 'string', required: true },
    frame: { ...boundsSchema, required: true },
    label: { type: 'string' },
    counts: { type: 'array', required: true, items: countSchema },
    group: { type: 'integer' },
  },
} as const

/** Compact output copy of one detected row (the output-schema shape). */
function toOutputRow(row: ListRow): AndroidRowOutput {
  return {
    index: row.index,
    type: row.type,
    frame: { ...row.frame },
    ...(row.label === undefined ? {} : { label: row.label }),
    counts: row.counts.map(count => ({ key: count.key, value: count.value })),
    ...(row.group === undefined ? {} : { group: row.group }),
  }
}

/** One row in the output schema (shared by both tools). */
export interface AndroidRowOutput {
  index: number
  type: string
  frame: { x: number; y: number; w: number; h: number }
  label?: string
  counts: Array<{ key: string; value: number }>
  group?: number
}

export interface AndroidUiRowsResult {
  device: AndroidDeviceInfo
  /** Display size in pixels (the space row frames live in). */
  screen: { width: number; height: number }
  rowCount: number
  repeatedGroups: number
  omittedOffscreen: number
  rows: AndroidRowOutput[]
  truncated?: boolean
  hint?: string
  note?: string
}

export interface AndroidTapRowResult {
  action: 'tap-row'
  row: AndroidRowOutput
  /** Relative position inside the row frame (0..1) that was tapped. */
  inRow: { x: number; y: number }
  /** Absolute tap point in display pixels. */
  center: { x: number; y: number }
  /** The normalized 0..1 coordinates actually sent to the device. */
  tap: { x: number; y: number }
  /** Count-change verification, when expect_count was given. */
  countCheck?: CountCheckResult
  path: string
  bytes: number
  width?: number
  height?: number
  device: AndroidDeviceInfo
  note?: string
}

export interface AndroidRowTools {
  androidUiRows: ToolDefinition
  androidTapRow: ToolDefinition
}

/** Cap the row list (~40 KB): drop the trailing (lowest, latest) rows first. */
function capRows(rows: AndroidRowOutput[]): { rows: AndroidRowOutput[]; truncated: boolean } {
  const bytes = (list: AndroidRowOutput[]): number => Buffer.byteLength(JSON.stringify(list), 'utf8')
  if (bytes(rows) <= ROWS_CAP_BYTES) return { rows, truncated: false }
  const kept = [...rows]
  while (bytes(kept) > ROWS_CAP_BYTES && kept.length > 1) kept.pop()
  return { rows: kept, truncated: true }
}

/**
 * No-rows guidance, attributed to ONE of three causes so a screen is never
 * blanket-blamed: (a) the rows exist but every one of them is scrolled out of
 * view; (b) the dump carries no labels at all, so nothing here can be read
 * without OCR; (c) a labeled dump with no repeated isomorphic run — a detail
 * page or a form, not a list.
 */
function noRowsHint(roots: readonly UiTreeNode[], omittedOffscreen: number): string {
  if (omittedOffscreen > 0) {
    return `No rows are on screen, but ${omittedOffscreen} row candidate(s) were found OUTSIDE the display — `
      + 'the list is scrolled past them (uiautomator keeps recycled views in the dump). Scroll the list back '
      + 'into view with android_interact, then re-run android_ui_rows.'
  }
  if (!hasLabeledNode(roots)) return OCR_FALLBACK_HINT
  return 'No repeated isomorphic rows were detected in a labeled hierarchy: the current screen is probably '
    + 'not a scrollable list (a detail page, a form, a settings header), or its items do not repeat at least '
    + 'three times with the same class and height. The labeled nodes are all in android_ui_tree — drive them '
    + 'with android_tap_element instead.'
}

/** Create the two `android_*_row(s)` tool definitions bound to one host. */
export function createAndroidRowTools(host: AndroidToolHost, options: AndroidUiToolsOptions = {}): AndroidRowTools {
  const vision = options.vision
  const cacheDir = options.cacheDir ?? join(tmpdir(), 'dsh-android')
  const screenshots = new ScreenshotStore(cacheDir)

  /** One fresh dump + row detection for `serial`. */
  const readRows = async (tool: string, serial: string): Promise<{
    roots: UiTreeNode[]
    screen: { width: number; height: number }
    rows: ListRow[]
    repeatedGroups: number
    omittedOffscreen: number
  }> => {
    let roots: UiTreeNode[]
    try {
      roots = (await readUiTree(host.toolchain, serial)).roots
    } catch (error) {
      throw new Error(`${tool}: ${errorMessage(error)}`)
    }
    const screen = screenBoundsOf(roots)
    const detected = detectListRows(roots, { bounds: screen })
    return { roots, screen, ...detected }
  }

  const androidUiRows = defineTool({
    name: 'android_ui_rows',
    description: 'Read the visible list/feed rows of the frontmost app as ROWS instead of a raw view tree: '
      + 'each row carries an index, its frame in display PIXELS, the aggregated label (every text and '
      + 'content-desc inside the row subtree), and the counters parsed out of that label — number + '
      + 'classifier, e.g. "57 回复" → 回复=57, in 中文 or English. Use this for RecyclerView / ListView / '
      + 'LazyColumn screens: a list item is a SUBTREE, not an element, and its per-item controls (like, '
      + 'bookmark, share) are usually unlabeled ImageViews with no resource-id — android_tap_element cannot '
      + 'reach them, but android_tap_row taps INSIDE a row at a relative position (see its expect_count). A '
      + 'row is a run of three or more sibling subtrees that share a class and a near-equal height, and at '
      + 'least one of them carries a label; nested runs collapse to the outermost. Counters are parsed '
      + 'heuristically and their keys round-trip, so pass a key EXACTLY as returned to '
      + 'android_tap_row.expect_count. When no rows are found the hint says WHY (the rows are scrolled out '
      + 'of view / the screen exposes no labels at all / this is not a list screen) — never a blanket claim '
      + 'about the app. Rows scrolled off the display are excluded and counted as omittedOffscreen.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices. Defaults to the currently streamed device, '
          + 'else the only connected one.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          screen: { ...sizeSchema, required: true },
          rowCount: { type: 'integer', required: true },
          repeatedGroups: { type: 'integer', required: true },
          omittedOffscreen: { type: 'integer', required: true },
          rows: { type: 'array', required: true, items: rowSchema },
          truncated: { type: 'boolean' },
          hint: { type: 'string' },
          note: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => true,
    async execute(args: { serial?: string }) {
      const device = await host.resolveTarget(args.serial)
      const sample = await readRows('android_ui_rows', device.serial)
      const capped = capRows(sample.rows.map(toOutputRow))
      const hints: string[] = []
      if (capped.truncated) {
        hints.push('The row list exceeded the 40 KB output cap and its tail was dropped — scroll to reach '
          + 'the remaining rows, or narrow the screen first.')
      }
      if (sample.rows.length === 0) hints.push(noRowsHint(sample.roots, sample.omittedOffscreen))
      return {
        device: deviceSummaryOf(device),
        screen: sample.screen,
        rowCount: capped.rows.length,
        repeatedGroups: sample.repeatedGroups,
        omittedOffscreen: sample.omittedOffscreen,
        rows: capped.rows,
        ...(capped.truncated ? { truncated: true } : {}),
        ...(hints.length > 0 ? { hint: hints.join(' ') } : {}),
        note: COUNTS_NOTE,
      } satisfies AndroidUiRowsResult
    },
    presentCall: (args: { serial?: string }) => ({
      card: 'generic',
      title: args.serial === undefined ? 'Read list rows' : `Read list rows of ${args.serial}`,
      kind: 'execute',
    }),
  })

  const androidTapRow = defineTool({
    name: 'android_tap_row',
    description: 'Tap at a RELATIVE position inside one visible list row reported by android_ui_rows: a '
      + '0-based row index plus x/y as fractions of that row\'s frame (0 = left/top edge, 1 = right/bottom, '
      + 'default 0.5 = row center). This is the list-app way to reach per-item controls that are NOT '
      + 'identifiable elements — an icon-only like or bookmark button inside the row subtree, commonly an '
      + 'ImageView with no resource-id and no content-desc. The row frame comes from a FRESH dump, so no '
      + 'absolute screen coordinate is ever guessed or remembered. Safety gate: the row is re-located in the '
      + 'current hierarchy and an out-of-range index FAILS (it never clamps to the last row); a tap on a real '
      + 'phone has real consequences (likes, posts, purchases), so with expect_count={key,delta} the tool '
      + 'verifies the action by re-reading the row label after ~800 ms and checking the counter moved exactly '
      + 'delta (+1 or -1) — and if the key is not among the row\'s parsed counters the tap is REFUSED before '
      + 'it happens (never probe a control to discover what it does). Without expect_count the tap still '
      + 'happens (an explicit row-relative position IS the identification) but nothing is verified — prefer '
      + 'expect_count whenever the row label carries counters. The verified count change is the confirmation: '
      + 'do not screenshot-and-compare pixels.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Target device serial from android_devices. Defaults to the currently streamed device, '
          + 'else the only connected one.',
      },
      row: {
        type: 'integer',
        required: true,
        description: '0-based row index exactly as reported by android_ui_rows. Out-of-range FAILS — re-run '
          + 'android_ui_rows, never tap a remembered position.',
      },
      x: {
        type: 'number',
        description: 'Horizontal position inside the row frame as a fraction 0..1 (0 = left edge, 1 = right '
          + 'edge). Default 0.5 (center). A right-side action button is often near 0.9.',
      },
      y: {
        type: 'number',
        description: 'Vertical position inside the row frame as a fraction 0..1 (0 = top, 1 = bottom). '
          + 'Default 0.5 (center).',
      },
      expect_count: {
        type: 'object',
        additionalProperties: false,
        description: 'Verify the action by the target counter moving exactly delta: {key: "<counter key from '
          + 'android_ui_rows.counts>", delta: +1 | -1}. After the tap the row label is re-read and the check '
          + 'is reported as countCheck.verified — the only reliable confirmation a list app offers. The tap '
          + 'is REFUSED before it happens when key is not among the row\'s parsed counters (an unidentifiable '
          + 'control is never probed).',
        properties: {
          key: { type: 'string', required: true, description: 'Counter key exactly as android_ui_rows listed it.' },
          delta: { type: 'integer', required: true, description: 'Expected change: +1 or -1 (a single toggle).' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, const: 'tap-row' },
          row: { ...rowSchema, required: true },
          inRow: { ...pointSchema, required: true },
          center: { ...pointSchema, required: true },
          tap: { ...pointSchema, required: true },
          countCheck: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', required: true },
              delta: { type: 'integer', required: true },
              before: { type: 'number' },
              after: { type: 'number' },
              verified: { type: 'boolean', required: true },
              changed: { type: 'boolean', required: true },
              reason: { type: 'string' },
            },
          },
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer' },
          height: { type: 'integer' },
          device: { ...deviceSchema, required: true },
          image: IMAGE_REF_SCHEMA,
          note: { type: 'string' },
        },
      },
      render: renderJsonWithImage,
      presentationMeta: (_args: unknown, value: JsonValue): JsonValue => screenshotMeta(value),
    },
    timeoutMs: 180_000,
    async execute(args: {
      serial?: string
      row: number
      x?: number
      y?: number
      expect_count?: { key: string; delta: number }
    }, exec) {
      if (!Number.isInteger(args.row) || args.row < 0) {
        throw new Error('android_tap_row: row must be a 0-based row index from android_ui_rows (an integer >= 0)')
      }
      const fractionX = args.x ?? 0.5
      const fractionY = args.y ?? 0.5
      const expectation = args.expect_count === undefined
        ? undefined
        : {
            key: (args.expect_count.key ?? '').trim(),
            delta: sanitizeCountDelta(args.expect_count.delta ?? 0),
          }
      if (expectation !== undefined && expectation.key === '') {
        throw new Error('android_tap_row: expect_count.key is required (the counter key exactly as android_ui_rows listed it)')
      }
      const device = await host.resolveTarget(args.serial)
      const sample = await readRows('android_tap_row', device.serial)
      const plan = planRowTap(sample.rows, args.row, fractionX, fractionY, sample.screen)
      // The probe-guard runs BEFORE the tap: an unverifiable expectation is a
      // refusal, not a "tap and see".
      if (expectation !== undefined) requireCountKey(plan.row, expectation.key)
      if (sample.screen.width <= 0 || sample.screen.height <= 0) {
        throw new Error(
          'android_tap_row: the dump reported a zero-size display, so a tap cannot be placed — re-run '
          + 'android_ui_rows once the screen is on and settled',
        )
      }
      const tap = {
        x: round4(plan.tap.x / sample.screen.width),
        y: round4(plan.tap.y / sample.screen.height),
      }
      try {
        await host.tap(device.serial, tap.x, tap.y)
      } catch (error) {
        throw new Error(`android_tap_row: the tap at (${plan.tap.x}, ${plan.tap.y}) px failed: ${errorMessage(error)}`)
      }

      let countCheck: CountCheckResult | undefined
      if (expectation !== undefined) {
        await sleep(TAP_VERIFY_SETTLE_MS)
        const after = await readRows('android_tap_row', device.serial)
        const afterRow = after.rows.find(row => row.index === plan.row.index)
        countCheck = afterRow === undefined
          ? {
              key: expectation.key,
              delta: expectation.delta,
              verified: false,
              changed: false,
              reason: 'the re-read hierarchy no longer contains the row (the screen changed)',
            }
          : verifyCountChange(plan.row, afterRow, expectation.key, expectation.delta)
      }
      const screenshot = await captureScreenshot('android_tap_row', screenshots, host, device,
        vision === undefined ? undefined : { services: vision, exec })
      return {
        action: 'tap-row',
        row: toOutputRow(plan.row),
        inRow: plan.inRow,
        center: plan.tap,
        tap,
        ...(countCheck === undefined ? {} : { countCheck }),
        ...screenshot,
        ...(expectation === undefined
          ? {
              note: 'No expect_count was given, so nothing was verified — re-run android_ui_rows and compare '
                + 'the row counters if confirmation matters.',
            }
          : {}),
      } satisfies AndroidTapRowResult
    },
    presentCall: (args: { row: number; x?: number; y?: number }) => ({
      card: 'generic',
      title: `Tap row ${args.row} of list`,
      kind: 'execute',
      rawInput: {
        row: args.row,
        x: args.x ?? 0.5,
        y: args.y ?? 0.5,
      },
    }),
  })

  return { androidUiRows, androidTapRow }
}
