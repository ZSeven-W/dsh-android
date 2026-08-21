/**
 * The panel's phone frame: the shell around the device screen, in the three
 * user-selectable frame styles (frameless / bezel / phone frame).
 *
 * Sized by the active `sizeMode`: fit fills the stage width (so the panel's
 * drag-resize scales the device), percent/preset use the computed pixel width
 * from `androidPanelFrameWidthOf`. The width, aspect ratio, stream fill and
 * pointer mapping are IDENTICAL across all three styles — only the shell
 * around the screen changes.
 *
 * Corner radii follow the Android display proportion (30/412 of the displayed
 * screen's short side). Percent/preset widths are deterministic px values, so
 * their radius derives from props exactly on every render (SSR included);
 * fit mode's `100%` is only known to the DOM, so a mount-time measure plus a
 * ResizeObserver keeps two things live: (a) the measured screen radius, and
 * (b) the fit frame's SNAPPED integer width — a fractional border-box would
 * round differently at each device-pixel edge at 2× DPR and one bezel rim
 * would gain a physical pixel. Radius updates are style-only: the children
 * (stream/screenshot img) are never remounted, so the stream never
 * reconnects on resize.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ANDROID_PANEL_SIZE_MODE_FIT,
  androidPanelFrameLayoutOf,
  androidPanelFrameWidthOf,
  androidPanelSnapPxOf,
  type AndroidPanelSizeMode,
} from './android-panel-size.js'
import {
  ANDROID_FRAME_BEZEL_SHELL,
  ANDROID_FRAME_DEVICE_SHELL,
  ANDROID_FRAME_RADIUS_FALLBACK_PX,
  ANDROID_FRAME_SHELL_BORDER_PX,
  ANDROID_FRAME_STYLE_BEZEL,
  androidPanelFrameRadiusFallbackOf,
  androidPanelScreenBoxOf,
  androidPanelScreenRadiusOf,
  androidPanelScreenWidthOf,
  androidPanelShellRadiusOf,
  type AndroidFrameStyle,
} from './android-frame-style.js'

/**
 * The phone bezel — the one deliberately dark device surface (a bezel is a
 * device frame, not a panel surround), exported so the smoke can allow-list
 * it. The screen inside stays black: it is the device display. The outer
 * corner radius is applied per render (screen radius + the 6px rim) so the
 * inset screen stays concentric at every displayed size. The 1px border is
 * part of the rim: the screen-width derivation subtracts it together with the
 * padding, so left/right rims measure pad+border.
 */
export const PHONE_BEZEL_STYLES: CSSProperties = {
  width: '100%',
  maxWidth: 300,
  margin: '0 auto',
  boxSizing: 'border-box',
  padding: ANDROID_FRAME_BEZEL_SHELL,
  background: '#0b0b0e',
  border: `${ANDROID_FRAME_SHELL_BORDER_PX}px solid rgba(255,255,255,0.08)`,
  boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
}

/**
 * Frameless mode (无框): no shell at all. The wrapper is a bare sizing
 * element ONLY — no padding, no background, no border, no shadow, no clip:
 * the screen div below IS the content box and carries the proportional corner
 * clip directly, so no black layer can ever peek out around the stream.
 */
export const FRAMELESS_FRAME_STYLES: CSSProperties = {
  width: '100%',
  maxWidth: 300,
  margin: '0 auto',
  boxSizing: 'border-box',
  padding: 0,
}

/**
 * Phone frame mode (手机框): a realistic CSS-only device shell — a thicker
 * 16px shell with a subtle dark metallic gradient, a 1px lighter inner edge
 * highlight where the shell meets the screen, and the slim bezel's soft drop
 * shadow. The outer corner radius is applied per render (screen radius + the
 * 16px shell), and the side-button nubs anchor to this wrapper.
 */
export const DEVICE_FRAME_STYLES: CSSProperties = {
  width: '100%',
  maxWidth: 300,
  margin: '0 auto',
  boxSizing: 'border-box',
  position: 'relative',
  padding: ANDROID_FRAME_DEVICE_SHELL,
  background: 'linear-gradient(145deg, #2b2e35 0%, #101116 45%, #1c1e25 100%)',
  border: `${ANDROID_FRAME_SHELL_BORDER_PX}px solid rgba(0,0,0,0.6)`,
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12), 0 18px 50px rgba(0,0,0,0.55)',
}

