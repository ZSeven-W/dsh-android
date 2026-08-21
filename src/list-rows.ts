/**
 * Row-level abstraction for list/feed apps.
 *
 * A `RecyclerView` (or `ListView`, or a Compose `LazyColumn` that surfaces as
 * one) hands uiautomator a run of structurally IDENTICAL sibling subtrees, one
 * per item. Everything the item says — title, subtitle, and its counters
 * ("57 回复。18 喜欢。592 次查看") — lives in TextViews scattered inside that
 * subtree, and the per-item controls (a heart, a bookmark) are frequently
 * unlabeled `ImageView`s with no resource-id and no content-desc. There is
 * nothing to match by identity: the ROW is the unit. This module provides the
 * three pieces that make such screens operable without guessing absolute
 * screen coordinates or probing icon-only controls on a real account:
 *
 * 1. `detectListRows` — recognize repeated isomorphic sibling subtrees (three
 *    or more children of one parent, same class, near-equal height), each with
 *    index, pixel frame, and an aggregated label.
 * 2. `parseCountsFromLabel` — parse the counters out of that aggregated label
 *    generically: a number followed by a classifier token (中文/English alike).
 *    No app vocabulary is hardcoded; only numeric units (万/亿/k/m/w) are
 *    understood as multipliers.
 * 3. `planRowTap` + `verifyCountChange` — operate at a RELATIVE position
 *    inside row N, then confirm the action by the target counter moving the
 *    expected ±1 — the only reliable confirmation a list app offers.
 *
 * Everything here is pure (no device, no adb) so the smoke can drive it with
 * an XML fixture. tool-list-rows.ts wires it to the dump and adds the
 * real-device safety gates.
 * @module @zseven-w/dsh-android/list-rows
 */

import { isOffscreenBounds, type UiBounds, type UiTreeNode } from './uitree.js'

/** One counter parsed out of an aggregated row label. */
export interface RowCount {
  /** The classifier token exactly as it appears (e.g. "回复", "replies"). */
  key: string
  /** The parsed numeric value (multipliers 万/亿/k/m/w applied). */
  value: number
}

/** One detected list row. */
export interface ListRow {
  /** 0-based order among the visible rows, top-to-bottom (then left-right). */
  index: number
  /** Short class name the row was recognized by (e.g. `LinearLayout`). */
  type: string
  /** Frame in display pixels. */
  frame: UiBounds
  /**
   * Aggregated label: every DISTINCT text / content-desc inside the row
   * subtree, in document order, joined with spaces.
   */
  label?: string
  /** Counters parsed from the label, in order of appearance. */
  counts: RowCount[]
  /** Shape-group id: rows sharing a group are isomorphic siblings. */
  group?: number
}

/** Detected rows plus diagnostics for the tool output. */
export interface DetectRowsResult {
  rows: ListRow[]
  /** Number of distinct repeated sibling groups that produced rows. */
  repeatedGroups: number
  /** Row candidates dropped because they lie entirely off-screen. */
  omittedOffscreen: number
}

/**
 * Minimum siblings that make a run "repeated". Three, not the iOS twin's two:
 * Android has no Cell type to key off, so the repetition IS the only evidence
 * that a container holds list items rather than a two-column header.
 */
export const MIN_REPEATED_ROWS = 3

/** Absolute height slack (px) for "near-equal height" siblings. */
const HEIGHT_TOLERANCE_PX = 8
/** Relative height slack — a 200 px row tolerates 30 px of content variance. */
const HEIGHT_TOLERANCE_RATIO = 0.15
/** Rows shorter than this are dividers/spacers, not items. */
const MIN_ROW_HEIGHT_PX = 16
/** A "row" taller than this fraction of the screen is a page, not an item. */
const MAX_ROW_HEIGHT_FRACTION = 0.9

/** Round a coordinate for output — negative zero never escapes (lossless JSON). */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

/** Normalize a count key for comparison: lowercase Latin, collapse spaces. */
export function normalizeCountKey(key: string): string {
  return key.trim().toLowerCase().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
}

