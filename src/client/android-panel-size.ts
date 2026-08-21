/**
 * Device display size modes for the panel stage.
 *
 * The stream/screenshot display inside the panel's phone frame is sized by
 * one of three modes, chosen with a compact dropdown in the panel header:
 *
 * - `fit`    (DEFAULT): the frame fills the panel's content width, so
 *   dragging the panel's resize handle scales the device with it;
 * - `percent`: 50% / 75% / 100% / 125% of the device's LOGICAL (dp) width;
 * - `preset`: quick fixed sizes — S (240px), M (320px), L (420px). The preset
 *   value is the device's SHORT-side display size, so a landscape frame
 *   scales it by the frame's width/height ratio and the device keeps its
 *   physical size across a rotation.
 *
 * NO ROTATION MATH LIVES HERE. An Android `screencap` frame already follows
 * the display rotation (a landscape app streams 2400×1080), so the "displayed"
 * box IS the natural frame box — `androidPanelFrameLayoutOf` is a plain
 * fallback-aware read of `naturalWidth/naturalHeight`, and the dsh-ios
 * `sim-orientation.ts` counter-rotation machinery has no counterpart.
 *
 * The device scale (px per dp) is DERIVED from the frame instead of being a
 * constant: Android densities vary wildly (2.0 … 3.5+) where iOS simulators
 * are always ~3×. It is taken off the frame's SHORT side (`min(w, h) / 412`)
 * because that side is the device's portrait width in either orientation —
 * using the raw width would report a 5.8× scale for a landscape frame.
 *
 * Everything here is pure (no DOM, no React state), so the dev-panel-smoke
 * script exercises the mode transitions and the width computation directly.
 */

/** Reference logical width (dp) of a mainstream phone — the scale basis. */
export const ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH = 412
/** Reference logical height (dp) for the frame's base 412×915 shape. */
export const ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT = 915
/** Density used until a frame reports its natural size (412dp → 1080px). */
export const ANDROID_PANEL_DEVICE_SCALE_FALLBACK = 2.625

/** The size-mode state persisted in the panel store. */
export type AndroidPanelSizeMode =
  | { kind: 'fit' }
  | { kind: 'percent'; value: number }
  | { kind: 'preset'; width: number }

/** Shared default (stable identity — the store and panels all use it). */
export const ANDROID_PANEL_SIZE_MODE_FIT: AndroidPanelSizeMode = { kind: 'fit' }

/** The zoom percentages offered by the percent mode. */
export const ANDROID_PANEL_PERCENT_OPTIONS = [50, 75, 100, 125] as const

export interface AndroidPanelPresetOption {
  id: 'S' | 'M' | 'L'
  width: number
  labelEn: string
  labelZh: string
}

/**
 * The quick fixed widths of the preset mode. Each preset is the device's
 * SHORT-side display size — the labels keep the raw px because the number
 * refers to that short side, not the frame width in every orientation.
 */
export const ANDROID_PANEL_PRESET_OPTIONS: readonly AndroidPanelPresetOption[] = [
  { id: 'S', width: 240, labelEn: 'S · 240px', labelZh: 'S（240px）' },
  { id: 'M', width: 320, labelEn: 'M · 320px', labelZh: 'M（320px）' },
  { id: 'L', width: 420, labelEn: 'L · 420px', labelZh: 'L（420px）' },
]

export interface AndroidPanelSizeOption {
  id: string
  mode: AndroidPanelSizeMode
  labelEn: string
  labelZh: string
}

/** The dropdown's option roster (fit first, then percent, then presets). */
export const ANDROID_PANEL_SIZE_OPTIONS: readonly AndroidPanelSizeOption[] = [
  { id: 'fit', mode: ANDROID_PANEL_SIZE_MODE_FIT, labelEn: 'Fit to width', labelZh: '适应宽度' },
  ...ANDROID_PANEL_PERCENT_OPTIONS.map(value => ({
    id: `percent-${value}`,
    mode: { kind: 'percent', value } as AndroidPanelSizeMode,
    labelEn: `${value}%`,
    labelZh: `${value}%`,
  })),
  ...ANDROID_PANEL_PRESET_OPTIONS.map(preset => ({
    id: `preset-${preset.id}`,
    mode: { kind: 'preset', width: preset.width } as AndroidPanelSizeMode,
    labelEn: preset.labelEn,
    labelZh: preset.labelZh,
  })),
]

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** The displayed frame box: the natural frame dims, or the 412×915 fallback
 * shape at the fallback density. The frame is already display-rotated, so
 * there is nothing to swap. */
export interface AndroidFrameLayout {
  displayW: number
  displayH: number
}

export function androidPanelFrameLayoutOf(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): AndroidFrameLayout {
  const fallbackW = ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH * ANDROID_PANEL_DEVICE_SCALE_FALLBACK
  const displayW = positiveOr(naturalWidth, fallbackW)
  // Unknown height: keep the 412:915 phone aspect off the (possibly fallback)
  // width, so this single expression covers both unknown cases.
  const displayH = positiveOr(
    naturalHeight,
    Math.round(displayW * ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT / ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH),
  )
  return { displayW, displayH }
}

