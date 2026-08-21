/**
 * Stream-status capsule for the composer input dock
 * (`conversation.input.dock`, the same seat openpencil's selection chip uses).
 *
 * While the device panel is CLOSED and a device stream is online, the capsule
 * renders a small pill above the message input box: green dot + device name +
 * "实时". (A gray idle variant is deliberately NOT rendered — the capsule only
 * appears while a stream is actually running.) Clicking the pill opens the
 * sidebar panel for the streamed device via the SAME panel store the panel
 * host uses; the panel's existing grant flow does the rest.
 *
 * SESSION GATE: the dock seat is session-scoped, so the framework hands this
 * component the current `sessionId`. The capsule renders AND polls only while
 * that session has at least one registered panel source (a settled Android
 * result whose card is mounted in THIS session). A brand-new empty session has
 * no sources, so the pill never shows there even though the global stream
 * keeps running; the status poll likewise never starts. Sources unregister on
 * card unmount, so switching to an unrelated session hides the capsule and
 * stops the poll.
 *
 * Stream knowledge comes from the read-only host route
 * `POST /_dsh/dsh-android/status` (`{running, serial?, deviceName?}`), polled
 * every ~5 s while gated on and the panel is closed. Polling stops while the
 * panel is open, refreshes immediately (debounced) when a tool result lands in
 * the panel-source registry, and fully cleans up on unmount. The poll loop
 * lives in `createAndroidStatusPoller` — a timer-injectable controller the
 * static smoke drives with a fake clock to prove the fetcher is never called
 * while the session has no sources.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { androidCopy, type AndroidLocale } from './copy.js'
import {
  ANDROID_CARD_TOOLS,
  requestAndroidStatus,
  type AndroidStreamStatus,
} from './protocol.js'
import {
  hasAndroidPanelSourceForSession,
  androidPanelSourcesVersion,
  subscribeAndroidPanelSources,
} from './android-panel-trigger.js'
import {
  androidPanelStore,
  type AndroidPanelRequest,
  type AndroidPanelStore,
} from './android-panel-host.js'

/** Capsule polling cadence while the panel is closed. */
export const ANDROID_STATUS_POLL_MS = 5000
/** Debounce for the panel-source-registry refresh (registration bursts). */
export const ANDROID_STATUS_REFRESH_DEBOUNCE_MS = 150

export type AndroidStatusFetcher = () => Promise<AndroidStreamStatus>

/** The browser default: POST the read-only host status route. */
export function fetchAndroidStreamStatus(): Promise<AndroidStreamStatus> {
  return requestAndroidStatus(fetch)
}

/**
 * Build the synthetic `android-stream` panel request for a streamed device: a
 * settled `android_boot`-shaped block whose presentationMeta carries the
 * device, so the panel's stream mode + grant flow take over from there. The
 * request is tagged with the session the capsule was clicked in.
 */
export function androidStreamStatusRequestOf(
  status: AndroidStreamStatus,
  sessionId = '',
): AndroidPanelRequest {
  const device = {
    ...(status.serial === undefined ? {} : { serial: status.serial }),
    ...(status.deviceName === undefined ? {} : { name: status.deviceName }),
  }
  const callId = `dsh-android:status:${status.serial ?? 'stream'}`
  const block: ToolCallBlock = {
    kind: 'tool-result',
    seq: 1,
    time: Date.now(),
    callId,
    call: { name: ANDROID_CARD_TOOLS.boot, argsRaw: '{}' },
    callTime: Date.now(),
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    meta: { kind: 'android-stream', device },
  }
  return { sessionId, callId, toolName: ANDROID_CARD_TOOLS.boot, block }
}

// ── poll controller (timer-injectable; the smoke drives it with a fake clock) ──

/** Timer surface the poller needs (defaults to the real global timers). */
export interface AndroidStatusPollTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

function defaultPollTimers(): AndroidStatusPollTimers {
  return {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: handle => { clearInterval(handle as ReturnType<typeof setInterval>) },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
  }
}