/**
 * Numeric multipliers understood by the parser — numeric units only, NOT app
 * vocabulary. 万/亿 are Chinese magnitude units, k/m/w the Latin shorthand
 * (w = 万 as used in Chinese net-speak).
 */
const MULTIPLIERS: Record<string, number> = {
  万: 10_000,
  亿: 100_000_000,
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  w: 10_000,
  W: 10_000,
}

/** Classifier-terminating characters: punctuation never belongs to a count
 * key, and neither do digits (they start the NEXT count). */
const TERMINATORS = '\\s,，.。:：;；!！?？…—\\-–%+*/()（）\\[\\]【】\'"“”·•~'

/** One parsed count: digits, optional multiplier, classifier token. The
 * (?!\d) guard drops "1A215"-style serial tokens where the "classifier" is
 * really the head of another number. */
const COUNT_REGEXP = new RegExp(
  // The character class must cover every MULTIPLIERS key, upper case included
  // — otherwise "3.2W 赞" parses the W into the classifier instead of ×10000.
  `(\\d[\\d,]*(?:\\.\\d+)?)\\s*([万亿kmwKMW]?)\\s*([^\\d${TERMINATORS}]+)(?!\\d)`,
  'gu',
)

interface RawCountMatch {
  key: string
  value: number
}

/** Parse one label into (key, value) counter pairs. */
function scanCounts(label: string): RawCountMatch[] {
  const counts: RawCountMatch[] = []
  for (const match of label.matchAll(COUNT_REGEXP)) {
    const raw = match[1]!.replace(/,/g, '')
    const base = Number(raw)
    if (!Number.isFinite(base)) continue
    const multiplier = MULTIPLIERS[match[2]!] ?? 1
    const key = normalizeCountKey(match[3]!)
    if (key === '') continue
    counts.push({ key, value: base * multiplier })
  }
  return counts
}

/**
 * Parse the counters out of an aggregated label: a number followed by a
 * classifier token, in 中文 or English ("57 回复。18 喜欢。592 次查看" →
 * 回复:57, 喜欢:18, 次查看:592; "57 replies · 18 likes · 592 views" → the same
 * shape). Purely generic: the classifier is whatever non-numeric token follows
 * the number, and only numeric units (万/亿/k/m/w) are multiplied in. Keys
 * round-trip: pass a key exactly as returned to `verifyCountChange`.
 */
export function parseCountsFromLabel(label: string): RowCount[] {
  const counts: RowCount[] = []
  for (const scanned of scanCounts(label)) {
    const existing = counts.find(count => count.key === scanned.key)
    if (existing !== undefined) {
      // Same key twice in one label (a repeated phrase): keep the LAST value,
      // which is what a re-read would show.
      existing.value = scanned.value
      continue
    }
    counts.push({ key: scanned.key, value: scanned.value })
  }
  return counts
}

/** Find a counter by key (normalized comparison, as it round-trips). */
export function rowCountFor(row: ListRow, key: string): number | undefined {
  const needle = normalizeCountKey(key)
  return row.counts.find(count => count.key === needle)?.value
}

/**
 * Aggregate a row's label: every DISTINCT `text` and `content-desc` inside the
 * subtree, in document order, space-joined. A row's own node almost never
 * carries text on Android — the strings live in its TextView descendants — so
 * this walk IS the label.
 */
export function aggregateRowLabel(node: UiTreeNode): string | undefined {
  const parts: string[] = []
  const push = (value: string | undefined): void => {
    if (value === undefined) return
    const trimmed = value.trim()
    if (trimmed !== '' && !parts.includes(trimmed)) parts.push(trimmed)
  }
  const walk = (current: UiTreeNode): void => {
    push(current.text)
    push(current.contentDesc)
    for (const child of current.children) walk(child)
  }
  walk(node)
  return parts.length > 0 ? parts.join(' ') : undefined
}

