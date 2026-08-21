/**
 * Inline styles for the dsh-android cards. Same mechanism as dsh-ios /
 * dsh-openpencil: plain inline style objects over the host's `--ui-*` CSS
 * variables, so the cards track the active theme without a CSS framework.
 *
 * Unlike dsh-ios there is NO rotation group here: an Android `screencap`
 * frame already follows the display rotation (a landscape app streams a
 * 2400×1080 frame), so the panel never counter-rotates the image — it only
 * adopts the frame's own aspect ratio from `naturalWidth/naturalHeight`.
 */

import type { CSSProperties } from 'react'

const BORDER = 'var(--ui-border, rgba(128,128,128,0.35))'
const MUTED = 'var(--ui-text-muted, #888)'
const ACCENT = 'var(--ui-accent, #0ea5e9)'

export const CARD_STYLES: Record<string, CSSProperties> = {
  card: {
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    overflow: 'hidden',
    background: 'var(--ui-card-bg, transparent)',
    fontFamily: 'inherit',
    color: 'var(--ui-text, inherit)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderBottom: '1px solid var(--ui-border, rgba(128,128,128,0.2))',
  },
  title: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /** Small secondary action sub-label right after the title (启动/截图/交互/
   * 构建运行 · Boot/Screenshot/Interact/Build & Run) — distinguishes which
   * action a card belongs to under the unified "Android 设备" title. */
  action: {
    flex: 'none',
    fontSize: 11,
    fontWeight: 400,
    color: MUTED,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headDevice: {
    fontSize: 12,
    fontWeight: 400,
    color: MUTED,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /** Non-interactive "opens the sidebar" cue — the row click itself opens
   * the panel, so this must NOT swallow the click (no button/link roles). */
  openInPanel: {
    marginLeft: 'auto',
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: ACCENT,
    whiteSpace: 'nowrap',
  },
  badge: {
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 99,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  badgeOk: { background: 'rgba(34,197,94,0.15)', color: '#16a34a' },
  badgeError: { background: 'rgba(239,68,68,0.15)', color: '#dc2626' },
  badgeRunning: { background: 'rgba(100,116,139,0.15)', color: '#64748b' },
  body: { padding: '4px 10px 8px' },
  meta: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
    fontSize: 12,
    color: MUTED,
  },
  muted: { fontSize: 12, color: MUTED },
  pre: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontSize: 12,
    margin: 0,
    maxHeight: '24em',
    overflow: 'auto',
  },
  button: {
    color: ACCENT,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    font: 'inherit',
    fontSize: 12,
  },
  primaryButton: {
    border: `1px solid ${ACCENT}`,
    borderRadius: 6,
    color: ACCENT,
    background: 'transparent',
    padding: '4px 9px',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
  },
  loading: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' },
  fallback: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
    padding: '12px',
    borderRadius: 6,
    border: '1px solid var(--ui-border, rgba(128,128,128,0.25))',
    background: 'rgba(128,128,128,0.06)',
    fontSize: 12,
  },
  fallbackTitle: { fontSize: 13, fontWeight: 600 },
  keyValue: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 },
  key: { color: MUTED },
  value: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}

/** The stream/screenshot frame: dark console-like backdrop in both schemes. */
export function mediaFrameStyles(_colorScheme: 'light' | 'dark'): CSSProperties {
  return {
    maxHeight: 420,
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid var(--ui-border, rgba(128,128,128,0.25))',
    background: 'var(--ui-media-bg, #16161a)',
    display: 'flex',
    flexDirection: 'column',
  }
}

/**
 * Panel-variant styles for the shared live frame: the stream fills the phone
 * screen provided by the panel (no card chrome), so the frame is a full-bleed
 * column. The panel's actions live in the panel chrome's own top toolbar
 * (see android-panel.tsx), not inside the frame.
 *
 * The stage carries NO background of its own: the phone screen div provides
 * the backdrop (black in bezel/device, transparent in frameless — see
 * androidPhoneScreenStyles in android-panel-frame.tsx), so frameless mode
 * never leaks a dark layer between the frame wrapper and the stream img.
 */
export const PANEL_STREAM_STAGE_STYLES: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
}

/**
 * The pointer box inside the panel's phone screen: sized to the frame's own
 * aspect ratio (the frame is already display-rotated, so the aspect IS the
 * natural one). Pointer events land here and its bounds ARE the normalized
 * 0..1 coordinate space `/control` expects — no inverse mapping anywhere.
 */
export const PANEL_STREAM_BOX_STYLES: CSSProperties = {
  position: 'relative',
  width: '100%',
  flex: 'none',
  touchAction: 'none',
  cursor: 'crosshair',
}

/**
 * The stream img inside the pointer box: absolutely positioned and `fill`
 * (NOT `contain`). The box's `aspectRatio` IS the frame's aspect, so `fill`
 * and `contain` draw the same picture — except that `contain` resolves any
 * sub-pixel box/device-pixel mismatch by leaving the slack on ONE side, which
 * at 2× DPR paints the adjacent bezel rim a physical pixel thicker there.
 * `fill` stretches edge-to-edge so residual slack distributes symmetrically.
 *
 * No background of its own: the screen's backdrop (black under a shell,
 * transparent in frameless) shows through wherever a letterbox could appear.
 */
export const PANEL_STREAM_IMG_STYLES: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'fill',
  userSelect: 'none',
  touchAction: 'none',
}

/**
 * The panel's screenshot img: fills the phone screen. `contain` STAYS here
 * (unlike the stream img above): screenshot mode never reports a natural
 * HEIGHT, so the phone screen's aspect derives from the 412:915 fallback
 * shape and matches the PNG only for 412:915-ratio devices. `fill` would
 * stretch any other device's screenshot; `contain` preserves it, and the
 * snapped integer frame width keeps the horizontal slack symmetric anyway.
 */
export const PANEL_SCREENSHOT_IMAGE_STYLES: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'contain',
}

/** Centered loading / fallback bodies inside the phone screen. */
export const PANEL_LOADING_STYLES: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 16,
  textAlign: 'center',
}

export const PANEL_FALLBACK_STYLES: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 16,
  textAlign: 'center',
  fontSize: 12,
}
