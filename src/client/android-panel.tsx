/**
 * The persistent device panel's pure chrome — device header with the picker,
 * a compact top toolbar (segmented size quick pill | divider | the icon pill
 * with ◁ Back · ○ Home · □ Recents · Screenshot · Rotate · Refresh), the
 * phone-frame stage, and the "● Live" indicator (stream mode only;
 * screenshot-mode panels hide the live/offline readout entirely).
 *
 * The chrome follows the DSH theme with the exact tokens dsh-openpencil's
 * editor panel uses (`--dsw-alias-*`): background, header border, toolbar,
 * captions and status text all track the active light/dark theme. Only the
 * phone bezel stays a literal dark device frame (the allowed exception, see
 * android-panel-frame.tsx).
 *
 * Everything here is pure presentation the dev-panel-smoke script
 * server-renders phase by phase without a browser or network; the connected
 * surface (grant/stream sessions, device switch, auto-follow) lives in
 * android-panel-connected.tsx.
 */

import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { androidCopy, type AndroidCopy, type AndroidLocale } from './copy.js'
import type { AndroidDeviceInfo, AndroidFetcher, AndroidScreenshotMeta } from './protocol.js'
import { useAndroidScreenshot } from './android-screenshot-session.js'
import type { AndroidCapturePhase } from './android-panel-capture.js'
import { AndroidSelect } from './android-select.js'
import {
  CARD_STYLES,
  PANEL_FALLBACK_STYLES,
  PANEL_LOADING_STYLES,
  PANEL_SCREENSHOT_IMAGE_STYLES,
} from './card-styles.js'
import {
  ANDROID_PANEL_QUICK_SIZE_OPTIONS,
  ANDROID_PANEL_SIZE_MODE_FIT,
  ANDROID_PANEL_SIZE_OPTIONS,
  androidPanelSizeModeIdOf,
  androidPanelSizeModeOf,
  type AndroidPanelSizeMode,
} from './android-panel-size.js'
import {
  ANDROID_FRAME_STYLE_BEZEL,
  ANDROID_FRAME_STYLE_OPTIONS,
  androidFrameStyleLabelOf,
  type AndroidFrameStyle,
} from './android-frame-style.js'
import { AndroidPhoneFrame } from './android-panel-frame.js'
import { AndroidDeviceMenu, type AndroidDeviceMenuAction } from './android-device-menu.js'
import {
  ANDROID_TOOLBAR_STYLES,
  AndroidSizeQuickSegment,
  AndroidToolbarIconButton,
} from './android-toolbar.js'

/**
 * Panel chrome styles over the DSH theme tokens (no literal colors — the
 * host's `--dsw-alias-*` variables resolve per theme; the phone bezel is the
 * one deliberate dark device surface). Exported so the static smoke can
 * assert the token usage directly.
 */
export const PANEL_STYLES: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-base)',
    fontFamily: 'inherit',
  },
  // Single-row header that only wraps under pressure: title, device picker
  // and the two controls share one flex line while the panel is wide enough;
  // `flexWrap` sends the controls to further lines as the panel narrows. The
  // close button is absolutely pinned top-right so wrapping never moves it.
  header: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 6,
    minWidth: 0,
    flex: 'none',
    padding: '10px 40px 10px 12px',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
  },
  titleCluster: {
    minWidth: 0,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  title: {
    fontSize: 14,
    lineHeight: '18px',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: '16px',
    color: 'var(--dsw-alias-label-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sizeControl: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    minWidth: 80,
  },
  sizeSelect: {
    maxWidth: 108,
    minHeight: 26,
    padding: '2px 6px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.4,
    minWidth: 70,
    width: '100%',
  },
  frameStyleControl: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l2)',
    minWidth: 90,
  },
  frameStyleButton: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
    padding: '2px 7px',
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
  frameStyleButtonActive: {
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    fontWeight: 600,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    flex: 'none',
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    cursor: 'pointer',
    font: 'inherit',
    lineHeight: 0,
    padding: 0,
  },
  stage: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--dsw-alias-bg-base)',
  },
  toolbar: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    padding: '4px 12px',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
  },
  toolbarDivider: {
    flex: 'none',
    alignSelf: 'stretch',
    width: 1,
    margin: '0 2px',
    background: 'var(--dsw-alias-border-l2)',
  },
  captureToast: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 24,
    padding: '2px 8px',
    borderRadius: 99,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
    lineHeight: 1.4,
  },
  unavailable: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    textAlign: 'center',
  },
}

