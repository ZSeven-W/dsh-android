/**
 * Page-stable owner for the plugin-owned device panel.
 *
 * Mirrors dsh-openpencil's `mountEditorWorkbenchHost`: the rc.6 runtime has
 * no per-tool details seat, so the plugin mounts its own imperative React
 * root on `document.body` and docks the panel as a fixed right-hand column
 * that stays visible while the conversation scrolls. A dock lease on the DSH
 * root's `margin-right` (see android-panel-dock) pushes the AppFrame over so
 * the panel covers nothing; when the dock is unavailable (narrow viewport,
 * root missing, or another plugin owns the margin) the surface falls back to
 * a centered overlay. The left-edge handle drags the panel wider/narrower
 * (double-click resets to the default width), and while the streamed frame is
 * LANDSCAPE the panel auto-widens to a comfortable device-sized width —
 * restoring the user's portrait width when the device rotates back, and never
 * fighting a manual drag made during the landscape stint.
 *
 * "Landscape" is read straight off the frame's natural dimensions
 * (`naturalWidth > naturalHeight`): an Android frame follows the display
 * rotation, so there is no orientation vocabulary to track like dsh-ios had.
 *
 * Device switch: the panel's picker calls back through `onDeviceSwitched`;
 * the surface replaces the open request with a capsule-style synthetic
 * stream source (`androidSwitchedPanelRequestOf`, SAME request identity so
 * the mounted panel — and its size/frame state — survives the swap) via
 * `store.replaceOpen`, and keeps the panel-source registry entry in sync so
 * reopening stays on the new device.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { AndroidPanel } from './android-panel-connected.js'
import { androidCopy } from './copy.js'
import { claimAndroidPanelDock, type AndroidPanelDockLease } from './android-panel-dock.js'
import { registerAndroidPanelSource } from './android-panel-trigger.js'
import { androidSwitchedStreamMetaOf, ANDROID_DEVICE_PICKER_KEYFRAMES } from './android-device-picker.js'
import type { AndroidSwitchResponse } from './protocol.js'
import {
  ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT,
  ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH,
  ANDROID_PANEL_SIZE_MODE_FIT,
  androidPanelSnapPxOf,
  type AndroidPanelSizeMode,
} from './android-panel-size.js'
import { ANDROID_FRAME_STYLE_BEZEL, type AndroidFrameStyle } from './android-frame-style.js'

export interface AndroidPanelRequest {
  sessionId: string
  callId: string
  toolName: string
  block: ToolCallBlock
}

/** Stable identity of one request — reopening the same call is a no-op. */
export function androidPanelRequestKey(request: AndroidPanelRequest): string {
  return `${request.sessionId}\n${request.callId}\n${request.toolName}`
}

/**
 * Synthetic panel request for a switched device — the capsule-style source:
 * SAME session/call/tool identity (so the panel's request key — and the
 * mounted panel itself — never change: size/frame state and the in-flight
 * seeded grant survive the swap), but the block carries the new device's
 * `android-stream` meta, so panel meta follows the switch. The panel host
 * replaces the open store request AND the source-registry entry with this, so
 * closing/reopening (or a row click) stays on the new device.
 */
export function androidSwitchedPanelRequestOf(
  request: AndroidPanelRequest,
  result: AndroidSwitchResponse,
): AndroidPanelRequest {
  const block: ToolCallBlock = {
    kind: 'tool-result',
    seq: 1,
    time: Date.now(),
    callId: request.callId,
    call: { name: request.toolName, argsRaw: '{}' },
    callTime: Date.now(),
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    meta: androidSwitchedStreamMetaOf(result),
  }
  return { ...request, block }
}

type Listener = () => void