/** One side-button nub shared by all buttons (the shell's lighter metallic
 * mid-tone, like a real frame's hardware accents). */
const DEVICE_SIDE_BUTTON_BASE: CSSProperties = {
  position: 'absolute',
  width: 3,
  borderRadius: 2,
  background: '#3a3d44',
  boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
}

/**
 * The phone frame's side-button nubs, positioned proportionally along the
 * frame's height. Android hardware overwhelmingly puts the volume rocker
 * ABOVE the power key on the RIGHT edge, so that is what is drawn. Buttons
 * render only in portrait: in landscape the wide frame's edges correspond to
 * the device's top/bottom and rotating the nubs would need a second
 * coordinate system for a purely decorative detail.
 */
export const DEVICE_SIDE_BUTTONS: readonly { id: string; side: 'left' | 'right'; style: CSSProperties }[] = [
  { id: 'volume-up', side: 'right', style: { ...DEVICE_SIDE_BUTTON_BASE, right: -2, top: '22%', height: 30 } },
  { id: 'volume-down', side: 'right', style: { ...DEVICE_SIDE_BUTTON_BASE, right: -2, top: '32%', height: 30 } },
  { id: 'power', side: 'right', style: { ...DEVICE_SIDE_BUTTON_BASE, right: -2, top: '45%', height: 46 } },
]

/**
 * The frame with one size mode applied: the width comes from the pure
 * `androidPanelFrameWidthOf` helper and the base max-width clamp is removed
 * so fit/percent/preset widths are exact (overflow scrolls the panel stage).
 * `frameStyle` picks the shell; `screenRadius` drives its outer radius.
 *
 * Fit mode resolves `100%` against the stage's content box, which can be
 * FRACTIONAL after a panel drag-resize. `measuredFitWidth` (snapped to a
 * whole CSS px by AndroidPhoneFrame's ResizeObserver) replaces the `100%`
 * once measured, so the frame's border-box lands on the device-pixel grid and
 * its rims rasterize symmetrically; the ≤0.5px remainder splits evenly under
 * `margin: 0 auto`.
 */
export function androidPanelFrameStyles(
  mode: AndroidPanelSizeMode,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  frameStyle: AndroidFrameStyle = ANDROID_FRAME_STYLE_BEZEL,
  screenRadius: number = ANDROID_FRAME_RADIUS_FALLBACK_PX,
  measuredFitWidth?: number,
): CSSProperties {
  const shell = frameStyle === 'none'
    ? FRAMELESS_FRAME_STYLES
    : frameStyle === 'device'
      ? { ...DEVICE_FRAME_STYLES, borderRadius: androidPanelShellRadiusOf(frameStyle, screenRadius) }
      : { ...PHONE_BEZEL_STYLES, borderRadius: androidPanelShellRadiusOf(frameStyle, screenRadius) }
  return {
    ...shell,
    width: mode.kind === 'fit' && measuredFitWidth !== undefined && measuredFitWidth > 0
      ? `${measuredFitWidth}px`
      : androidPanelFrameWidthOf(mode, naturalWidth, naturalHeight),
    maxWidth: 'none',
  }
}

const PHONE_SCREEN_STYLES: CSSProperties = {
  position: 'relative',
  // BORDER-BOX sizing: the screen's width:100% resolves against the frame's
  // CONTENT box, and the 1px hairline border below must paint INSIDE it —
  // with the default content-box sizing the border box would grow 2px past
  // the content box and overflow into the right padding/border, making the
  // right rim thinner than the left. The rendered screen box is therefore
  // exactly frame − 2×(pad+border), the value `androidPanelScreenWidthOf`
  // derives for the radius basis.
  boxSizing: 'border-box',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: '#000',
  border: '1px solid rgba(255,255,255,0.06)',
}

/**
 * The inset screen for one frame style. Bezel and phone-frame keep the
 * classic screen (black device display, hairline edge highlight, proportional
 * radius concentric with the shell's outer radius). Frameless has NO black
 * layers at all: the background goes transparent and the border drops, so the
 * screen IS the bare content box and its radius IS the only rounding.
 */
export function androidPhoneScreenStyles(frameStyle: AndroidFrameStyle, screenRadius: number): CSSProperties {
  return frameStyle === 'none'
    ? { ...PHONE_SCREEN_STYLES, background: 'transparent', border: 'none', borderRadius: screenRadius }
    : { ...PHONE_SCREEN_STYLES, borderRadius: screenRadius }
}

