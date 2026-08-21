/**
 * The live-stream frame consumed by the persistent right-side device panel
 * (the conversation cards are compact summaries with no imagery — the panel
 * is the only surface that shows the device).
 *
 * `AndroidLiveFrame` binds `useAndroidStream` (the single stream/pointer
 * engine) to a presentation; `AndroidLiveFrameBody` is the same presentation
 * as a pure component over an explicit session state, so the dev-panel-smoke
 * script can server-render the live and fallback phases without a network or
 * a browser.
 *
 * There is NO counter-rotation here (dsh-ios needed one because the simulator
 * framebuffer stayed portrait-sized): an Android frame follows the display
 * rotation, so the pointer box simply adopts the frame's own aspect ratio and
 * pointer coordinates normalized against it go straight to `/control`.
 *
 * The img's `load` event is the ONLY liveness signal this transport has (no
 * control WebSocket exists), so it feeds BOTH the session's live flag and the
 * caller's natural-size report.
 */

import type { PointerEvent as ReactPointerEvent, RefObject, SyntheticEvent } from 'react'
import { useAndroidStream, type AndroidStreamPhase } from './android-stream-session.js'
import { androidCopy, type AndroidLocale } from './copy.js'
import type { AndroidFetcher, AndroidStreamMeta } from './protocol.js'
import { androidPanelFrameLayoutOf } from './android-panel-size.js'
import {
  CARD_STYLES,
  PANEL_FALLBACK_STYLES,
  PANEL_LOADING_STYLES,
  PANEL_STREAM_BOX_STYLES,
  PANEL_STREAM_IMG_STYLES,
  PANEL_STREAM_STAGE_STYLES,
} from './card-styles.js'

/** The session fields the pure body renders from (subset of the hook). */
export interface AndroidLiveFrameSessionState {
  phase: AndroidStreamPhase
  streamUrl: string | undefined
  failure: string
  imgRef: RefObject<HTMLImageElement>
  refresh: () => void
  retryOnce: () => void
  /** The frame drew — the session's only liveness signal. */
  onFrameLoad: (naturalWidth: number, naturalHeight: number) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
}

export interface AndroidLiveFrameBodyProps {
  meta: AndroidStreamMeta
  locale: AndroidLocale
  session: AndroidLiveFrameSessionState
  /** Natural pixel width of the loaded stream (size basis + frame aspect). */
  naturalWidth?: number
  /** Natural pixel height of the loaded stream (frame aspect). */
  naturalHeight?: number
  /** Reports the loaded stream's natural pixel size to the panel. */
  onNaturalSize?: (width: number, height: number) => void
}

/**
 * Pure presentation of the live frame over an explicit session snapshot.
 * Exported for the static smoke: `phase: 'live' | 'fallback'` render without
 * any network or browser surface.
 */
export function AndroidLiveFrameBody({
  meta,
  locale,
  session,
  naturalWidth,
  naturalHeight,
  onNaturalSize,
}: AndroidLiveFrameBodyProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const serial = meta.device.serial
  const {
    phase,
    streamUrl,
    failure,
    imgRef,
    refresh,
    retryOnce,
    onFrameLoad,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = session
  const reportFrame = (event: SyntheticEvent<HTMLImageElement>): void => {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget
    // Liveness FIRST: the panel's ● 实时 readout has no other source.
    onFrameLoad(width, height)
    onNaturalSize?.(width, height)
  }
  // The displayed box is the frame's own box (already display-rotated).
  const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)

  return (
    <div data-android-live-frame="panel" data-android-frame-state={phase}>
      {phase === 'granting' ? (
        <div style={PANEL_LOADING_STYLES} role="status">
          <span style={CARD_STYLES.muted}>{copy.connecting}</span>
          {serial !== undefined ? <span style={CARD_STYLES.muted}>{serial}</span> : null}
        </div>
      ) : null}
      {phase === 'live' && streamUrl !== undefined ? (
        <div style={PANEL_STREAM_STAGE_STYLES}>
          {/* The pointer box: sized to the frame's aspect so the img fills it
              edge-to-edge. Its bounds ARE the normalized 0..1 space the host
              multiplies by the current frame size — no mapping in between. */}
          <div
            style={{
              ...PANEL_STREAM_BOX_STYLES,
              aspectRatio: `${layout.displayW} / ${layout.displayH}`,
            }}
            data-android-live-pointer-box="true"
            data-android-display-width={layout.displayW}
            data-android-display-height={layout.displayH}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              ref={imgRef}
              src={streamUrl}
              alt={copy.streamAlt}
              draggable={false}
              style={PANEL_STREAM_IMG_STYLES}
              onLoad={reportFrame}
              onError={() => { retryOnce() }}
            />
          </div>
          {/* ◁ ○ □ / Screenshot / Rotate / Refresh live in the panel's TOP
              toolbar (see android-panel.tsx), so the stream stays full-bleed. */}
        </div>
      ) : null}
      {phase === 'fallback' ? (
        <div style={PANEL_FALLBACK_STYLES} role="alert">
          <strong style={CARD_STYLES.fallbackTitle}>{copy.streamUnavailable}</strong>
          {serial !== undefined ? <span style={CARD_STYLES.muted}>{serial}</span> : null}
          {failure !== '' ? <span style={CARD_STYLES.muted}>{failure}</span> : null}
          <button type="button" style={CARD_STYLES.primaryButton} onClick={refresh}>{copy.retry}</button>
        </div>
      ) : null}
    </div>
  )
}

export interface AndroidLiveFrameProps {
  meta: AndroidStreamMeta
  fetcher?: AndroidFetcher
  locale: AndroidLocale
  onLiveChange?: (live: boolean) => void
  onNaturalSize?: (width: number, height: number) => void
}

/**
 * Hook-connected live frame: grant → stream img with the panel's exact
 * fallback/retry behavior. The panel binds the session itself (its toolbar
 * needs the button/rotate/refresh handles), so this wrapper exists for
 * standalone embeds and for the smoke's shared-engine identity assertion.
 */
export function AndroidLiveFrame({
  meta,
  fetcher,
  locale,
  onLiveChange,
  onNaturalSize,
}: AndroidLiveFrameProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const session = useAndroidStream({
    meta,
    fetcher,
    unavailableCopy: copy.streamUnavailable,
    ...(onLiveChange === undefined ? {} : { onLiveChange }),
  })
  return (
    <AndroidLiveFrameBody
      meta={meta}
      locale={locale}
      session={session}
      {...(onNaturalSize === undefined ? {} : { onNaturalSize })}
    />
  )
}

// Symbol-identity anchor: the dev-panel-smoke script asserts that the frame
// and the panel share this one module (AndroidLiveFrame.sharedStreamHook ===
// useAndroidStream).
Object.assign(AndroidLiveFrame, { sharedStreamHook: useAndroidStream })