export interface AndroidPanelStore {
  getSnapshot: () => AndroidPanelRequest | undefined
  /** The display size mode, persisted in-memory for the host's lifetime. */
  getSizeMode: () => AndroidPanelSizeMode
  setSizeMode: (mode: AndroidPanelSizeMode) => void
  /** The frame shell mode, persisted in-memory for the host's lifetime. */
  getFrameStyle: () => AndroidFrameStyle
  setFrameStyle: (style: AndroidFrameStyle) => void
  subscribe: (listener: Listener) => () => void
  open: (request: AndroidPanelRequest) => boolean
  /** Replace the OPEN request in place (device switch): same identity key,
   * new block — the mounted panel stays mounted and its meta follows. No-op
   * (false) while the panel is closed. */
  replaceOpen: (request: AndroidPanelRequest) => boolean
  close: () => void
}

/** Small external store deliberately not owned by any Tool card. */
export function createAndroidPanelStore(): AndroidPanelStore {
  let current: AndroidPanelRequest | undefined
  let sizeMode: AndroidPanelSizeMode = ANDROID_PANEL_SIZE_MODE_FIT
  let frameStyle: AndroidFrameStyle = ANDROID_FRAME_STYLE_BEZEL
  const listeners = new Set<Listener>()
  const emit = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => current,
    getSizeMode: () => sizeMode,
    setSizeMode(mode) {
      if (sizeMode === mode) return
      sizeMode = mode
      emit()
    },
    getFrameStyle: () => frameStyle,
    setFrameStyle(style) {
      if (frameStyle === style) return
      frameStyle = style
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open(request) {
      current = request
      emit()
      return true
    },
    replaceOpen(request) {
      if (current === undefined) return false
      current = request
      emit()
      return true
    },
    close() {
      if (current === undefined) return
      current = undefined
      emit()
    },
  }
}

let sharedPanelStore: AndroidPanelStore | undefined

/**
 * The one plugin-wide panel store instance. The page-owned panel host and the
 * input-dock status capsule subscribe to the SAME instance, so the capsule
 * can read the panel's open/closed state and open the panel itself. Created
 * lazily so headless renders never touch it; `createAndroidPanelStore` stays
 * exported for standalone tests.
 */
export function androidPanelStore(): AndroidPanelStore {
  sharedPanelStore ??= createAndroidPanelStore()
  return sharedPanelStore
}

export interface AndroidPanelHostOptions {
  subscribeTheme: (listener: Listener) => () => unknown
  getColorScheme: () => 'light' | 'dark'
  subscribeLocale: (listener: Listener) => () => unknown
  getLocale: () => string
  document?: Document
}

export interface AndroidPanelHost {
  open: (request: AndroidPanelRequest) => boolean
  /**
   * Open only while the panel is CLOSED (the auto-open path): an already-open
   * panel is never replaced, mirroring openpencil's `openIfIdle`. The store
   * snapshot is the single source of truth for open/closed — no second flag.
   */
  openIfIdle: (request: AndroidPanelRequest) => boolean
  close: () => void
  dispose: () => void
}

// ── surface geometry (mirrors openpencil's workbench width policy) ──────────

export const ANDROID_PANEL_FULLSCREEN_BREAKPOINT = 760
export const ANDROID_PANEL_MIN_WIDTH = 320
export const ANDROID_PANEL_MAX_WIDTH = 960
export const ANDROID_PANEL_LEFT_CLEARANCE = 640
export const ANDROID_PANEL_DEFAULT_WIDTH = 380

export interface AndroidPanelWidthBounds {
  min: number
  max: number
  initial: number
}

/** Keep useful DSH conversation space while allowing a large landscape canvas. */
export function androidPanelWidthBounds(viewportWidth: number): AndroidPanelWidthBounds {
  const safeViewport = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const available = Math.max(0, safeViewport - ANDROID_PANEL_LEFT_CLEARANCE)
  const max = Math.min(ANDROID_PANEL_MAX_WIDTH, Math.max(ANDROID_PANEL_MIN_WIDTH, available))
  const min = Math.min(ANDROID_PANEL_MIN_WIDTH, max)
  return { min, max, initial: Math.min(max, Math.max(min, ANDROID_PANEL_DEFAULT_WIDTH)) }
}

export function clampAndroidPanelWidth(width: number, viewportWidth: number): number {
  const bounds = androidPanelWidthBounds(viewportWidth)
  const safeWidth = Number.isFinite(width) ? width : bounds.initial
  return Math.min(bounds.max, Math.max(bounds.min, safeWidth))
}

