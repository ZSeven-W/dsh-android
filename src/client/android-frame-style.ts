/**
 * Device frame (bezel) styles for the panel's phone frame.
 *
 * Three user-selectable modes, persisted in the panel store alongside
 * `sizeMode` (default `bezel`, host-lifetime persistence):
 *
 * - `none`   (无框 / Frameless): no shell at all — the stream/screenshot IS
 *   the screen: the screen box carries the proportional corner clip directly
 *   and NOTHING around it paints a background or border;
 * - `bezel`  (边框 / Bezel, DEFAULT): a slim 6px dark rim;
 * - `device` (手机框 / Phone frame): a realistic CSS-only device shell — a
 *   ~16px dark metallic gradient shell, concentric corners, a 1px lighter
 *   inner edge highlight, and proportionally placed side-button nubs.
 *
 * Bezel and device shells also carry a 1px border per side (frameless has
 * none). The screen inside renders as the frame's content box exactly
 * (`width: 100%` + `box-sizing: border-box`, so its hairline border paints
 * INSIDE the box), and every derivation of the screen's px size subtracts
 * BOTH the padding and the border via `androidPanelScreenWidthOf` — the
 * single source of truth shared by the measured-fit path, the percent/preset
 * box, and the radius basis, so the left/right rims stay even.
 *
 * Corner radii are PROPORTIONAL: radius = min(displayedW, displayedH) ×
 * 30/412 — a mainstream Android phone rounds its display corners at ≈30dp on
 * a 412dp-wide screen (a flatter corner than iOS's 55/390, which is exactly
 * why this constant is not shared). Every shell derives its OUTER radius from
 * the SAME screen radius (outer = screen + shell pad), so the corners stay
 * concentric at every displayed size in all three modes.
 *
 * Everything here is pure (no React, no DOM), so the dev-panel-smoke script
 * can exercise the store transitions, the id parsing, and the shell metrics.
 */

import type { AndroidCopy } from './copy.js'
import {
  androidDeviceScaleOf,
  androidPanelFrameLayoutOf,
  androidPanelFrameWidthOf,
  androidPanelSnapPxOf,
  type AndroidPanelSizeMode,
} from './android-panel-size.js'

/** The frame-style state persisted in the panel store. */
export type AndroidFrameStyle = 'none' | 'bezel' | 'device'

/** Shared default (stable identity — the store and panels all use it). */
export const ANDROID_FRAME_STYLE_BEZEL: AndroidFrameStyle = 'bezel'

/** The control's option roster (无框 / 边框 / 手机框 order). */
export const ANDROID_FRAME_STYLE_OPTIONS: readonly AndroidFrameStyle[] = ['none', 'bezel', 'device']

/** Defensive parse of a frame-style id; unknown ids fall back to bezel. */
export function androidFrameStyleOf(id: string): AndroidFrameStyle {
  return ANDROID_FRAME_STYLE_OPTIONS.find(candidate => candidate === id) ?? ANDROID_FRAME_STYLE_BEZEL
}

/** User-facing label for one frame style (copy lives in copy.ts). */
export function androidFrameStyleLabelOf(style: AndroidFrameStyle, copy: AndroidCopy): string {
  switch (style) {
    case 'none': return copy.frameStyleNone
    case 'bezel': return copy.frameStyleBezel
    case 'device': return copy.frameStyleDevice
  }
}

// ── shell metrics (the exact numbers the per-mode styles use) ───────────────

/** Slim bezel shell thickness on every side. */
export const ANDROID_FRAME_BEZEL_SHELL = 6
/** Device shell thickness on every side. */
export const ANDROID_FRAME_DEVICE_SHELL = 16
/**
 * Shell border thickness per side for the bordered modes (bezel + device);
 * frameless has none. The border is part of the rim, so the screen-width
 * derivation subtracts it together with the padding.
 */
export const ANDROID_FRAME_SHELL_BORDER_PX = 1

/**
 * The Android display-corner ratio: ≈30dp on a 412dp-wide screen (≈7.3% of
 * the displayed logical width — noticeably flatter than an iPhone's). The
 * panel's screen radius is proportional to the DISPLAYED screen box, so it
 * scales with the panel's drag-resize and every size mode.
 */