/**
 * "● Live" / gray "Offline" readout under the frame. The text color follows
 * the theme token; only the dot keeps its literal green/gray state colors.
 */
export const PANEL_LIVE_INDICATOR_STYLES: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '4px 12px 12px',
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary)',
}

export function AndroidLiveIndicator({ open, locale }: { open: boolean; locale: AndroidLocale }): React.JSX.Element {
  const copy = androidCopy(locale)
  return (
    <div
      style={PANEL_LIVE_INDICATOR_STYLES}
      role="status"
      data-android-live-indicator={open ? 'live' : 'offline'}
    >
      <span
        aria-hidden="true"
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: open ? '#22c55e' : '#9ca3af',
          ...(open ? { boxShadow: '0 0 8px rgba(34,197,94,0.8)' } : {}),
        }}
      />
      <span>{open ? copy.panelLive : copy.offline}</span>
    </div>
  )
}

/**
 * Auto-follow header styles — the same compact token pill language as the
 * picker's switching/error readouts. Only the live-green dot keeps a literal
 * state color (the panel-wide live-dot convention).
 */
export const ANDROID_FOLLOW_INDICATOR_STYLES: Record<string, CSSProperties> = {
  root: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minHeight: 22,
    padding: '1px 8px',
    borderRadius: 99,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    font: 'inherit',
    fontSize: 12,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  /** The live-green dot only — auto-follow is on (same state color as Live). */
  dot: {
    flex: 'none',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow: '0 0 6px rgba(34,197,94,0.7)',
  },
  /** The overridden pill is the one-click resume button. */
  resume: {
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-primary)',
    fontWeight: 600,
  },
}

/**
 * The small auto-follow header indicator: while following is active a muted
 * 自动跟随/Auto-follow pill with the live-green dot; after a manual pick it
 * becomes the one-click 恢复跟随/Resume following button — visible AND
 * reversible. Pure presentation, SSR-safe.
 */