/**
 * The capsule's poll loop as a small stateful controller: `setEnabled(true)`
 * starts an immediate poll + an interval; `setEnabled(false)` stops both and
 * drops any in-flight result; `refreshSoon()` schedules one debounced poll
 * (registry changes) and no-ops while disabled. Fully deterministic under an
 * injected timer for the static smoke — the fetcher is never called until the
 * capsule is actually gated on.
 */
export function createAndroidStatusPoller(options: {
  fetchStatus: AndroidStatusFetcher
  pollIntervalMs: number
  onStatus: (status: AndroidStreamStatus) => void
  refreshDebounceMs?: number
  timers?: AndroidStatusPollTimers
}): {
  setEnabled: (enabled: boolean) => void
  refreshSoon: () => void
  dispose: () => void
} {
  const { fetchStatus, pollIntervalMs, onStatus } = options
  const refreshDebounceMs = options.refreshDebounceMs ?? ANDROID_STATUS_REFRESH_DEBOUNCE_MS
  const timers = options.timers ?? defaultPollTimers()
  let enabled = false
  let disposed = false
  let inflight = false
  let intervalHandle: unknown
  let debounceHandle: unknown

  const poll = async (): Promise<void> => {
    if (!enabled || disposed || inflight) return
    inflight = true
    try {
      const next = await fetchStatus()
      // A poll that finished after the gate closed is dropped (last snapshot kept).
      if (enabled && !disposed) onStatus(next)
    } catch {
      // Keep the last snapshot on a failed poll (never a throw in the dock).
    } finally {
      inflight = false
    }
  }

  return {
    setEnabled(next) {
      if (disposed || next === enabled) return
      enabled = next
      if (enabled) {
        void poll()
        intervalHandle = timers.setInterval(() => { void poll() }, pollIntervalMs)
      } else {
        if (intervalHandle !== undefined) {
          timers.clearInterval(intervalHandle)
          intervalHandle = undefined
        }
        if (debounceHandle !== undefined) {
          timers.clearTimeout(debounceHandle)
          debounceHandle = undefined
        }
      }
    },
    refreshSoon() {
      if (!enabled || disposed) return
      if (debounceHandle !== undefined) timers.clearTimeout(debounceHandle)
      debounceHandle = timers.setTimeout(() => {
        debounceHandle = undefined
        void poll()
      }, refreshDebounceMs)
    },
    dispose() {
      disposed = true
      if (intervalHandle !== undefined) timers.clearInterval(intervalHandle)
      if (debounceHandle !== undefined) timers.clearTimeout(debounceHandle)
      intervalHandle = undefined
      debounceHandle = undefined
    },
  }
}

// ── presentation ─────────────────────────────────────────────────────────────

const CAPSULE_DOCK_LAYOUT: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  width: 'calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))',
  maxWidth: 'calc(var(--dsh-composer-card-max-width, 780px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))',
  margin: '0 auto',
}

/**
 * The pill tracks the DSH theme with the same tokens openpencil's selection
 * chip uses in this exact seat (`--dsw-alias-*`), so it is legible in both
 * light and dark themes — only the green dot keeps a literal color.
 */
const CAPSULE_PILL_STYLES: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  maxWidth: '100%',
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'left',
}

const CAPSULE_DOT_STYLES: CSSProperties = {
  width: 8,
  height: 8,
  flex: 'none',
  borderRadius: '50%',
  background: '#22c55e',
  boxShadow: '0 0 8px rgba(34,197,94,0.8)',
}

export interface AndroidStatusCapsuleBodyProps {
  status: AndroidStreamStatus | undefined
  panelOpen: boolean
  /** True while the current session has at least one registered panel source. */
  hasAndroidSources: boolean
  locale: AndroidLocale
  onOpen: () => void
}