/** True when two boxes are the same box within the shape tolerance. */
function sameFrame(a: UiBounds, b: UiBounds): boolean {
  return Math.abs(a.x - b.x) <= HEIGHT_TOLERANCE_PX
    && Math.abs(a.y - b.y) <= HEIGHT_TOLERANCE_PX
    && Math.abs(a.w - b.w) <= HEIGHT_TOLERANCE_PX
    && Math.abs(a.h - b.h) <= HEIGHT_TOLERANCE_PX
}

/** True when `outer` strictly contains `inner` (a nested list inside a row). */
function strictlyContains(outer: UiBounds, inner: UiBounds): boolean {
  if (sameFrame(outer, inner)) return false
  return outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.w >= inner.x + inner.w
    && outer.y + outer.h >= inner.y + inner.h
}

interface RowCandidate {
  node: UiTreeNode
  group: number
}

/**
 * Cluster one parent's children into runs of isomorphic siblings: same class,
 * near-equal height (an absolute 8 px slack widened to 15 % on tall rows, so a
 * two-line item still groups with its three-line neighbour).
 */
function clusterSiblings(children: readonly UiTreeNode[], minRepeatedRows: number, screenHeight: number): UiTreeNode[][] {
  const maxHeight = screenHeight > 0 ? screenHeight * MAX_ROW_HEIGHT_FRACTION : Number.POSITIVE_INFINITY
  const byType = new Map<string, UiTreeNode[]>()
  for (const child of children) {
    const { w, h } = child.bounds
    if (w <= 0 || h < MIN_ROW_HEIGHT_PX || h > maxHeight) continue
    const bucket = byType.get(child.type)
    if (bucket === undefined) byType.set(child.type, [child])
    else bucket.push(child)
  }
  const clusters: UiTreeNode[][] = []
  for (const bucket of byType.values()) {
    const sorted = [...bucket].sort((a, b) => a.bounds.h - b.bounds.h)
    let current: UiTreeNode[] = []
    for (const node of sorted) {
      const previous = current[current.length - 1]
      if (previous === undefined) {
        current = [node]
        continue
      }
      const tolerance = Math.max(
        HEIGHT_TOLERANCE_PX,
        Math.min(previous.bounds.h, node.bounds.h) * HEIGHT_TOLERANCE_RATIO,
      )
      if (Math.abs(node.bounds.h - previous.bounds.h) <= tolerance) current.push(node)
      else {
        clusters.push(current)
        current = [node]
      }
    }
    if (current.length > 0) clusters.push(current)
  }
  return clusters.filter(cluster => cluster.length >= minRepeatedRows)
}

export interface DetectRowsOptions {
  /** Screen bounds in pixels (off-screen candidates are dropped + counted). */
  bounds: { width: number; height: number }
  /** Minimum siblings a run needs to count as "repeated" (default 3). */
  minRepeatedRows?: number
}

/**
 * Detect the visible rows of a list/feed screen.
 *
 * A candidate run is three-or-more children of ONE parent that share a class
 * and a near-equal height, where at least one member carries a label (text or
 * content-desc anywhere in its subtree) — that label is the evidence the run
 * holds content rather than layout scaffolding. Nested runs collapse to the
 * OUTERMOST one: when a candidate strictly contains another, the inner is
 * dropped, so a `RecyclerView` whose rows each hold a repeated chip strip
 * still reports the rows and not the chips.
 *
 * Rows come back top-to-bottom (then left-to-right) with a 0-based index, the
 * aggregated label, the parsed counters, and a group id shared by isomorphic
 * siblings. uiautomator keeps recycled/scrolled-out views in the dump with
 * their real coordinates, so candidates entirely outside the screen are
 * dropped and counted as `omittedOffscreen`.
 */
