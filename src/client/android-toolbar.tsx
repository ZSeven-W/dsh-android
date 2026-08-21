/**
 * The panel toolbar's icon cluster + segmented quick sizes.
 *
 * The stream actions are ICON buttons grouped in ONE rounded pill container.
 * The first three are the ANDROID NAVIGATION TRIAD — ◁ Back · ○ Home ·
 * □ Recents — three PEERS in the same pill as rotate/screenshot/refresh:
 * unlike dsh-ios (one Home button whose double-click opened the app
 * switcher), Android has a real Recents key, so there is NO double-click
 * gesture anywhere in this toolbar.
 *
 * The icons are inline stroke SVGs in a 16×16 viewBox (stroke `currentColor`,
 * width 1.5, round caps/joins), so the DSH theme tokens color them through
 * the button's `color` — no icon fonts, no assets, no dependencies.
 *
 * Each icon button shows a small token-styled tooltip BELOW the button on
 * hover or keyboard focus (150ms show delay, instant hide). The codebase
 * styles via inline objects (no CSS pseudo-elements), so the hover/focus
 * state is explicit React state and the tooltip is an absolutely-positioned
 * label rendered off that state. The label is the same localized string as
 * the button's `aria-label` — the tooltip is visual sugar only.
 *
 * The size quick buttons (Fit/适应 · 100% · S · M) share the same visual
 * language as ONE borderless segmented pill group: a single outer border on
 * the container, borderless text segments with a subtle hover highlight, and
 * the ACTIVE segment marked by a stronger background FILL.
 *
 * Style tokens: the hover highlight uses `--dsw-alias-interactive-bg-hover`
 * and the active fill uses `--dsw-alias-interactive-bg-active` rather than
 * the raw layer ramp — in the LIGHT theme `bg-layer-1`/`bg-layer-2` resolve
 * to the same white, so the semantic interactive tokens are the only
 * layer-ish fills that read clearly in BOTH themes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AndroidCopy } from './copy.js'

/** The toolbar action ids (nav triad first, then the stream utilities). */
export type AndroidToolbarActionId =
  | 'back'
  | 'home'
  | 'recents'
  | 'screenshot'
  | 'rotate'
  | 'refresh'

/** The action roster in the pill's render order. */
export const ANDROID_TOOLBAR_ACTION_IDS: readonly AndroidToolbarActionId[] = [
  'back',
  'home',
  'recents',
  'screenshot',
  'rotate',
  'refresh',
]

/** The three actions that map to `/control` `{kind:'button'}` key events. */
export const ANDROID_TOOLBAR_NAV_ACTIONS: readonly AndroidToolbarActionId[] = ['back', 'home', 'recents']

/** Localized label for one action — the button aria-label AND the tooltip. */
export function androidToolbarActionLabelOf(action: AndroidToolbarActionId, copy: AndroidCopy): string {
  switch (action) {
    case 'back': return copy.back
    case 'home': return copy.home
    case 'recents': return copy.recents
    case 'screenshot': return copy.screenshot
    case 'rotate': return copy.rotate
    case 'refresh': return copy.refresh
  }
}

/**
 * The icon set: minimal stroke paths in a 16×16 viewBox, drawn with
 * `stroke="currentColor"` / `fill="none"` / strokeWidth 1.5 / round caps —
 * exported so the static smoke can assert the set directly.
 *
 * - back: the Android ◁ triangle;
 * - home: the Android ○ circle;
 * - recents: the Android □ square;
 * - screenshot: a camera — body outline + lens circle;
 * - rotate: rotate-cw — one 270° arc with the top-right arrowhead;
 * - refresh: refresh-cw — two mirrored 180° arcs with both arrowheads.
 */
export const ANDROID_TOOLBAR_ICON_PATHS: Record<AndroidToolbarActionId, readonly string[]> = {
  back: ['M10.5 3.25 L4.5 8 L10.5 12.75 Z'],
  home: ['M8 2.75a5.25 5.25 0 1 0 .01 0'],
  recents: ['M3.75 3.75 H12.25 V12.25 H3.75 Z'],
  screenshot: [
    'M2.75 5.25 H5.1 L6.4 3.5 H9.6 L10.9 5.25 H13.25 V12.25 H2.75 Z',
    'M8 6.25a2.5 2.5 0 1 0 .01 0',
  ],
  rotate: [
    'M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33',
    'M14 2v3.33h-3.33',
  ],
  refresh: [
    'M2 8a6 6 0 0 1 6-6c1.68 0 3.29.67 4.49 1.83L14 5.33',
    'M14 2v3.33h-3.33',
    'M14 8a6 6 0 0 1-6 6c-1.68 0-3.29-.67-4.49-1.83L2 10.67',
    'M5.33 10.67H2V14',
  ],
}