/**
 * Pure capsule presentation: null when the panel is open, the current session
 * has no Android sources, or the stream is not running; otherwise a green-dot
 * pill with the device name + 实时 that opens the panel on click. Exported for
 * static (SSR) smoke tests.
 */
export function AndroidStatusCapsuleBody({
  status,
  panelOpen,
  hasAndroidSources,
  locale,
  onOpen,
}: AndroidStatusCapsuleBodyProps): React.JSX.Element | null {
  const copy = androidCopy(locale)
  if (panelOpen || !hasAndroidSources || status === undefined || status.running !== true) return null
  const deviceLabel = status.deviceName ?? status.serial ?? copy.android
  return (
    <div style={CAPSULE_DOCK_LAYOUT} data-android-status-capsule-slot="true">
      <button
        type="button"
        style={CAPSULE_PILL_STYLES}
        onClick={onOpen}
        aria-label={copy.openAndroidPanel}
        data-android-status-capsule="live"
        {...(status.serial === undefined ? {} : { 'data-android-status-device': status.serial })}
      >
        <span style={CAPSULE_DOT_STYLES} aria-hidden="true" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {`${deviceLabel} · ${copy.live}`}
        </span>
      </button>
    </div>
  )
}

export interface AndroidStatusCapsuleProps {
  /** The panel store (defaults to the shared plugin instance). */
  store?: AndroidPanelStore
  /** Status source (defaults to the read-only host status route). */
  fetchStatus?: AndroidStatusFetcher
  pollIntervalMs?: number
  locale: AndroidLocale
  /** The current session id from the session-scoped dock seat. */
  sessionId?: string
}

/**
 * Connected capsule: subscribes to the shared panel store (panel open/close)
 * and to the panel-source registry (session gate), polls the status fetcher
 * only while the panel is closed AND the current session has Android sources,
 * and opens the panel on click.
 */
export function AndroidStatusCapsule({
  store = androidPanelStore(),
  fetchStatus = fetchAndroidStreamStatus,
  pollIntervalMs = ANDROID_STATUS_POLL_MS,
  locale,
  sessionId = '',
}: AndroidStatusCapsuleProps): React.JSX.Element | null {
  const request = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const panelOpen = request !== undefined
  // Re-render on every registry change; `hasSources` itself is derived from
  // the registry in render so a source unregistering hides the pill at once.
  const sourcesVersion = useSyncExternalStore(
    subscribeAndroidPanelSources,
    androidPanelSourcesVersion,
    androidPanelSourcesVersion,
  )
  const hasSources = sourcesVersion >= 0 && hasAndroidPanelSourceForSession(sessionId)
  const [status, setStatus] = useState<AndroidStreamStatus>()

  const fetchRef = useRef(fetchStatus)
  fetchRef.current = fetchStatus
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const statusRef = useRef(status)
  statusRef.current = status

  // The poll starts/stops reactively: enabled only while the panel is closed
  // AND the current session has sources (a new empty session never polls).
  const pollingEnabled = !panelOpen && hasSources
  useEffect(() => {
    const poller = createAndroidStatusPoller({
      fetchStatus: () => fetchRef.current(),
      pollIntervalMs,
      onStatus: setStatus,
    })
    poller.setEnabled(pollingEnabled)
    // Registry changes gate the poll AND refresh it (a result landing may mean
    // its stream just started — debounced because registrations burst).
    const unsubscribeSources = subscribeAndroidPanelSources(() => { poller.refreshSoon() })
    return () => {
      unsubscribeSources()
      poller.dispose()
    }
  }, [pollingEnabled, pollIntervalMs])

  const onOpen = useCallback((): void => {
    const current = statusRef.current
    if (current === undefined || current.running !== true) return
    store.open(androidStreamStatusRequestOf(current, sessionIdRef.current))
  }, [store])

  return (
    <AndroidStatusCapsuleBody
      status={status}
      panelOpen={panelOpen}
      hasAndroidSources={hasSources}
      locale={locale}
      onOpen={onOpen}
    />
  )
}
