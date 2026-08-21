/**
 * The panel's device-actions menu: the five device-level gestures the host
 * exposes (`ANDROID_DEVICE_ACTIONS`), reachable from the toolbar.
 *
 * Shape: one icon button (sliders) in the same pill language as the other
 * toolbar icons, opening a small command list BELOW it. Unlike the device
 * picker this is not a value selector — nothing stays "selected" — so it is a
 * plain popover of buttons rather than an `AndroidSelect`.
 *
 * Every action works on every device: adb does not distinguish emulators from
 * phones, so there is no per-backend availability table (the dsh-ios
 * simulator-only rows have no counterpart here) and no row is ever disabled
 * for the device kind.
 *
 * @module @zseven-w/dsh-android/client/android-device-menu
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AndroidCopy } from './copy.js'
import { ANDROID_DEVICE_ACTIONS, type AndroidDeviceActionName } from './protocol.js'

/** Actions the menu offers, in render order (mirrors the host's table). */
export const ANDROID_DEVICE_MENU_ACTIONS: readonly AndroidDeviceActionName[] = ANDROID_DEVICE_ACTIONS

export type AndroidDeviceMenuAction = AndroidDeviceActionName

/** Localized label for one action. */
export function androidDeviceActionLabelOf(action: AndroidDeviceMenuAction, copy: AndroidCopy): string {
  switch (action) {
    case 'notifications': return copy.deviceNotifications
    case 'quick-settings': return copy.deviceQuickSettings
    case 'lock': return copy.deviceLock
    case 'wake': return copy.deviceWake
    case 'assistant': return copy.deviceAssistant
  }
}

/** The sliders glyph, in the toolbar's 16×16 stroke-icon language. */
export const ANDROID_DEVICE_MENU_ICON_PATHS: readonly string[] = [
  'M2.75 4.5 H13.25',
  'M2.75 11.5 H13.25',
  'M6 2.9 V6.1',
  'M10.5 9.9 V13.1',
]

export const ANDROID_DEVICE_MENU_STYLES: Record<string, CSSProperties> = {
  root: { position: 'relative', display: 'inline-flex' },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    zIndex: 30,
    minWidth: 168,
    padding: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  },
  item: {
    appearance: 'none',
    border: 'none',
    borderRadius: 7,
    padding: '6px 10px',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: 12,
    lineHeight: '18px',
    textAlign: 'left',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  itemHover: { background: 'var(--dsw-alias-interactive-bg-hover)' },
  busy: { opacity: 0.6, cursor: 'progress' },
}

export interface AndroidDeviceMenuProps {
  copy: AndroidCopy
  /** Runs one action; rejections surface through `onError`. */
  onAction: (action: AndroidDeviceMenuAction) => Promise<void> | void
  /** Reports a failed action so the panel can show its own message. */
  onError?: (message: string) => void
  /** Force-open for the static smoke (absent → internal state). */
  open?: boolean
}

/**
 * The menu. Closes on outside pointerdown, on Escape, and after a successful
 * action — a failed one keeps it open so the next attempt is one click away.
 */
export function AndroidDeviceMenu({
  copy,
  onAction,
  onError,
  open: openOverride,
}: AndroidDeviceMenuProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false)
  const [hovered, setHovered] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)
  const open = openOverride ?? internalOpen

  useEffect(() => {
    if (!open || openOverride !== undefined) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      setInternalOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setInternalOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, openOverride])

  const run = useCallback(async (action: AndroidDeviceMenuAction): Promise<void> => {
    setBusy(action)
    try {
      await onAction(action)
      setInternalOpen(false)
    } catch (error) {
      // Stay open: the user's next move is almost always "try again".
      onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }, [onAction, onError])

  return (
    <div style={ANDROID_DEVICE_MENU_STYLES.root} ref={rootRef} data-android-device-menu="true">
      <button
        type="button"
        style={ANDROID_TOOLBAR_TRIGGER_STYLE}
        aria-label={copy.deviceMenu}
        title={copy.deviceMenu}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        data-android-device-menu-trigger="true"
        onClick={() => { setInternalOpen(current => !current) }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          {ANDROID_DEVICE_MENU_ICON_PATHS.map(path => (
            <path key={path} d={path} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      </button>
      {open ? (
        <div style={ANDROID_DEVICE_MENU_STYLES.menu} role="menu" aria-label={copy.deviceMenu} data-android-device-menu-list="true">
          {ANDROID_DEVICE_MENU_ACTIONS.map(action => {
            const label = androidDeviceActionLabelOf(action, copy)
            let style = ANDROID_DEVICE_MENU_STYLES.item
            if (hovered === action) style = { ...style, ...ANDROID_DEVICE_MENU_STYLES.itemHover }
            if (busy === action) style = { ...style, ...ANDROID_DEVICE_MENU_STYLES.busy }
            return (
              <button
                key={action}
                type="button"
                role="menuitem"
                style={style}
                disabled={busy !== undefined}
                title={label}
                data-android-device-action={action}
                onMouseEnter={() => setHovered(action)}
                onMouseLeave={() => setHovered(undefined)}
                onClick={() => { void run(action) }}
              >
                {label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Same 28px square as the other toolbar icons (kept local to avoid a cycle). */
const ANDROID_TOOLBAR_TRIGGER_STYLE: CSSProperties = {
  appearance: 'none',
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}
