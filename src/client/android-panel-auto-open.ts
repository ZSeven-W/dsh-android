/**
 * Auto-open for the device panel when a device is explicitly STARTED.
 *
 * The panel is normally opened by a user gesture (a row click, the input-dock
 * capsule, a device pick). When the AGENT runs the explicit start verb —
 * `android_boot` — the user asked for a device to come up, so the panel
 * should open by itself the moment the settled result lands, exactly like
 * dsh-openpencil auto-opens its editor after `openpencil_render`.
 *
 * This module is PURE (no React, no DOM, no network) so the dev-panel-smoke
 * script can drive the decision and the one-shot registry directly. The
 * guards mirror openpencil's `liveAutoOpen*` helpers and all three matter:
 *
 * - settled-and-not-error: the caller short-circuits on `running`/`error`
 *   BEFORE consulting the decision, so a still-running call never opens and
 *   a failed start never opens;
 * - one-shot: `takeAndroidPanelAutoOpenCall` consumes the key exactly once,
 *   so a re-render of the settled card never reopens the panel, and a user
 *   CLOSE is never fought (that call already consumed its open);
 * - activation timestamp: only blocks whose own `block.time` is at least the
 *   activation time count, so scrolling back through an old session replays
 *   the cards WITHOUT re-opening the panel.
 */

import { ANDROID_CARD_TOOLS } from './protocol.js'

/** The ONE start verb that auto-opens the panel; nothing else does. */
export const ANDROID_PANEL_AUTO_OPEN_TOOLS: readonly string[] = [
  ANDROID_CARD_TOOLS.boot,
]

/** One-shot entries expire after this (mirrors openpencil's TTL). */
const ANDROID_PANEL_AUTO_OPEN_TTL_MS = 15 * 60 * 1000
/** Ceiling on remembered calls so an idle session cannot grow unbounded. */
const ANDROID_PANEL_AUTO_OPEN_MAX = 256

/**
 * Client activation timestamp. The bundle module is evaluated once per page
 * load, so a call only auto-opens when its block is NEWER than this — a
 * history replay (which re-mounts old cards with old `block.time`) stays
 * silent.
 */
export const androidPanelAutoOpenActivatedAt = Date.now()

const autoOpenCalls = new Map<string, number>()

/** The one-shot registry key: session + call identity, like openpencil. */
export function androidPanelAutoOpenKey(sessionId: string, callId: string): string {
  return `${sessionId.length}:${sessionId}${callId}`
}

function pruneAutoOpenCalls(now = Date.now()): void {
  for (const [key, expiresAt] of autoOpenCalls) {
    if (expiresAt <= now) autoOpenCalls.delete(key)
  }
  while (autoOpenCalls.size > ANDROID_PANEL_AUTO_OPEN_MAX) {
    const oldest = autoOpenCalls.keys().next().value as string | undefined
    if (oldest === undefined) break
    autoOpenCalls.delete(oldest)
  }
}

/** Arm the key while the call runs, so its settle can take it exactly once. */
export function rememberAndroidPanelAutoOpenCall(key: string): void {
  autoOpenCalls.delete(key)
  autoOpenCalls.set(key, Date.now() + ANDROID_PANEL_AUTO_OPEN_TTL_MS)
  pruneAutoOpenCalls()
}

/** Consume the key exactly once; false after the first take (or when absent). */
export function takeAndroidPanelAutoOpenCall(key: string): boolean {
  pruneAutoOpenCalls()
  if (!autoOpenCalls.has(key)) return false
  autoOpenCalls.delete(key)
  return true
}

/** Forget the key after an error so a later successful result may take it. */
export function forgetAndroidPanelAutoOpenCall(key: string): void {
  autoOpenCalls.delete(key)
}

/** Inputs to the pure decision (all caller-supplied; no clock reads inside). */
export interface AndroidPanelAutoOpenDecision {
  toolName: string
  isError: boolean
  /** The result's own timestamp (`ToolCallBlock.time`), not now(). */
  blockTime: number
  /** The call's session (the card's framework-supplied `sessionId`). */
  sessionId: string
  /** The module-load activation timestamp (see above). */
  activatedAt: number
  /** The CURRENT session, supplied separately so a stale result is rejected. */
  currentSessionId: string
}

/**
 * Pure auto-open decision: true only for a settled, non-error START verb in
 * the CURRENT session whose block is at least as new as activation. Every
 * guard is explicit so the smoke can assert each one independently.
 */
export function androidPanelAutoOpenShouldOpen(input: AndroidPanelAutoOpenDecision): boolean {
  if (input.isError) return false
  if (!ANDROID_PANEL_AUTO_OPEN_TOOLS.includes(input.toolName)) return false
  if (input.sessionId === '' || input.sessionId !== input.currentSessionId) return false
  if (typeof input.blockTime !== 'number' || !Number.isFinite(input.blockTime)) return false
  if (input.blockTime < input.activatedAt) return false
  return true
}