export function detectListRows(roots: readonly UiTreeNode[], options: DetectRowsOptions): DetectRowsResult {
  const minRepeatedRows = options.minRepeatedRows ?? MIN_REPEATED_ROWS
  const candidates: RowCandidate[] = []
  let nextGroup = 0
  const visit = (node: UiTreeNode): void => {
    if (node.children.length >= minRepeatedRows) {
      for (const cluster of clusterSiblings(node.children, minRepeatedRows, options.bounds.height)) {
        if (!cluster.some(member => aggregateRowLabel(member) !== undefined)) continue
        const group = nextGroup
        nextGroup += 1
        for (const member of cluster) candidates.push({ node: member, group })
      }
    }
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)

  // Outermost wins: a run nested inside another run's member is that member's
  // internal structure, not a list of its own.
  const outermost = candidates.filter(candidate => !candidates.some(other =>
    other !== candidate && strictlyContains(other.node.bounds, candidate.node.bounds)))

  let omittedOffscreen = 0
  const onscreen: RowCandidate[] = []
  for (const candidate of outermost) {
    if (isOffscreenBounds(candidate.node.bounds, options.bounds)) {
      omittedOffscreen += 1
      continue
    }
    // Same-frame duplicates (a wrapper listed twice) collapse to the first.
    if (onscreen.some(kept => sameFrame(kept.node.bounds, candidate.node.bounds))) continue
    onscreen.push(candidate)
  }

  const ordered = [...onscreen].sort((a, b) =>
    a.node.bounds.y - b.node.bounds.y || a.node.bounds.x - b.node.bounds.x)
  const rows: ListRow[] = ordered.map((candidate, index) => {
    const label = aggregateRowLabel(candidate.node)
    return {
      index,
      type: candidate.node.type,
      frame: {
        x: round2(candidate.node.bounds.x),
        y: round2(candidate.node.bounds.y),
        w: round2(candidate.node.bounds.w),
        h: round2(candidate.node.bounds.h),
      },
      ...(label === undefined ? {} : { label }),
      counts: label === undefined ? [] : parseCountsFromLabel(label),
      group: candidate.group,
    }
  })
  return {
    rows,
    repeatedGroups: new Set(rows.map(row => row.group)).size,
    omittedOffscreen,
  }
}

/** A row-tap plan: absolute tap point plus the relative fractions it came from. */
export interface RowTapPlan {
  row: ListRow
  /** Relative position inside the row frame (0..1). */
  inRow: { x: number; y: number }
  /** Absolute tap point in display pixels. */
  tap: { x: number; y: number }
}

function requireFraction(value: number, axis: 'x' | 'y'): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`android_tap_row: ${axis} must be a fraction within 0..1, got ${String(value)}`)
  }
}

/**
 * Plan a tap at a RELATIVE position inside row `index` (from a FRESH row
 * detection). Safety by construction: the row is located in the current screen
 * state, its frame must be on-screen, and an out-of-range index FAILS — it
 * never clamps to the last row, because a clamp would silently tap a different
 * item than the model asked for.
 */
export function planRowTap(
  rows: readonly ListRow[],
  index: number,
  fractionX: number,
  fractionY: number,
  bounds: { width: number; height: number },
): RowTapPlan {
  requireFraction(fractionX, 'x')
  requireFraction(fractionY, 'y')
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    throw new Error(
      `android_tap_row: row ${index} does not exist — the current screen has ${rows.length} visible row(s). `
      + 'Re-run android_ui_rows and tap a row index it actually reports; never tap a remembered position.',
    )
  }
  const row = rows[index]!
  if (isOffscreenBounds(row.frame, bounds)) {
    throw new Error(
      `android_tap_row: row ${index} lies off-screen — scroll it into view first (android_interact with a `
      + 'scroll action), then re-run android_ui_rows so the fresh dump re-locates it.',
    )
  }
  return {
    row,
    inRow: { x: fractionX, y: fractionY },
    tap: {
      x: Math.round(row.frame.x + fractionX * row.frame.w),
      y: Math.round(row.frame.y + fractionY * row.frame.h),
    },
  }
}