/** One inline stroke icon (16px, currentColor — the button's color token). */
export function AndroidToolbarIcon({ action }: { action: AndroidToolbarActionId }): React.JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
      data-android-toolbar-icon={action}
    >
      {ANDROID_TOOLBAR_ICON_PATHS[action].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/**
 * Toolbar pill + button + tooltip + size-segment styles over the DSH theme
 * tokens (no literal colors — the vars resolve per light/dark theme).
 * Exported so the static smoke can assert the token usage directly.
 */
export const ANDROID_TOOLBAR_STYLES: Record<string, CSSProperties> = {
  /** The rounded pill container the icon buttons sit in. */
  actionPill: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    borderRadius: 999,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
  },
  /** Borderless 28px icon square; `position: relative` anchors the tooltip. */
  iconButton: {
    position: 'relative',
    flex: 'none',
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
  },
  /** Hover/focus highlight: subtle layer fill + primary label color. */
  iconButtonHover: {
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-primary)',
  },
  /** The small tooltip bubble below the button (host Tooltip recipe). */
  tooltip: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 20,
    padding: '3px 7px',
    borderRadius: 8,
    background: 'var(--dsw-alias-tooltip-bg)',
    // Static near-white on purpose: the alias bg flips with the theme, the
    // text must stay readable on it in both schemes (host recipe).
    color: 'var(--dsw-static-neutral-bluish-00)',
    fontSize: 12,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  /** The segmented pill the size quick buttons sit in — the SAME pill
   * treatment as the icon cluster (one outer border, no per-button border). */
  sizeQuickGroup: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    borderRadius: 999,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
  },
  /** Borderless text segment (~28px tall with the pill's 2px padding). */
  sizeQuickSegment: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
    padding: '0 10px',
    border: 'none',
    borderRadius: 999,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
  /** Segment hover: the same subtle highlight the icon buttons use. */
  sizeQuickSegmentHover: {
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-primary)',
  },
  /** ACTIVE segment: stronger background FILL, no border. */
  sizeQuickSegmentActive: {
    background: 'var(--dsw-alias-interactive-bg-active)',
    color: 'var(--dsw-alias-label-primary)',
    fontWeight: 600,
  },
}

/** Tooltip show delay (nice-to-have ~150ms). */
export const ANDROID_TOOLBAR_TOOLTIP_DELAY_MS = 150

/** The pure tooltip bubble (exported for the static smoke). */
export function AndroidToolbarTooltip({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      style={ANDROID_TOOLBAR_STYLES.tooltip}
      role="tooltip"
      aria-hidden="true"
      data-android-toolbar-tooltip="true"
    >
      {label}
    </span>
  )
}

export interface AndroidToolbarIconButtonProps {
  /** Which icon to draw (also the `data-android-toolbar-action` id). */
  action: AndroidToolbarActionId
  /** Localized aria-label AND tooltip text. */
  label: string
  onClick?: () => void
  /**
   * Tooltip-open override for the static smoke: when provided it wins over
   * the internal hover/focus state (absent → the button's own state).
   */
  tooltipOpen?: boolean
}

/**
 * One toolbar action as an icon button: borderless 28px square inside the
 * pill, hover/focus highlight, and the tooltip below it. The tooltip opens
 * after the 150ms delay on mouseenter/focus and closes immediately on
 * mouseleave/blur; the button keeps its `aria-label` regardless. There is no
 * double-click affordance — every Android navigation key is its own button.
 */
export function AndroidToolbarIconButton({
  action,
  label,
  onClick,
  tooltipOpen,
}: AndroidToolbarIconButtonProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancelOpenTimer = useCallback((): void => {
    if (openTimerRef.current !== undefined) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = undefined
    }
  }, [])
  const scheduleOpen = useCallback((): void => {
    cancelOpenTimer()
    openTimerRef.current = setTimeout(() => { setInternalOpen(true) }, ANDROID_TOOLBAR_TOOLTIP_DELAY_MS)
  }, [cancelOpenTimer])
  const close = useCallback((): void => {
    cancelOpenTimer()
    setInternalOpen(false)
    setHovered(false)
  }, [cancelOpenTimer])
  useEffect(() => () => { cancelOpenTimer() }, [cancelOpenTimer])

  const open = tooltipOpen ?? internalOpen
  const buttonStyle = hovered
    ? { ...ANDROID_TOOLBAR_STYLES.iconButton, ...ANDROID_TOOLBAR_STYLES.iconButtonHover }
    : ANDROID_TOOLBAR_STYLES.iconButton
  return (
    <button
      type="button"
      style={buttonStyle}
      onClick={onClick}
      onMouseEnter={() => { setHovered(true); scheduleOpen() }}
      onMouseLeave={close}
      onFocus={() => { setHovered(true); scheduleOpen() }}
      onBlur={close}
      aria-label={label}
      data-android-toolbar-action={action}
    >
      <AndroidToolbarIcon action={action} />
      {open ? <AndroidToolbarTooltip label={label} /> : null}
    </button>
  )
}

export interface AndroidSizeQuickSegmentProps {
  /** Quick option id (fit / percent-100 / preset-S / preset-M). */
  id: string
  /** Rendered text label (localized by the caller). */
  label: string
  /** Full localized aria-label. */
  ariaLabel: string
  /** title attribute (localized size-mode caption). */
  title: string
  /** Active state mirrors the store's sizeMode (aria-pressed + fill). */
  active: boolean
  onClick?: () => void
}

/**
 * One size quick button as a borderless text segment of the segmented pill
 * group: hover = subtle highlight, ACTIVE = stronger background fill. The
 * active fill wins over the hover highlight so the pressed segment never
 * lightens under the cursor.
 */
export function AndroidSizeQuickSegment({
  id,
  label,
  ariaLabel,
  title,
  active,
  onClick,
}: AndroidSizeQuickSegmentProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  let style = ANDROID_TOOLBAR_STYLES.sizeQuickSegment
  if (hovered) style = { ...style, ...ANDROID_TOOLBAR_STYLES.sizeQuickSegmentHover }
  if (active) style = { ...style, ...ANDROID_TOOLBAR_STYLES.sizeQuickSegmentActive }
  return (
    <button
      type="button"
      style={style}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      data-android-size-quick={id}
      data-android-size-quick-active={active ? 'true' : 'false'}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {label}
    </button>
  )
}
