/**
 * Row-click trigger for the plugin-owned device panel (the rc.6 fallback
 * surface — the per-tool `tool.details.toolview` seat is not declared by the
 * installed runtime, so this package opens its own right-side panel).
 *
 * Cards register their settled, meta-carrying results in the source registry
 * as they mount. A document-level capture listener turns a click on that
 * call's tool row (`[data-chat-call-id]` wrapper around the card) into an
 * open request — the same gesture DSH uses to open 详情 for a tool. Clicks on
 * interactive elements (buttons/links), on the live frame itself (which is
 * tap/drag surface for the device), and inside the panel never trigger. The
 * listener is installed only while the per-tool details seat is absent and is
 * disposed if a runtime later declares it.
 *
 * Every source carries the framework-supplied `sessionId` of the card that
 * registered it, and cards unregister on unmount — so after a session switch
 * the registry reflects only the CURRENT session's mounted results. The
 * stream-status capsule uses exactly that: it renders (and polls) only while
 * the current session has at least one source.
 */

import { useEffect } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

export interface AndroidPanelSource {
  sessionId: string
  callId: string
  toolName: string
  block: ToolCallBlock
}

const sources = new Map<string, AndroidPanelSource>()
const sourceListeners = new Set<() => void>()

/**
 * Monotonic registry change counter. The status capsule reads it through
 * `useSyncExternalStore` so it re-renders (and starts/stops its status poll)
 * whenever sources land or leave — including a session switch, where the old
 * session's cards unmount and unregister their sources.
 */
let sourceVersion = 0

function emitSourceChange(): void {
  sourceVersion += 1
  for (const listener of sourceListeners) listener()
}

/** Remember one openable result; returns the unregister disposer. */
export function registerAndroidPanelSource(source: AndroidPanelSource): () => void {
  sources.set(source.callId, source)
  emitSourceChange()
  return () => {
    if (sources.get(source.callId) === source) {
      sources.delete(source.callId)
      emitSourceChange()
    }
  }
}

/** Subscribe to panel-source registry changes (tool results landing/leaving). */
export function subscribeAndroidPanelSources(listener: () => void): () => void {
  sourceListeners.add(listener)
  return () => { sourceListeners.delete(listener) }
}

/** The registry change counter (stable between changes, for `useSyncExternalStore`). */
export function androidPanelSourcesVersion(): number {
  return sourceVersion
}

/**
 * A point-in-time snapshot of every registered source. The panel's
 * auto-follow engine scans it for the newest settled result of the current
 * session and re-targets to that result's device.
 */
export function androidPanelSourcesSnapshot(): AndroidPanelSource[] {
  return Array.from(sources.values())
}

/**
 * True while at least one registered source belongs to the given session.
 * This is the capsule's session gate: a new empty session has no sources, so
 * the capsule stays hidden there even while the global stream runs.
 */
export function hasAndroidPanelSourceForSession(sessionId: string): boolean {
  if (sessionId === '') return false
  for (const source of sources.values()) {
    if (source.sessionId === sessionId) return true
  }
  return false
}

export function resolveAndroidPanelSource(callId: string): AndroidPanelSource | undefined {
  return sources.get(callId)
}

/** Register a card's settled result while it is mounted. */
export function useAndroidPanelSource(enabled: boolean, source: AndroidPanelSource | undefined): void {
  useEffect(() => {
    if (!enabled || source === undefined) return
    return registerAndroidPanelSource(source)
  }, [enabled, source])
}

/** Elements whose clicks never open the panel. */
export const ANDROID_PANEL_INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  // A tap/drag on a LIVE frame is device interaction, not a panel-open
  // gesture; the granting/fallback frame bodies stay clickable.
  '[data-android-live-frame][data-android-frame-state="live"]',
  // Anything inside the panel itself (interaction + controls).
  '[data-android-panel]',
].join(',')

/** Structural face of an event target (satisfied by `Element` and fakes). */
export interface AndroidPanelClickTargetLike {
  closest(selector: string): { dataset?: Record<string, string | undefined> } | null
}

/** True when the click lands on a control or on a device surface itself. */
export function androidPanelClickIsInteractive(target: AndroidPanelClickTargetLike): boolean {
  return target.closest(ANDROID_PANEL_INTERACTIVE_SELECTOR) !== null
}

/** The tool-row call id the click addressed, if any. */
export function androidPanelClickRowCallIdOf(target: AndroidPanelClickTargetLike): string | undefined {
  const row = target.closest('[data-chat-call-id]')
  const callId = row?.dataset?.chatCallId
  return typeof callId === 'string' && callId !== '' ? callId : undefined
}

/**
 * Install the document-level row-click listener. Fires on the capture phase
 * so it observes the gesture before any inner handler; it never stops
 * propagation, so the host's own row behavior is untouched.
 */
export function installAndroidPanelRowTrigger(
  doc: Document,
  open: (source: AndroidPanelSource) => boolean,
): () => void {
  const onClick = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (androidPanelClickIsInteractive(target)) return
    const callId = androidPanelClickRowCallIdOf(target)
    if (callId === undefined) return
    const source = resolveAndroidPanelSource(callId)
    if (source === undefined) return
    open(source)
  }
  doc.addEventListener('click', onClick, true)
  return () => {
    doc.removeEventListener('click', onClick, true)
  }
}
