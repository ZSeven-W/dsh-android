/**
 * DSH-styled dropdown for the device panel header, replacing the native
 * `<select>`s (whose popup ignores the app theme). Modeled on dsh-crew's
 * CustomSelect (trigger button + portal-mounted fixed menu that flips up near
 * the viewport bottom, outside-click / Escape close, ✓ on the selected row)
 * but restyled onto the `--dsw-alias-*` tokens and extended with the grouped
 * options the device picker needs (kind groups with a heading icon, a
 * disabled AVD hint group, ● markers).
 *
 * Split for the static smoke like the panel's other pieces:
 * `AndroidSelectMenu` is pure presentation (SSR-able — `createPortal` renders
 * nothing under `renderToString`, so the smoke renders the menu directly),
 * `AndroidSelect` binds trigger + portal + dismissal behavior.
 * @module @zseven-w/dsh-android/client/android-select
 */

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'

/**
 * State dot rendered before an option's label. Both tones share ONE hue:
 * green means "this device is online". `active` is filled + glowing (it is
 * the one on screen, matching the panel's ● 实时 readout); `idle` is a hollow
 * ring (online, just not displayed). Options without a tone render no dot,
 * which is what an offline/unauthorized device looks like.
 */
export type AndroidSelectMarkerTone = 'active' | 'idle'

/** The dot palette — literal state colors, exactly like the live indicator. */
export const ANDROID_SELECT_MARKER_COLORS: Record<AndroidSelectMarkerTone, string> = {
  active: '#22c55e',
  idle: '#22c55e',
}

export interface AndroidSelectOption {
  value: string
  label: string
  /** State dot before the label (omit for no dot). */
  markerTone?: AndroidSelectMarkerTone
  disabled?: boolean
  ariaLabel?: string
  title?: string
  /** Extra data-* attributes for the option row (smoke/a11y hooks). */
  dataAttrs?: Record<string, string>
}

export interface AndroidSelectGroup {
  id: string
  /** Group heading (omit for a flat, headingless group). */
  label?: string
  /** Small icon rendered before the heading — the device-kind glyph. */
  icon?: ReactNode
  /** Disabled groups render their heading + rows muted and unpickable. */
  disabled?: boolean
  options: AndroidSelectOption[]
  /** Extra data-* attributes for the group container. */
  dataAttrs?: Record<string, string>
}

/** Token recipe shared by both dropdowns. Exported for the smoke. */
export const ANDROID_SELECT_STYLES: Record<string, CSSProperties> = {
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    minHeight: 22,
    padding: '1px 8px',
    borderRadius: 99,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    lineHeight: '16px',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  triggerLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // The caret is drawn as an inline SVG (a text ▾ renders hairline-thin and
  // sits off the text baseline); 12px with a 1.6 stroke reads at the same
  // weight as the toolbar's icon set.
  triggerCaret: {
    flex: 'none',
    display: 'block',
    opacity: 0.6,
  },
  menu: {
    position: 'fixed',
    zIndex: 10000,
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 10,
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.28)',
    padding: 4,
    maxHeight: 280,
    overflowY: 'auto',
    minWidth: 130,
  },
  groupLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px 3px',
    fontSize: 11,
    lineHeight: '14px',
    color: 'var(--dsw-alias-label-secondary)',
    whiteSpace: 'nowrap',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  optionDisabled: {
    cursor: 'default',
    color: 'var(--dsw-alias-label-secondary)',
    opacity: 0.65,
  },
  check: {
    flex: 'none',
    opacity: 0.7,
    fontSize: 11,
  },
  markerRow: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  marker: {
    flex: 'none',
    width: 8,
    height: 8,
    boxSizing: 'border-box',
    borderRadius: '50%',
  },
}

/** The label cell: an optional state dot plus the (ellipsizing) text. */
function AndroidSelectLabel({ option }: { option: Pick<AndroidSelectOption, 'label' | 'markerTone'> }): React.JSX.Element {
  if (option.markerTone === undefined) {
    return <span style={ANDROID_SELECT_STYLES.triggerLabel}>{option.label}</span>
  }
  return (
    <span style={ANDROID_SELECT_STYLES.markerRow}>
      <span
        style={{
          ...ANDROID_SELECT_STYLES.marker,
          ...(option.markerTone === 'active'
            ? {
                background: ANDROID_SELECT_MARKER_COLORS.active,
                boxShadow: '0 0 6px rgba(34,197,94,0.75)',
              }
            : {
                // Hollow ring: online, but not the one on screen.
                background: 'transparent',
                border: `1.5px solid ${ANDROID_SELECT_MARKER_COLORS.idle}`,
              }),
        }}
        aria-hidden="true"
        data-android-select-marker={option.markerTone}
      />
      <span style={ANDROID_SELECT_STYLES.triggerLabel}>{option.label}</span>
    </span>
  )
}

/** The selected/hover row fills (the light-theme layer ramp is invisible, so
 * the semantic interactive tokens are the only fills that read in BOTH). */
export const ANDROID_SELECT_ACTIVE_BG = 'var(--dsw-alias-interactive-bg-active)'
export const ANDROID_SELECT_HOVER_BG = 'var(--dsw-alias-interactive-bg-hover)'