export const ANDROID_FRAME_SCREEN_RADIUS_RATIO = 30 / 412

/**
 * The radius the SSR/first render uses before the frame is measured: the
 * 412dp fallback display's rounded corner (412 × 30/412 = 30). Only the fit
 * mode needs it (its 100% width is unknown without the DOM);
 * percent/preset renders derive their radius exactly from props.
 */
export const ANDROID_FRAME_RADIUS_FALLBACK_PX = 30

/** Shell padding per mode: none → 0, bezel → 6, device → 16. */
export function androidPanelShellPadOf(style: AndroidFrameStyle): number {
  switch (style) {
    case 'none': return 0
    case 'device': return ANDROID_FRAME_DEVICE_SHELL
    default: return ANDROID_FRAME_BEZEL_SHELL
  }
}

/** Shell border thickness per mode: none → 0, bezel → 1, device → 1. */
export function androidPanelFrameBorderPxOf(style: AndroidFrameStyle): number {
  return style === 'none' ? 0 : ANDROID_FRAME_SHELL_BORDER_PX
}

/**
 * The shell's total per-side inset (padding + border) — the distance from the
 * frame's border-box edge to the screen box on every side: none → 0,
 * bezel → 7, device → 17.
 */
export function androidPanelFrameInsetOf(style: AndroidFrameStyle): number {
  return androidPanelShellPadOf(style) + androidPanelFrameBorderPxOf(style)
}

/**
 * The rendered screen width for a frame whose border-box width is known (CSS
 * px): frame width − 2×(padding + border) per mode, snapped to a whole px
 * BEFORE the subtraction (both operands stay on the device-pixel grid). THE
 * single source of truth for every screen-width derivation, so the visible
 * screen box and its corner radius can never drift apart.
 */
export function androidPanelScreenWidthOf(frameWidthCss: number, frameStyle: AndroidFrameStyle): number {
  return androidPanelSnapPxOf(frameWidthCss) - 2 * androidPanelFrameInsetOf(frameStyle)
}

function radiusSideOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The screen's corner radius for a known displayed screen box (CSS px,
 * rounded to 0.1): the device's physical corner follows the SHORT side —
 * radius = min(displayedW, displayedH) × 30/412. 412 → 30; 240 → 17.5.
 */
export function androidPanelScreenRadiusOf(displayedW: number, displayedH: number): number {
  const side = Math.min(radiusSideOf(displayedW), radiusSideOf(displayedH))
  return Math.round(side * ANDROID_FRAME_SCREEN_RADIUS_RATIO * 10) / 10
}

/**
 * Concentric shell outer radius: screen radius + shell pad (none → +0, so the
 * frameless "shell" radius IS the screen's clip radius).
 */
export function androidPanelShellRadiusOf(style: AndroidFrameStyle, screenRadius: number): number {
  return Math.round((radiusSideOf(screenRadius) + androidPanelShellPadOf(style)) * 10) / 10
}

/**
 * The displayed screen box for the deterministic size modes (percent and
 * preset give exact px widths): frame width − 2×(shell padding + border)
 * wide, with the frame's aspect. Returns undefined for fit, whose 100% width
 * only the DOM knows — AndroidPhoneFrame measures it via a ResizeObserver.
 */
export function androidPanelScreenBoxOf(
  mode: AndroidPanelSizeMode,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  frameStyle: AndroidFrameStyle,
): { width: number; height: number } | undefined {
  const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)
  const widthCss = androidPanelFrameWidthOf(mode, naturalWidth, naturalHeight)
  if (widthCss === '100%') return undefined
  const width = androidPanelScreenWidthOf(Number.parseFloat(widthCss), frameStyle)
  if (!Number.isFinite(width) || width <= 0) return undefined
  return { width, height: width * layout.displayH / layout.displayW }
}

/**
 * The measured-radius fallback: the device's natural display corner at
 * logical scale (displayW/scale × displayH/scale → min side × ratio).
 */
export function androidPanelFrameRadiusFallbackOf(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): number {
  const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)
  const scale = androidDeviceScaleOf(naturalWidth, naturalHeight)
  return androidPanelScreenRadiusOf(layout.displayW / scale, layout.displayH / scale)
}