/** A left-edge drag grows the docked panel as the pointer moves left. */
export function resizedAndroidPanelWidth(
  startWidth: number,
  startClientX: number,
  clientX: number,
  viewportWidth: number,
): number {
  return clampAndroidPanelWidth(startWidth + startClientX - clientX, viewportWidth)
}

// ── landscape auto-widen (the frame's own aspect drives the panel width) ────

/** Comfortable landscape display height the auto-widen target fits (px). */
export const ANDROID_PANEL_LANDSCAPE_HEIGHT_PX = 420

/** One display report for the panel host: the frame's natural pixel size. */
export interface AndroidPanelDisplayReport {
  naturalWidth: number | undefined
  naturalHeight: number | undefined
}

/** True while the streamed frame is wider than tall (a landscape stint). */
export function androidPanelDisplayIsLandscape(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): boolean {
  return typeof naturalWidth === 'number' && typeof naturalHeight === 'number'
    && Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight)
    && naturalWidth > 0 && naturalHeight > 0
    && naturalWidth > naturalHeight
}

/**
 * The comfortable landscape panel width: the width a landscape frame needs at
 * ~420px of displayed height, falling back to the 412×915 phone aspect while
 * no natural size is known, clamped into the live bounds and snapped to a
 * whole CSS px.
 */
export function androidPanelLandscapeTargetWidthOf(
  bounds: AndroidPanelWidthBounds,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): number {
  const aspect = typeof naturalWidth === 'number' && typeof naturalHeight === 'number'
    && Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight)
    && naturalWidth > 0 && naturalHeight > 0
    ? naturalWidth / naturalHeight
    : ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT / ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH
  const needed = ANDROID_PANEL_LANDSCAPE_HEIGHT_PX * aspect
  return androidPanelSnapPxOf(Math.min(bounds.max, Math.max(bounds.min, needed)))
}

/**
 * The panel width state machine behind the resize handle and the landscape
 * auto-widen. Pure (no DOM, no React) so the dev-panel-smoke script drives it
 * action by action:
 *
 * - `display` — the panel's frame report. Entering a landscape stint saves
 *   the current preferred width; leaving it restores that width; the stint
 *   boundary also clears the user-override flag.
 * - `manual-width` — a finished handle drag or a double-click reset. In a
 *   landscape stint it sets the user-override flag so the auto-widen never
 *   fights the user's explicit choice.
 */
export interface AndroidPanelWidthState {
  /** The user's preferred width (last drag / reset / restored width). */
  preferred: number
  /** Width saved when entering a landscape stint (restored on return). */
  portraitWidth: number | undefined
  /** Whether the last report was landscape (undefined = nothing reported). */
  landscape: boolean | undefined
  /** Natural frame dims (the landscape target's device aspect). */
  naturalWidth: number | undefined
  naturalHeight: number | undefined
  /** True once the user manually sized the panel during this landscape stint. */
  userOverrode: boolean
}

export type AndroidPanelWidthAction =
  | { kind: 'display'; naturalWidth?: number; naturalHeight?: number }
  | { kind: 'manual-width'; width: number }

export function androidPanelWidthStateInitial(preferred: number): AndroidPanelWidthState {
  return {
    preferred,
    portraitWidth: undefined,
    landscape: undefined,
    naturalWidth: undefined,
    naturalHeight: undefined,
    userOverrode: false,
  }
}

export function androidPanelWidthStateNext(
  state: AndroidPanelWidthState,
  action: AndroidPanelWidthAction,
): AndroidPanelWidthState {
  switch (action.kind) {
    case 'display': {
      const isLandscape = androidPanelDisplayIsLandscape(action.naturalWidth, action.naturalHeight)
      const next = {
        ...state,
        landscape: isLandscape,
        naturalWidth: action.naturalWidth,
        naturalHeight: action.naturalHeight,
      }
      if (state.landscape === isLandscape) return next
      if (isLandscape) {
        // Entering a landscape stint: remember the portrait width, and let
        // the auto-widen speak again.
        return { ...next, portraitWidth: state.preferred, userOverrode: false }
      }
      if (state.landscape === true) {
        // Back to portrait: restore the width the stint started from.
        return { ...next, preferred: state.portraitWidth ?? state.preferred, userOverrode: false }
      }
      // First report and it is portrait: nothing to restore.
      return next
    }
    case 'manual-width': {
      return {
        ...state,
        preferred: action.width,
        userOverrode: state.landscape === true ? true : state.userOverrode,
      }
    }
  }
}