export interface AndroidSelectMenuProps {
  groups: readonly AndroidSelectGroup[]
  value: string
  onPick: (value: string) => void
  /** Fixed-position geometry from the trigger (absent in SSR renders). */
  placement?: { left: number; top?: number; bottom?: number; minWidth: number }
  ariaLabel?: string
}

/** Pure menu rendering (listbox pattern); hover state is presentational. */
export function AndroidSelectMenu({ groups, value, onPick, placement, ariaLabel }: AndroidSelectMenuProps): React.JSX.Element {
  const [hovered, setHovered] = useState('')
  const placementStyle: CSSProperties = placement === undefined
    ? {}
    : {
        left: placement.left,
        minWidth: placement.minWidth,
        ...(placement.bottom !== undefined ? { bottom: placement.bottom } : { top: placement.top }),
      }
  return (
    <div
      style={{ ...ANDROID_SELECT_STYLES.menu, ...placementStyle }}
      role="listbox"
      aria-label={ariaLabel}
      data-android-select-menu="true"
      onMouseDown={event => { event.stopPropagation() }}
    >
      {groups.map(group => (
        <div key={group.id} role="group" aria-label={group.label} {...group.dataAttrs}>
          {group.label !== undefined ? (
            <div style={ANDROID_SELECT_STYLES.groupLabel} data-android-select-group-label="true">
              {group.icon}
              <span>{group.label}</span>
            </div>
          ) : null}
          {group.options.map(option => {
            const disabled = group.disabled === true || option.disabled === true
            const selected = option.value === value
            const background = selected
              ? ANDROID_SELECT_ACTIVE_BG
              : !disabled && hovered === option.value
                ? ANDROID_SELECT_HOVER_BG
                : 'transparent'
            return (
              <div
                key={option.value === '' ? `${group.id}:${option.label}` : option.value}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                aria-label={option.ariaLabel}
                title={option.title}
                style={{
                  ...ANDROID_SELECT_STYLES.option,
                  ...(disabled ? ANDROID_SELECT_STYLES.optionDisabled : undefined),
                  background,
                }}
                data-android-select-option={option.value}
                {...option.dataAttrs}
                onClick={disabled ? undefined : () => { onPick(option.value) }}
                onMouseEnter={disabled ? undefined : () => { setHovered(option.value) }}
                onMouseLeave={disabled ? undefined : () => { setHovered('') }}
              >
                <AndroidSelectLabel option={option} />
                {selected ? <span style={ANDROID_SELECT_STYLES.check} aria-hidden="true">✓</span> : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export interface AndroidSelectProps {
  value: string
  groups: readonly AndroidSelectGroup[]
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  /** Fires when the menu opens — the device picker's list-refresh hook. */
  onOpen?: () => void
  /** Extra style merged onto the trigger (width/flex tuning per call site). */
  triggerStyle?: CSSProperties
  /** Extra data-* attributes for the trigger button (smoke hooks). */
  dataAttrs?: Record<string, string>
}

interface AndroidSelectPlacement { left: number; top?: number; bottom?: number; minWidth: number }

export function AndroidSelect({
  value,
  groups,
  onChange,
  ariaLabel,
  disabled = false,
  onOpen,
  triggerStyle,
  dataAttrs,
}: AndroidSelectProps): React.JSX.Element {
  const [placement, setPlacement] = useState<AndroidSelectPlacement | null>(null)
  useEffect(() => {
    if (placement === null) return
    const close = (): void => { setPlacement(null) }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    // Defer the outside-click listener a tick so the opening click itself
    // does not immediately dismiss the menu (dsh-crew's pattern).
    const timer = setTimeout(() => { document.addEventListener('mousedown', close) }, 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [placement])
  const open = useCallback((trigger: HTMLElement): void => {
    const rect = trigger.getBoundingClientRect()
    const up = window.innerHeight - rect.bottom < 300
    setPlacement({
      left: rect.left,
      minWidth: Math.max(rect.width, 130),
      ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    })
    onOpen?.()
  }, [onOpen])
  const current = groups.flatMap(group => group.options).find(option => option.value === value)
  const pick = useCallback((picked: string): void => {
    setPlacement(null)
    if (picked !== value) onChange(picked)
  }, [onChange, value])
  return (
    <>
      <button
        type="button"
        style={{ ...ANDROID_SELECT_STYLES.trigger, ...triggerStyle }}
        disabled={disabled}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={placement !== null}
        data-android-select-trigger="true"
        {...dataAttrs}
        onClick={event => {
          if (placement !== null) setPlacement(null)
          else open(event.currentTarget)
        }}
      >
        <AndroidSelectLabel option={current ?? { label: value }} />
        <svg
          style={ANDROID_SELECT_STYLES.triggerCaret}
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          data-android-select-caret="true"
        >
          <path d="M4 6.5 L8 10.5 L12 6.5" />
        </svg>
      </button>
      {placement !== null && typeof document !== 'undefined'
        ? createPortal(
            <AndroidSelectMenu groups={groups} value={value} onPick={pick} placement={placement} ariaLabel={ariaLabel} />,
            document.body,
          )
        : null}
    </>
  )
}