/**
 * The device's pixel density derived from the frame's SHORT side (px per dp).
 * Falls back to 2.625 while no natural size is known. Clamped to a sane
 * 1…6 range so a garbage frame can never collapse the percent basis.
 */
export function androidDeviceScaleOf(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): number {
  if (naturalWidth === undefined && naturalHeight === undefined) return ANDROID_PANEL_DEVICE_SCALE_FALLBACK
  const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)
  const shortSide = Math.min(layout.displayW, layout.displayH)
  const scale = shortSide / ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH
  if (!Number.isFinite(scale) || scale <= 0) return ANDROID_PANEL_DEVICE_SCALE_FALLBACK
  return Math.min(6, Math.max(1, scale))
}

/**
 * The device's logical (dp) width of the DISPLAYED frame — the percent-mode
 * basis: displayW / density. A landscape frame therefore uses its landscape
 * dp width (≈915dp for a 412×915 phone) as its 100%.
 */
export function androidPanelDisplayLogicalWidthOf(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): number {
  const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)
  return layout.displayW / androidDeviceScaleOf(naturalWidth, naturalHeight)
}

/**
 * Snaps a measured/computed CSS px value to a whole pixel (Math.round).
 *
 * The frame and screen boxes split their border/padding evenly between the
 * left and right rims, so a FRACTIONAL width rounds differently at each
 * device-pixel edge at 2× DPR — one side of the bezel ends up a physical
 * pixel thicker. Round the width BEFORE deriving radius/box values (and
 * before applying the fit-mode frame width itself) so both rims rasterize
 * symmetrically; the ≤0.5px remainder then splits evenly under
 * `margin: 0 auto`. Non-positive/garbage input snaps to 0.
 */
export function androidPanelSnapPxOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * The phone-frame CSS width one size mode applies: `100%` for fit (the
 * panel's drag-resize therefore scales the device), `dpWidth × value%` for
 * percent, and the aspect-aware preset width. Presets are SHORT-side sizes:
 * a landscape frame (aspect > 1) scales the preset by the width/height ratio
 * so the device keeps its physical size across a rotation.
 */
export function androidPanelFrameWidthOf(
  mode: AndroidPanelSizeMode,
  naturalWidth?: number,
  naturalHeight?: number,
): string {
  switch (mode.kind) {
    case 'fit': return '100%'
    case 'percent': {
      const base = androidPanelDisplayLogicalWidthOf(naturalWidth, naturalHeight)
      return `${Math.round(base * mode.value / 100)}px`
    }
    case 'preset': {
      const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight)
      const aspect = layout.displayW / layout.displayH
      return aspect > 1
        ? `${androidPanelSnapPxOf(mode.width * aspect)}px`
        : `${mode.width}px`
    }
  }
}

/** Stable option id for one size mode (the dropdown's `value`). */
export function androidPanelSizeModeIdOf(mode: AndroidPanelSizeMode): string {
  switch (mode.kind) {
    case 'fit': return 'fit'
    case 'percent': return `percent-${mode.value}`
    case 'preset': {
      const preset = ANDROID_PANEL_PRESET_OPTIONS.find(option => option.width === mode.width)
      return preset !== undefined ? `preset-${preset.id}` : `preset-${mode.width}`
    }
  }
}

/** Defensive parse of a dropdown id; unknown ids fall back to fit. */
export function androidPanelSizeModeOf(id: string): AndroidPanelSizeMode {
  const option = ANDROID_PANEL_SIZE_OPTIONS.find(candidate => candidate.id === id)
  return option?.mode ?? ANDROID_PANEL_SIZE_MODE_FIT
}

export interface AndroidPanelQuickSizeOption {
  /** Dropdown option id this quick button maps to (shared truth). */
  id: string
  /** The exact size mode dispatched to the store — the same object the
   * dropdown's option carries, so both controls stay in sync by id. */
  mode: AndroidPanelSizeMode
  quickEn: string
  quickZh: string
}

function androidPanelQuickLabel(id: string): { en: string; zh: string } {
  switch (id) {
    case 'fit': return { en: 'Fit', zh: '适应' }
    case 'percent-100': return { en: '100%', zh: '100%' }
    case 'preset-S': return { en: 'S', zh: 'S' }
    case 'preset-M': return { en: 'M', zh: 'M' }
  }
  throw new RangeError(`dsh-android: unknown quick size option ${id}`)
}

/**
 * The toolbar's one-tap quick sizes: the most-used modes promoted out of the
 * dropdown as segmented buttons — [Fit/适应] [100%] [S] [M]. Each entry is
 * derived from the DROPDOWN roster, so pressing a quick button dispatches the
 * exact mode the dropdown selects and both stay in sync against the store's
 * single `sizeMode` truth.
 */
export const ANDROID_PANEL_QUICK_SIZE_OPTIONS: readonly AndroidPanelQuickSizeOption[] = (
  ['fit', 'percent-100', 'preset-S', 'preset-M'] as const
).map(id => {
  const option = ANDROID_PANEL_SIZE_OPTIONS.find(candidate => candidate.id === id)
  if (option === undefined) throw new RangeError(`dsh-android: quick size ${id} is missing from the dropdown roster`)
  const label = androidPanelQuickLabel(id)
  return { id, mode: option.mode, quickEn: label.en, quickZh: label.zh }
})