/**
 * The live panel width: the user's preference, auto-widened to the
 * comfortable landscape target while the frame is landscape and the user has
 * not manually sized the panel during this stint, then clamped into the
 * current viewport bounds.
 */
export function androidPanelEffectiveWidth(
  state: AndroidPanelWidthState,
  viewportWidth: number,
): number {
  if (state.landscape !== true || state.userOverrode) {
    return clampAndroidPanelWidth(state.preferred, viewportWidth)
  }
  const target = androidPanelLandscapeTargetWidthOf(
    androidPanelWidthBounds(viewportWidth),
    state.naturalWidth,
    state.naturalHeight,
  )
  return clampAndroidPanelWidth(Math.max(state.preferred, target), viewportWidth)
}

/**
 * Surface chrome over the DSH theme tokens openpencil's editor panel uses
 * (`--dsw-alias-*`). Only the overlay scrim keeps a literal color (a dim over
 * the page in both themes).
 */
const surfaceStyles: Record<string, CSSProperties> = {
  surface: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 1200,
    display: 'flex',
    flexDirection: 'column',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-base)',
    borderLeft: '1px solid var(--dsw-alias-border-l2)',
    boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -6,
    width: 12,
    cursor: 'ew-resize',
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleBar: {
    width: 3,
    height: 32,
    borderRadius: 99,
    background: 'var(--dsw-alias-border-l2)',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    background: 'rgba(0,0,0,0.55)',
  },
  overlayCard: {
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 12,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-base)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
  },
}

interface AndroidPanelSurfaceProps {
  request: AndroidPanelRequest
  store: AndroidPanelStore
  colorScheme: 'light' | 'dark'
  locale: string
  sizeMode: AndroidPanelSizeMode
  onSizeModeChange: (mode: AndroidPanelSizeMode) => void
  frameStyle: AndroidFrameStyle
  onFrameStyleChange: (style: AndroidFrameStyle) => void
  onClose: () => void
}

/**
 * The fixed right-hand surface: docked when the layout lease is available,
 * a centered overlay otherwise. Resize drags the left edge; Escape closes.
 */
