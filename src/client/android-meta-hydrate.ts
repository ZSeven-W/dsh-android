/**
 * Client-side reconstruction of the dsh-android presentationMeta for nested
 * Code Mode (PTC) tool calls.
 *
 * DSH projects `output.presentationMeta` into a settled tool result ONLY for
 * top-level calls (harness `createSuccessResult`: `exec.parent === undefined`).
 * In Code Mode the model composes tools from a TypeScript program, so every
 * `android_*` call is a nested dispatch whose client block carries the FULL
 * durable result JSON in `content` but no `meta` — without this module the
 * cards degrade to the no-preview fallback and never register a panel source,
 * so the sidebar panel and the status capsule stay dead too.
 *
 * The plugin's presentationMeta is deliberately stable and fully derivable
 * from that durable result JSON:
 * - `android_boot`       → `{kind:'android-stream', device, streamRouteId}`
 *   (streamRouteId = `dsh-android/stream/<device.serial>`), gated on
 *   `streaming === true` with `state` of `'streaming'` (or legacy `'booted'`);
 * - `android_screenshot` → `{kind:'android-screenshot', screenshotPath, path,
 *   device}` from an ABSOLUTE `path` + a non-negative `bytes`;
 * - `android_interact`   → the same envelope (one shared host projector);
 * - `android_build_run`  → `{kind:'android-build-run', device, packageName,
 *   apkPath?}`, gated on `state === 'launched'`.
 *
 * Reconstructed screenshot paths are still validated as absolute paths here;
 * the host `/grant` route re-validates every path against the plugin cache
 * directory server-side (no symlink escape, cache-only), so rebuilding meta
 * client-side changes nothing about the trust boundary. Malformed, truncated,
 * or unexpected results resolve `null` (never a throw) and the cards keep
 * today's plain fallback UI.
 *
 * @module @zseven-w/dsh-android/client/android-meta-hydrate
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ANDROID_CARD_TOOLS,
  parseAndroidMeta,
  type AndroidDeviceInfo,
  type AndroidMeta,
} from './protocol.js'

/** Where a card's presentation meta came from (debuggability only). */
export type AndroidMetaSource = 'meta' | 'hydrated'

/** The meta a card/panel should render plus its origin. */
export interface ResolvedAndroidMeta {
  meta: AndroidMeta
  source: AndroidMetaSource
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The screenshot/apk paths the host emits are always POSIX absolute. */
function isPosixAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/')
}

/** Non-negative finite byte count (required by every screenshot result). */
function isByteCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Interact actions the tool schema allows (distinguishes interact results). */
const INTERACT_ACTIONS = new Set(['tap', 'type', 'button', 'gesture', 'scroll'])

/**
 * Parse the durable result's device record. The serial is mandatory: every
 * grant/control flow addresses the device by serial and `streamRouteId`
 * derives from it.
 */
function parseDevice(value: unknown): AndroidDeviceInfo | undefined {
  if (!isRecord(value)) return undefined
  const serial = nonEmptyString(value.serial)
  if (serial === undefined) return undefined
  const device: AndroidDeviceInfo = { serial }
  const name = nonEmptyString(value.name) ?? nonEmptyString(value.model)
  const androidVersion = nonEmptyString(value.androidVersion)
  const state = nonEmptyString(value.state)
  if (name !== undefined) device.name = name
  if (androidVersion !== undefined) device.androidVersion = androidVersion
  if (state !== undefined) device.state = state
  return device
}

/** `android_boot` → the exact `android-stream` envelope the host projects. */
function hydrateStreamMeta(value: unknown): AndroidMeta | null {
  // The server reports state:'streaming' (it distinguishes a cold AVD boot
  // via the separate `booted` flag); accept 'booted' too for forward slack.
  if (!isRecord(value) || value.streaming !== true) return null
  if (value.state !== 'streaming' && value.state !== 'booted') return null
  const device = parseDevice(value.device)
  if (device === undefined) return null
  return { kind: 'android-stream', device, streamRouteId: `dsh-android/stream/${device.serial}` }
}

/** `android_screenshot` / `android_interact` → the screenshot envelope. */
function hydrateScreenshotMeta(value: unknown, interact: boolean): AndroidMeta | null {
  if (!isRecord(value)) return null
  if (interact) {
    const action = value.action
    if (typeof action !== 'string' || !INTERACT_ACTIONS.has(action)) return null
  }
  const path = isPosixAbsolutePath(value.path) ? value.path : undefined
  if (path === undefined || !isByteCount(value.bytes)) return null
  const device = parseDevice(value.device)
  if (device === undefined) return null
  return { kind: 'android-screenshot', screenshotPath: path, path, device }
}

/** `android_build_run` → the exact `android-build-run` envelope. */
function hydrateBuildRunMeta(value: unknown): AndroidMeta | null {
  if (!isRecord(value) || value.state !== 'launched') return null
  const packageName = nonEmptyString(value.packageName)
  if (packageName === undefined) return null
  const device = parseDevice(value.device)
  if (device === undefined) return null
  // The apk path is a nice-to-have (the tool may install a pre-built apk it
  // never re-reports); the package name is what the panel actually needs.
  const apkPath = isPosixAbsolutePath(value.apkPath) ? value.apkPath : undefined
  return {
    kind: 'android-build-run',
    device,
    packageName,
    ...(apkPath === undefined ? {} : { apkPath }),
  }
}

/** Rebuild the meta for one settled, non-error tool result (or null). */
function hydrateAndroidMetaValue(toolName: string, value: Record<string, unknown>): AndroidMeta | null {
  if (toolName === ANDROID_CARD_TOOLS.boot) return hydrateStreamMeta(value)
  if (toolName === ANDROID_CARD_TOOLS.screenshot || toolName === ANDROID_CARD_TOOLS.interact) {
    return hydrateScreenshotMeta(value, toolName === ANDROID_CARD_TOOLS.interact)
  }
  if (toolName === ANDROID_CARD_TOOLS.buildRun) return hydrateBuildRunMeta(value)
  return null
}

/**
 * Rebuild the exact presentationMeta from a settled tool result's durable
 * JSON text (the first text content block that parses as a JSON object).
 * Resolves `null` — never throws — when the result cannot be validated, in
 * which case the cards keep today's plain fallback UI.
 */
export function hydrateAndroidMeta(toolName: string, block: ToolCallBlock): AndroidMeta | null {
  if (!('kind' in block) || block.kind !== 'tool-result' || block.isError) return null
  for (const item of block.content) {
    if (item.type !== 'text') continue
    let value: unknown
    try {
      value = JSON.parse(item.text)
    } catch {
      continue
    }
    if (!isRecord(value)) continue
    const hydrated = hydrateAndroidMetaValue(toolName, value)
    if (hydrated !== null) return hydrated
  }
  return null
}

/**
 * The single meta resolution every card and the panel share: the
 * host-projected `presentationMeta` always wins (standard-mode sessions are
 * untouched), and a nested Code Mode result reconstructs the same meta from
 * its durable JSON text. Unsettled/error results resolve `undefined`.
 */
export function resolveAndroidMeta(toolName: string, block: ToolCallBlock): ResolvedAndroidMeta | undefined {
  if (!('kind' in block) || block.kind !== 'tool-result' || block.isError) return undefined
  const projected = parseAndroidMeta(block.meta)
  if (projected !== undefined) return { meta: projected, source: 'meta' }
  const hydrated = hydrateAndroidMeta(toolName, block)
  return hydrated === null ? undefined : { meta: hydrated, source: 'hydrated' }
}