export interface AndroidPhoneFrameProps {
  children: ReactNode
  sizeMode?: AndroidPanelSizeMode
  /** Natural pixel width of the current frame (size basis + screen aspect). */
  naturalWidth?: number
  /** Natural pixel height of the current frame (screen aspect). */
  naturalHeight?: number
  /** Frame shell mode (defaults to the slim bezel). */
  frameStyle?: AndroidFrameStyle
}

/** Minimal CSS phone frame: shell + inset screen, sized by the active mode. */
export function AndroidPhoneFrame({
  children,
  sizeMode = ANDROID_PANEL_SIZE_MODE_FIT,
  naturalWidth,
  naturalHeight,
  frameStyle = ANDROID_FRAME_STYLE_BEZEL,
}: AndroidPhoneFrameProps): React.JSX.Element {
  const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)
  const width = androidPanelFrameWidthOf(sizeMode, naturalWidth, naturalHeight)
  // A landscape frame is a wide shell; the side-button nubs are positioned
  // for portrait proportions and are omitted there.
  const landscape = layout.displayW > layout.displayH
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [fitWidth, setFitWidth] = useState<number>()
  // The measured screen radius (fit mode only). Initialized to the device's
  // natural display corner; the mount measure + ResizeObserver below keep it
  // live without ever touching the stream img.
  const [measuredRadius, setMeasuredRadius] = useState<number>(() =>
    androidPanelFrameRadiusFallbackOf(naturalWidth, naturalHeight))
  useEffect(() => {
    const node = frameRef.current
    if (node === null) return
    // The frame sits directly inside the panel stage; its fit width is the
    // stage's content box width (what `width: 100%` resolves against).
    const stage = node.parentElement
    const measure = (): void => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredRadius(androidPanelScreenRadiusOf(
          androidPanelScreenWidthOf(rect.width, frameStyle),
          androidPanelScreenWidthOf(rect.height, frameStyle),
        ))
      }
      if (stage !== null) {
        const stageComputed = getComputedStyle(stage)
        const stagePadX = Number.parseFloat(stageComputed.paddingLeft) + Number.parseFloat(stageComputed.paddingRight)
        const stageBorderX = Number.parseFloat(stageComputed.borderLeftWidth) + Number.parseFloat(stageComputed.borderRightWidth)
        const stageContentW = stage.clientWidth - stagePadX - stageBorderX
        if (stageContentW > 0) setFitWidth(androidPanelSnapPxOf(stageContentW))
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    // Observe BOTH: the stage drives the fit width on panel drag-resize
    // (after the snapped px width replaces `100%`, the frame no longer tracks
    // the stage on its own), and the frame re-measures the screen box for the
    // radius once the snapped width lands.
    observer.observe(node)
    if (stage !== null) observer.observe(stage)
    return () => { observer.disconnect() }
  }, [frameStyle])
  // Percent/preset modes have an exact px width: derive the radius from props
  // (deterministic SSR + instant on size-mode changes). Fit falls back to the
  // measured value.
  const screenBox = androidPanelScreenBoxOf(sizeMode, naturalWidth, naturalHeight, frameStyle)
  const screenRadius = screenBox !== undefined
    ? androidPanelScreenRadiusOf(screenBox.width, screenBox.height)
    : measuredRadius
  const shellRadius = androidPanelShellRadiusOf(frameStyle, screenRadius)
  return (
    <div
      ref={frameRef}
      style={androidPanelFrameStyles(sizeMode, naturalWidth, naturalHeight, frameStyle, screenRadius, fitWidth)}
      data-android-phone-frame="true"
      data-android-phone-frame-style={frameStyle}
      data-android-phone-width={width}
      data-android-shell-radius={shellRadius}
    >
      {frameStyle === 'device' && !landscape ? DEVICE_SIDE_BUTTONS.map(button => (
        <span
          key={button.id}
          style={button.style}
          aria-hidden="true"
          data-android-device-button={button.id}
          data-android-device-side={button.side}
        />
      )) : null}
      <div
        style={{
          ...androidPhoneScreenStyles(frameStyle, screenRadius),
          aspectRatio: `${layout.displayW} / ${layout.displayH}`,
        }}
        data-android-phone-screen="true"
        data-android-phone-aspect={`${layout.displayW} / ${layout.displayH}`}
        data-android-screen-radius={screenRadius}
      >
        {children}
      </div>
    </div>
  )
}