function AndroidPanelSurface({
  request,
  store,
  colorScheme,
  locale,
  sizeMode,
  onSizeModeChange,
  frameStyle,
  onFrameStyleChange,
  onClose,
}: AndroidPanelSurfaceProps): React.JSX.Element {
  const copy = androidCopy(locale === 'zh' ? 'zh' : 'en')
  const surfaceRef = useRef<HTMLElement>(null)
  const dockOwnerId = useId()
  const dockLeaseRef = useRef<AndroidPanelDockLease>()
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [dockUnavailable, setDockUnavailable] = useState(false)
  // Right-edge px a foreign sidebar occupies; the surface docks left of it.
  const [dockOffset, setDockOffset] = useState(0)
  const [widthState, dispatchWidth] = useReducer(
    androidPanelWidthStateNext,
    androidPanelWidthBounds(window.innerWidth).initial,
    androidPanelWidthStateInitial,
  )
  const fullscreen = viewportWidth < ANDROID_PANEL_FULLSCREEN_BREAKPOINT || dockUnavailable
  const bounds = androidPanelWidthBounds(viewportWidth)
  const width = androidPanelEffectiveWidth(widthState, viewportWidth)

  const handleDisplayChange = useCallback((display: AndroidPanelDisplayReport): void => {
    dispatchWidth({
      kind: 'display',
      ...(display.naturalWidth === undefined ? {} : { naturalWidth: display.naturalWidth }),
      ...(display.naturalHeight === undefined ? {} : { naturalHeight: display.naturalHeight }),
    })
  }, [])

  // The panel already adopted the switched device (synthetic meta + seeded
  // grant); make the open request AND the panel-source registry entry follow
  // it. The request identity (session/call/tool) is preserved, so the mounted
  // panel — its size/frame state and the in-flight seeded grant — survives.
  const handleDeviceSwitched = useCallback((result: AndroidSwitchResponse): void => {
    const next = androidSwitchedPanelRequestOf(request, result)
    store.replaceOpen(next)
    registerAndroidPanelSource({
      sessionId: next.sessionId,
      callId: next.callId,
      toolName: next.toolName,
      block: next.block,
    })
  }, [request, store])

  useEffect(() => {
    const onResize = (): void => { setViewportWidth(window.innerWidth) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useLayoutEffect(() => {
    if (fullscreen) return
    const root = document.getElementById('root')
    if (root === null) {
      setDockUnavailable(true)
      return
    }
    const computedMarginRight = Number.parseFloat(window.getComputedStyle(root).marginRight)
    const lease = claimAndroidPanelDock(root, dockOwnerId, width, computedMarginRight, window.innerWidth)
    if (lease === undefined) {
      setDockUnavailable(true)
      return
    }
    dockLeaseRef.current = lease
    setDockOffset(lease.offset)
    return () => {
      if (dockLeaseRef.current === lease) dockLeaseRef.current = undefined
      lease.release()
      setDockOffset(0)
    }
  }, [dockOwnerId, fullscreen, width])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const surface = surfaceRef.current
      const targetInside = event.target instanceof Node && surface?.contains(event.target) === true
      if (!targetInside && !fullscreen) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [fullscreen, onClose])

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (fullscreen) return
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    let liveWidth = width
    let appliedClientX = event.clientX
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    try { handle.setPointerCapture(pointerId) } catch { /* window listeners remain as a fallback */ }
    let stopped = false
    const applyWidth = (clientX: number): void => {
      liveWidth = resizedAndroidPanelWidth(liveWidth, appliedClientX, clientX, window.innerWidth)
      appliedClientX = clientX
      if (surfaceRef.current !== null) surfaceRef.current.style.width = `${liveWidth}px`
      dockLeaseRef.current?.update(liveWidth)
    }
    const cleanup = (): void => {
      if (stopped) return
      stopped = true
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onEnd, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onBlur)
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch { /* capture may already have been released by the browser */ }
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
    const finish = (): void => {
      if (stopped) return
      cleanup()
      // A finished drag is the user's explicit width — in a landscape stint
      // it sets the override flag so the auto-widen never fights it.
      dispatchWidth({ kind: 'manual-width', width: liveWidth })
    }
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      applyWidth(moveEvent.clientX)
    }
    const onEnd = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId === pointerId) finish()
    }
    const onCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === pointerId) finish()
    }
    const onBlur = (): void => { finish() }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onEnd, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onBlur)
  }, [fullscreen, width])

  const panel = (
    <AndroidPanel
      key={androidPanelRequestKey(request)}
      toolName={request.toolName}
      block={request.block}
      sessionId={request.sessionId}
      colorScheme={colorScheme}
      locale={locale === 'zh' ? 'zh' : 'en'}
      onClose={onClose}
      sizeMode={sizeMode}
      onSizeModeChange={onSizeModeChange}
      frameStyle={frameStyle}
      onFrameStyleChange={onFrameStyleChange}
      onDisplayChange={handleDisplayChange}
      onDeviceSwitched={handleDeviceSwitched}
    />
  )

  if (fullscreen) {
    return (
      <div
        style={surfaceStyles.backdrop}
        role="presentation"
        data-android-panel-surface="overlay"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        {/* The overlay fallback follows the same clamped width policy as the
            docked column (maxWidth keeps it on-screen in narrow viewports). */}
        <div style={{ ...surfaceStyles.overlayCard, width }} role="dialog" aria-modal="true" aria-label={copy.android}>
          {panel}
        </div>
      </div>
    )
  }

  return (
    <section
      ref={surfaceRef}
      style={{ ...surfaceStyles.surface, width, right: dockOffset }}
      data-android-panel-surface="docked"
      data-android-dock-offset={dockOffset > 0 ? String(dockOffset) : undefined}
      role="complementary"
      aria-label={copy.android}
    >
      <div
        style={surfaceStyles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={copy.resizePanel}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={Math.round(width)}
        onPointerDown={startResize}
        onDoubleClick={() => {
          // Double-click on the handle resets to the default width (the
          // openpencil nicety); in landscape it counts as a manual choice.
          dispatchWidth({ kind: 'manual-width', width: androidPanelWidthBounds(window.innerWidth).initial })
        }}
      >
        <span style={surfaceStyles.handleBar} aria-hidden="true" />
      </div>
      {panel}
    </section>
  )
}