export function AndroidFollowIndicator({
  overridden,
  locale,
  onResume,
}: {
  overridden: boolean
  locale: AndroidLocale
  onResume?: () => void
}): React.JSX.Element {
  const copy = androidCopy(locale)
  if (!overridden) {
    return (
      <span
        style={ANDROID_FOLLOW_INDICATOR_STYLES.root}
        role="status"
        title={copy.followHint}
        data-android-follow-indicator="true"
        data-android-follow-state="active"
      >
        <span style={ANDROID_FOLLOW_INDICATOR_STYLES.dot} aria-hidden="true" data-android-follow-dot="true" />
        <span>{copy.followActive}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      style={{ ...ANDROID_FOLLOW_INDICATOR_STYLES.root, ...ANDROID_FOLLOW_INDICATOR_STYLES.resume }}
      title={copy.followHint}
      aria-label={copy.followResume}
      onClick={onResume}
      data-android-follow-indicator="true"
      data-android-follow-state="overridden"
      data-android-follow-resume="true"
    >
      <span>{copy.followResume}</span>
    </button>
  )
}

/** The panel's three modes — there is no device-class split on Android. */
export type AndroidPanelMode = 'stream' | 'screenshot' | 'unavailable'

/** aria-label for one quick-size button (full copy per size, both locales). */
function androidQuickSizeAriaLabel(id: string, copy: AndroidCopy): string {
  switch (id) {
    case 'fit': return copy.sizeQuickFit
    case 'percent-100': return copy.sizeQuickPercent100
    case 'preset-S': return copy.sizeQuickS
    case 'preset-M': return copy.sizeQuickM
  }
  return copy.sizeMode
}

export interface AndroidPanelBodyProps {
  title: string
  device: AndroidDeviceInfo | undefined
  /** Header device picker. When present it replaces the static device-name
   * subtitle; a meta-less 'unavailable' panel keeps the subtitle. */
  devicePicker?: ReactNode
  /** Small auto-follow pill rendered next to the picker/subtitle. */
  followIndicator?: ReactNode
  mode: AndroidPanelMode
  liveOpen: boolean
  colorScheme: 'light' | 'dark'
  locale: AndroidLocale
  onClose?: () => void
  children: ReactNode
  /** Active display size mode (defaults to fit). */
  sizeMode?: AndroidPanelSizeMode
  /** Natural pixel size of the current stream/screenshot frame. */
  naturalWidth?: number
  naturalHeight?: number
  /** Size-mode change (absent → the controls still render, inert). */
  onSizeModeChange?: (mode: AndroidPanelSizeMode) => void
  /** Active frame shell mode (defaults to the slim bezel). */
  frameStyle?: AndroidFrameStyle
  /** Frame-style change (absent → the control still renders, inert). */
  onFrameStyleChange?: (style: AndroidFrameStyle) => void
  /** Toolbar actions — each button renders only when its handler is present.
   * The nav triad (◁ ○ □) shares one handler keyed by the button name. */
  onNavButton?: (name: 'back' | 'home' | 'recents') => void
  /** Runs one device action (notifications, lock, …); absent hides the menu. */
  onDeviceAction?: (action: AndroidDeviceMenuAction) => Promise<void> | void
  onRotate?: () => void
  onScreenshot?: () => void
  onRefresh?: () => void
  /** Screenshot capture confirmation state (busy/done toast in the toolbar). */
  captureState?: AndroidCapturePhase
}

/** Pure panel chrome: header, toolbar, size-aware phone frame, Live dot. */
export function AndroidPanelBody({
  title,
  device,
  devicePicker,
  mode,
  liveOpen,
  colorScheme,
  locale,
  onClose,
  children,
  followIndicator,
  sizeMode = ANDROID_PANEL_SIZE_MODE_FIT,
  naturalWidth,
  naturalHeight,
  onSizeModeChange,
  frameStyle = ANDROID_FRAME_STYLE_BEZEL,
  onFrameStyleChange,
  onNavButton,
  onDeviceAction,
  onRotate,
  onScreenshot,
  onRefresh,
  captureState = 'idle',
}: AndroidPanelBodyProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const deviceParts = [device?.name, device?.serial].filter((part): part is string => part !== undefined && part !== '')
  const deviceLabel = deviceParts.join(' · ')
  const activeSizeModeId = androidPanelSizeModeIdOf(sizeMode)
  return (
    <section
      style={PANEL_STYLES.root}
      data-android-panel="true"
      data-android-mode={mode}
      data-android-color-scheme={colorScheme}
      role="complementary"
      aria-label={copy.android}
    >
      <div style={PANEL_STYLES.header} data-android-panel-header="true">
        <div style={PANEL_STYLES.titleCluster}>
          <span style={PANEL_STYLES.title}>{title}</span>
        </div>
        {devicePicker !== undefined
          ? devicePicker
          : deviceLabel !== ''
            ? <span style={PANEL_STYLES.subtitle}>{deviceLabel}</span>
            : null}
        {followIndicator}
        <div style={PANEL_STYLES.sizeControl}>
          <AndroidSelect
            value={activeSizeModeId}
            groups={[{
              id: 'size-modes',
              options: ANDROID_PANEL_SIZE_OPTIONS.map(option => ({
                value: option.id,
                label: locale === 'zh' ? option.labelZh : option.labelEn,
              })),
            }]}
            onChange={id => { onSizeModeChange?.(androidPanelSizeModeOf(id)) }}
            ariaLabel={copy.sizeMode}
            triggerStyle={PANEL_STYLES.sizeSelect}
            dataAttrs={{ 'data-android-panel-size-mode': 'true' }}
          />
        </div>
        <div
          style={PANEL_STYLES.frameStyleControl}
          role="group"
          aria-label={copy.frameStyle}
          title={copy.frameStyle}
          data-android-frame-style-control="true"
        >
          {ANDROID_FRAME_STYLE_OPTIONS.map(id => {
            const active = frameStyle === id
            const label = androidFrameStyleLabelOf(id, copy)
            return (
              <button
                key={id}
                type="button"
                style={active
                  ? { ...PANEL_STYLES.frameStyleButton, ...PANEL_STYLES.frameStyleButtonActive }
                  : PANEL_STYLES.frameStyleButton}
                aria-pressed={active}
                aria-label={`${copy.frameStyle}: ${label}`}
                title={`${copy.frameStyle}: ${label}`}
                data-android-frame-style={id}
                data-android-frame-style-active={active ? 'true' : 'false'}
                onClick={() => { onFrameStyleChange?.(id) }}
              >
                {label}
              </button>
            )
          })}
        </div>
        {onClose !== undefined ? (
          <button
            type="button"
            style={PANEL_STYLES.closeButton}
            onClick={onClose}
            aria-label={copy.closePanel}
            data-android-panel-close="true"
          >
            {/* An inline SVG rather than the × glyph: the character's optical
                center sits above the line box's center, so flex centering
                left it visibly high inside the button. */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
              data-android-panel-close-icon="true"
              style={{ display: 'block' }}
            >
              <path d="M4 4 L12 12 M12 4 L4 12" />
            </svg>
          </button>
        ) : null}
      </div>
      <div
        style={PANEL_STYLES.toolbar}
        data-android-panel-toolbar="true"
        role="toolbar"
        aria-label={copy.toolbar}
      >
        <div style={ANDROID_TOOLBAR_STYLES.sizeQuickGroup} role="group" aria-label={copy.sizeMode} data-android-size-quick-group="true">
          {ANDROID_PANEL_QUICK_SIZE_OPTIONS.map(option => (
            <AndroidSizeQuickSegment
              key={option.id}
              id={option.id}
              label={locale === 'zh' ? option.quickZh : option.quickEn}
              ariaLabel={androidQuickSizeAriaLabel(option.id, copy)}
              title={copy.sizeMode}
              active={activeSizeModeId === option.id}
              onClick={() => { onSizeModeChange?.(option.mode) }}
            />
          ))}
        </div>
        <span style={PANEL_STYLES.toolbarDivider} aria-hidden="true" data-android-toolbar-divider="true" />
        <div style={ANDROID_TOOLBAR_STYLES.actionPill} data-android-toolbar-actions="true">
          {/* The Android navigation triad: three PEER keys, no double-click. */}
          {onNavButton !== undefined ? (
            <>
              <AndroidToolbarIconButton action="back" label={copy.back} onClick={() => { onNavButton('back') }} />
              <AndroidToolbarIconButton action="home" label={copy.home} onClick={() => { onNavButton('home') }} />
              <AndroidToolbarIconButton action="recents" label={copy.recents} onClick={() => { onNavButton('recents') }} />
            </>
          ) : null}
          {onScreenshot !== undefined ? (
            <AndroidToolbarIconButton action="screenshot" label={copy.screenshot} onClick={onScreenshot} />
          ) : null}
          {captureState !== 'idle' ? (
            <span style={PANEL_STYLES.captureToast} role="status" data-android-capture-state={captureState}>
              {captureState === 'done' ? copy.captured : copy.capturing}
            </span>
          ) : null}
          {onRotate !== undefined ? (
            <AndroidToolbarIconButton action="rotate" label={copy.rotate} onClick={onRotate} />
          ) : null}
          {onRefresh !== undefined ? (
            <AndroidToolbarIconButton action="refresh" label={copy.refresh} onClick={onRefresh} />
          ) : null}
          {onDeviceAction !== undefined ? (
            <AndroidDeviceMenu copy={copy} onAction={onDeviceAction} />
          ) : null}
        </div>
      </div>
      <div style={PANEL_STYLES.stage} data-android-panel-stage="true">
        <AndroidPhoneFrame
          sizeMode={sizeMode}
          naturalWidth={naturalWidth}
          naturalHeight={naturalHeight}
          frameStyle={frameStyle}
        >
          {children}
        </AndroidPhoneFrame>
      </div>
      {/* The ● Live / Offline readout only makes sense for a live stream;
          screenshot/unavailable panels hide it entirely. */}
      {mode === 'stream' ? <AndroidLiveIndicator open={liveOpen} locale={locale} /> : null}
    </section>
  )
}

export interface AndroidScreenshotFrameBodyProps {
  meta: AndroidScreenshotMeta
  locale: AndroidLocale
  phase: 'granting' | 'live' | 'fallback'
  screenshotUrl: string | undefined
  failure: string
  refresh: () => void
  imgRef: RefObject<HTMLImageElement>
  /** Reports the loaded PNG's natural pixel width (percent-size basis). */
  onNaturalSize?: (width: number) => void
}

/** Pure screenshot-mode body (static PNG inside the phone screen). */
export function AndroidScreenshotFrameBody({
  meta,
  locale,
  phase,
  screenshotUrl,
  failure,
  refresh,
  imgRef,
  onNaturalSize,
}: AndroidScreenshotFrameBodyProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const serial = meta.device.serial
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}
      data-android-screenshot-frame="panel"
      data-android-frame-state={phase}
    >
      {phase === 'granting' ? (
        <div style={PANEL_LOADING_STYLES} role="status">
          <span style={CARD_STYLES.muted}>{copy.connectingScreenshot}</span>
          {serial !== undefined ? <span style={CARD_STYLES.muted}>{serial}</span> : null}
        </div>
      ) : null}
      {phase === 'live' && screenshotUrl !== undefined ? (
        <img
          ref={imgRef}
          src={screenshotUrl}
          alt={copy.screenshotAlt}
          draggable={false}
          style={PANEL_SCREENSHOT_IMAGE_STYLES}
          onLoad={event => { onNaturalSize?.(event.currentTarget.naturalWidth) }}
        />
      ) : null}
      {phase === 'fallback' ? (
        <div style={PANEL_FALLBACK_STYLES} role="alert">
          <strong style={CARD_STYLES.fallbackTitle}>{copy.screenshotUnavailable}</strong>
          {serial !== undefined ? <span style={CARD_STYLES.muted}>{serial}</span> : null}
          {failure !== '' ? <span style={CARD_STYLES.muted}>{failure}</span> : null}
          <button type="button" style={CARD_STYLES.primaryButton} onClick={refresh}>{copy.retry}</button>
        </div>
      ) : null}
    </div>
  )
}

export interface AndroidScreenshotFrameProps {
  meta: AndroidScreenshotMeta
  fetcher?: AndroidFetcher
  locale: AndroidLocale
  onNaturalSize?: (width: number) => void
}

/** Connected screenshot-mode frame: grant → static PNG in the phone screen. */
export function AndroidScreenshotFrame({ meta, fetcher, locale, onNaturalSize }: AndroidScreenshotFrameProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const session = useAndroidScreenshot({ meta, fetcher, unavailableCopy: copy.screenshotUnavailable })
  return (
    <AndroidScreenshotFrameBody
      meta={meta}
      locale={locale}
      phase={session.phase}
      screenshotUrl={session.screenshotUrl}
      failure={session.failure}
      refresh={session.refresh}
      imgRef={session.imgRef}
      {...(onNaturalSize === undefined ? {} : { onNaturalSize })}
    />
  )
}

/** Tool name the panel modes derive from (defensive over both block forms). */
export function androidToolNameOf(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.name ?? '') : block.name
}