/**
 * The probe-guard: before a row tap may carry a count-change expectation, the
 * row's parsed counters MUST contain the target key. A missing key means the
 * tap target cannot be identified — the call refuses BEFORE any tap instead of
 * "tapping to see what happens" on a real account.
 */
export function requireCountKey(row: ListRow, key: string): number {
  const value = rowCountFor(row, key)
  if (value === undefined) {
    const shown = row.counts.length === 0
      ? 'the row label carries no counters at all'
      : `the row label parses to: ${row.counts.map(count => `${count.key}=${count.value}`).join(', ')}`
    throw new Error(
      `android_tap_row: cannot verify a ${JSON.stringify(key)} change — ${shown}. `
      + 'Re-run android_ui_rows and use one of the counter keys it actually reports; '
      + 'a tap on a control that cannot be identified is refused, never probed.',
    )
  }
  return value
}

/** Outcome of a count-change verification after a row action. */
export interface CountCheckResult {
  /** The expected counter key (normalized). */
  key: string
  /** The expected delta (+1 or -1). */
  delta: 1 | -1
  /** Value parsed before the action (absent = key was missing). */
  before?: number
  /** Value parsed after the action (absent = key missing on re-read). */
  after?: number
  /** True when after - before equals delta exactly. */
  verified: boolean
  /** True when the counter moved AT ALL (even in the wrong direction). */
  changed: boolean
  /** Why the check could not be a plain verified=true. */
  reason?: string
}

/** Acceptable deltas: exactly ±1 (a single toggle on a real account, nothing else). */
export function sanitizeCountDelta(delta: number): 1 | -1 {
  if (delta !== 1 && delta !== -1) {
    throw new Error(`android_tap_row: expect_count.delta must be +1 or -1 (a single toggle), got ${String(delta)}`)
  }
  return delta
}

/** True when the re-read row plausibly still IS the row that was tapped: its
 * frame stayed put (a scrolled list or a pushed screen means the counters
 * cannot be compared). */
export function rowsStayedPut(before: ListRow, after: ListRow): boolean {
  const driftY = Math.abs(after.frame.y - before.frame.y)
  const driftX = Math.abs(after.frame.x - before.frame.x)
  return driftY <= Math.max(8, before.frame.h * 0.25)
    && driftX <= Math.max(8, before.frame.w * 0.25)
}

/**
 * Compare the target counter between the before- and after- snapshots of the
 * same row. `verified` is true ONLY when both parses found the key and the
 * value moved exactly by `delta`. Everything else is reported as a reason,
 * never guessed: a missing before-key, a missing after-key (the label
 * changed), a moved row, or a counter that changed by the wrong amount.
 */
export function verifyCountChange(before: ListRow, after: ListRow, key: string, delta: 1 | -1): CountCheckResult {
  const normalized = normalizeCountKey(key)
  const beforeValue = rowCountFor(before, normalized)
  const afterValue = rowCountFor(after, normalized)
  if (beforeValue === undefined) {
    return {
      key: normalized,
      delta,
      ...(afterValue === undefined ? {} : { after: afterValue }),
      verified: false,
      changed: afterValue !== undefined,
      reason: 'the key was absent from the before label',
    }
  }
  if (afterValue === undefined) {
    return {
      key: normalized,
      delta,
      before: beforeValue,
      verified: false,
      changed: false,
      reason: 'the key is absent from the re-read label (the row text changed)',
    }
  }
  if (!rowsStayedPut(before, after)) {
    return {
      key: normalized,
      delta,
      before: beforeValue,
      after: afterValue,
      verified: false,
      changed: afterValue !== beforeValue,
      reason: 'the row moved after the action, so the counters are not comparable',
    }
  }
  const moved = afterValue - beforeValue
  return {
    key: normalized,
    delta,
    before: beforeValue,
    after: afterValue,
    verified: moved === delta,
    changed: moved !== 0,
    ...(moved === delta ? {} : { reason: `the counter moved by ${moved}, not the expected ${delta > 0 ? '+' : ''}${delta}` }),
  }
}