interface AndroidPanelHostViewProps {
  store: AndroidPanelStore
  subscribeTheme: AndroidPanelHostOptions['subscribeTheme']
  getColorScheme: AndroidPanelHostOptions['getColorScheme']
  subscribeLocale: AndroidPanelHostOptions['subscribeLocale']
  getLocale: AndroidPanelHostOptions['getLocale']
  close: () => void
}

function AndroidPanelHostView({
  store,
  subscribeTheme,
  getColorScheme,
  subscribeLocale,
  getLocale,
  close,
}: AndroidPanelHostViewProps): React.JSX.Element | null {
  const request = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const sizeMode = useSyncExternalStore(store.subscribe, store.getSizeMode, store.getSizeMode)
  const frameStyle = useSyncExternalStore(store.subscribe, store.getFrameStyle, store.getFrameStyle)
  const colorScheme = useSyncExternalStore(subscribeTheme, getColorScheme, getColorScheme)
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)
  if (request === undefined) return null
  return (
    <AndroidPanelSurface
      request={request}
      store={store}
      colorScheme={colorScheme}
      locale={locale}
      sizeMode={sizeMode}
      onSizeModeChange={store.setSizeMode}
      frameStyle={frameStyle}
      onFrameStyleChange={store.setFrameStyle}
      onClose={close}
    />
  )
}

let nextHostId = 0

/**
 * Mount one imperative React root for the whole plugin panel (mirrors
 * openpencil's `mountEditorWorkbenchHost`). Safe to call only in a browser;
 * the options surface lets a headless embed pass its own document.
 */
export function mountAndroidPanelHost(options: AndroidPanelHostOptions): AndroidPanelHost {
  const ownerDocument = options.document ?? document
  const hostId = `dsh-android-panel-${++nextHostId}`
  const container = ownerDocument.createElement('div')
  container.dataset.androidPanelHost = hostId
  ownerDocument.body.append(container)
  // The plugin's one stylesheet contribution: the device-picker spinner
  // keyframes (inline style objects cannot carry @keyframes).
  const style = ownerDocument.createElement('style')
  style.dataset.dshAndroidPanelKeyframes = 'true'
  style.textContent = ANDROID_DEVICE_PICKER_KEYFRAMES
  ownerDocument.head.append(style)
  let root: Root | undefined = createRoot(container)
  let destroyed = false
  // Shared with the input-dock capsule: it reads the open state to hide
  // itself and calls `open` when the user clicks the status pill.
  const store = androidPanelStore()
  const close = (): void => { store.close() }

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    // Drop any open request so a later remount (plugin reload) starts closed.
    store.close()
    root?.unmount()
    root = undefined
    container.remove()
    style.remove()
  }

  root.render(
    <AndroidPanelHostView
      store={store}
      subscribeTheme={options.subscribeTheme}
      getColorScheme={options.getColorScheme}
      subscribeLocale={options.subscribeLocale}
      getLocale={options.getLocale}
      close={close}
    />,
  )

  return {
    open(request) {
      if (destroyed) return false
      return store.open(request)
    },
    openIfIdle(request) {
      if (destroyed || store.getSnapshot() !== undefined) return false
      return store.open(request)
    },
    close() {
      if (destroyed) return
      close()
    },
    dispose() {
      destroy()
    },
  }
}
