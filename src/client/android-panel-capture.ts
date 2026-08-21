/**
 * The panel toolbar's 截图 (Screenshot) flow: POST `/_dsh/dsh-android/capture`
 * (the host captures a FRESH PNG of the current streamed device and signs a
 * relative screenshot URL), then `window.open(screenshotUrl, '_blank')` and a
 * transient "已截图 / Captured" inline confirmation in the toolbar that
 * auto-hides after ~2 s.
 *
 * The state machine lives in `createAndroidCaptureController` — a pure,
 * timer-injectable controller the dev-panel-smoke script drives with fake
 * timers and a mocked fetcher (no browser, no device). `useAndroidCapture`
 * binds it to React for the panel; it performs no network during render
 * (capture only ever runs from a click).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  requestAndroidCapture,
  type AndroidFetcher,
} from './protocol.js'

export type AndroidCapturePhase = 'idle' | 'busy' | 'done'

/** How long the "captured" confirmation stays visible (~2 s). */
export const ANDROID_CAPTURE_CONFIRM_MS = 2000

/** Injectable timers (the smoke drives the auto-hide with a fake clock). */
export interface AndroidCaptureTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const DEFAULT_CAPTURE_TIMERS: AndroidCaptureTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface AndroidCaptureControllerOptions {
  /** Fetcher to POST the capture endpoint with (defaults to global fetch). */
  fetcher?: AndroidFetcher
  /** Opens the minted screenshot URL; defaults to `window.open` in a browser. */
  openWindow?: (url: string, target: string) => void
  /** Auto-hide delay for the confirmation (default `ANDROID_CAPTURE_CONFIRM_MS`). */
  autoHideMs?: number
  /** Injectable timers (fake-clock tests). */
  timers?: AndroidCaptureTimers
}

export interface AndroidCaptureController {
  getPhase: () => AndroidCapturePhase
  /** POST the capture route and open the minted URL. Resolves true on
   * success; false on a failed request (phase returns to idle). */
  capture: (device?: string) => Promise<boolean>
  subscribe: (listener: () => void) => () => void
  dispose: () => void
}

/**
 * The pure capture state machine, bound to an options ref so the React hook
 * can pass fresh fetcher/openWindow values without recreating the store.
 */
export function createAndroidCaptureController(
  optionsRef: { current: AndroidCaptureControllerOptions },
): AndroidCaptureController {
  let phase: AndroidCapturePhase = 'idle'
  let busy = false
  let hideTimer: unknown
  let disposed = false
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const listener of listeners) listener() }
  const setPhase = (next: AndroidCapturePhase): void => {
    if (phase === next) return
    phase = next
    emit()
  }
  const timersOf = (): AndroidCaptureTimers => optionsRef.current.timers ?? DEFAULT_CAPTURE_TIMERS
  const clearHide = (): void => {
    if (hideTimer === undefined) return
    timersOf().clearTimeout(hideTimer)
    hideTimer = undefined
  }
  const openWindowOf = (): ((url: string, target: string) => void) | undefined => {
    const provided = optionsRef.current.openWindow
    if (provided !== undefined) return provided
    if (typeof window === 'undefined') return undefined
    return (url, target) => { window.open(url, target) }
  }

  return {
    getPhase: () => phase,
    async capture(device) {
      if (busy || disposed) return false
      busy = true
      setPhase('busy')
      const fetcher = optionsRef.current.fetcher ?? fetch
      const result = await requestAndroidCapture(fetcher, { device })
      busy = false
      if (disposed) return false
      if (!result.ok) {
        setPhase('idle')
        return false
      }
      try {
        openWindowOf()?.(result.capture.screenshotUrl, '_blank')
      } catch {
        // a blocked popup still counts as captured — the URL was minted
      }
      setPhase('done')
      clearHide()
      hideTimer = timersOf().setTimeout(() => {
        hideTimer = undefined
        if (!disposed) setPhase('idle')
      }, optionsRef.current.autoHideMs ?? ANDROID_CAPTURE_CONFIRM_MS)
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      disposed = true
      clearHide()
      listeners.clear()
    },
  }
}

export interface AndroidCaptureSession {
  phase: AndroidCapturePhase
  /** Kick off a fresh capture for `device` (toolbar click handler). */
  capture: (device?: string) => void
}

/** React binding: capture on click → open minted URL + transient toast. */
export function useAndroidCapture(options: AndroidCaptureControllerOptions): AndroidCaptureSession {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [controller] = useState(() => createAndroidCaptureController(optionsRef))
  const phase = useSyncExternalStore(controller.subscribe, controller.getPhase, controller.getPhase)
  useEffect(() => () => controller.dispose(), [controller])
  const capture = useCallback((device?: string): void => {
    void controller.capture(device)
  }, [controller])
  return { phase, capture }
}
