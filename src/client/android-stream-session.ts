/**
 * The one live-stream/control engine behind the dsh-android panel.
 *
 * A hybrid of the two dsh-ios sessions, because Android needs exactly half of
 * each: the GRANT lifecycle of the simulator stream session (generation
 * numbering, one-shot auto re-grant, seeded grant + settle watchdog) with the
 * REST control plane of the real-device session (coalesced pointer gestures
 * POSTed to `/control`). There is NO WebSocket anywhere in this plugin.
 *
 * - `POST /grant {kind:'stream', device}` → `<img src={streamUrl}>`, the
 *   in-process `multipart/x-mixed-replace` PNG stream. No `wsUrl` exists.
 * - LIVENESS is the FRAME itself: the img's `load` event with
 *   `naturalWidth > 0` is the only "the stream is up" signal there is (the
 *   ws `open` event dsh-ios used has no counterpart). `onFrameLoad` is
 *   therefore part of the session contract and the live-frame body calls it.
 * - Pointer gestures are coalesced (see `androidGestureActionOf`): one tap or
 *   one drag per gesture, POSTed to `/control` on pointer-up. Move events are
 *   sampled on a ~50 ms trailing edge for the gesture bookkeeping only.
 * - Buttons (◁ ○ □ and the hardware keys) and rotate are single POSTs too.
 *
 * Failure policy: an initial grant failure falls back with a retry; a stream
 * that dies after a successful grant (img error — e.g. the ~10-minute token
 * expiry) re-grants once automatically before falling back. Refresh re-grants,
 * which restarts an idle device's frame loop server-side per `/grant`.
 * Unmount drops the img src and reports offline.
 *
 * Device switch: a `seededGrant` (the switch-device response's fresh
 * capability URL) is applied exactly once, on the grant cycle whose serial
 * matches the seed, so the swap lands without a second round trip. Every
 * later re-grant goes through `/grant` normally.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import {
  ANDROID_DRAG_MOVE_SAMPLE_MS,
  androidGestureActionOf,
  androidRouteErrorTextOf,
  normalizePointerPoint,
  postAndroidControl,
  requestStreamGrant,
  type AndroidControlAction,
  type AndroidFetcher,
  type AndroidPoint,
  type AndroidStreamMeta,
} from './protocol.js'

export type AndroidStreamPhase = 'granting' | 'live' | 'fallback'

/**
 * Post-switch settle watchdog tuning: after a device switch seeds the stream,
 * re-grant every 4 s while no frame has drawn, up to 10 attempts (~40 s —
 * covers an emulator that is still coming up), then fall back with the retry
 * affordance. Exported for the smoke's assertions.
 */
export const ANDROID_SWITCH_SETTLE_INTERVAL_MS = 4000
export const ANDROID_SWITCH_SETTLE_ATTEMPTS = 10

/**
 * A pre-minted capability the stream session may adopt instead of POSTing
 * `/grant`: the device-switch flow hands over the switch-device response's
 * fresh URL so the new stream lands without a second round trip. Applied
 * exactly once (the next grant cycle whose serial matches); later re-grants
 * (refresh, img death, token expiry) go through `/grant` normally.
 */
export interface AndroidSeededGrant {
  serial: string
  streamUrl: string
  expiresAt?: number
}

export interface AndroidStreamSessionOptions {
  /** Stream presentationMeta (absent only for a disabled session). */
  meta?: AndroidStreamMeta
  fetcher?: AndroidFetcher
  /** Static fallback message shown once the auto-retry budget is spent. */
  unavailableCopy: string
  /** Observes the live/offline transitions (the panel's ● Live dot). */
  onLiveChange?: (live: boolean) => void
  /** When false the grant effect never runs (the panel owns one session per
   * render but only activates it for stream-mode results). Default true. */
  enabled?: boolean
  /** One-shot pre-minted capability (device switch). */
  seededGrant?: AndroidSeededGrant
  /** Locale table (androidCopy) used to localize route failure codes. */
  copy?: Record<string, string>
}

export interface AndroidStreamSession {
  phase: AndroidStreamPhase
  streamUrl: string | undefined
  failure: string
  /** True once a frame has drawn (the panel's "● 实时" source). */
  live: boolean
  imgRef: RefObject<HTMLImageElement>
  /** The device's last known `user_rotation` (0..3), when a rotate reported one. */
  rotation: number | undefined
  /** Manual refresh: clear the auto-retry budget and re-grant. */
  refresh: () => void
  /** One automatic re-grant (img error), then the fallback. */
  retryOnce: () => void
  /**
   * The stream img reported a decoded frame. `naturalWidth > 0` is the only
   * liveness signal this transport has, so the frame surface MUST call it.
   */
  onFrameLoad: (naturalWidth: number, naturalHeight: number) => void
  /** One navigation/hardware button (`back` / `home` / `recents` / …). */
  sendButton: (name: string) => void
  /** Advance the display rotation cycle; the response reports the new value. */
  sendRotate: () => void
  /** Pointer handlers over the stream surface; coordinates are normalized
   * against the element's displayed bounds and sent as-is (the frame follows
   * the display rotation, so there is nothing to inverse-map). */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * The one live-stream engine the panel binds. Every field is derived state —
 * no rendering lives here, so any surface can frame it however it likes.
 */
export function useAndroidStream(options: AndroidStreamSessionOptions): AndroidStreamSession {
  const { meta, fetcher, unavailableCopy, onLiveChange, enabled = true, seededGrant, copy } = options
  const serial = meta?.device?.serial
  const [phase, setPhase] = useState<AndroidStreamPhase>('granting')
  const [grant, setGrant] = useState<{ streamUrl: string }>()
  const [failure, setFailure] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [live, setLive] = useState(false)
  const [rotation, setRotation] = useState<number>()
  const autoRetriedRef = useRef(false)
  const generationRef = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)
  const pointerRef = useRef<{ id: number; start: AndroidPoint; latest: AndroidPoint; startAt: number; sampledAt: number }>()
  const liveRef = useRef(onLiveChange)
  liveRef.current = onLiveChange
  const copyRef = useRef<Record<string, string>>(copy ?? {})
  copyRef.current = copy ?? {}
  /** The seeded grant object already applied (one-shot consumption). */
  const consumedSeedRef = useRef<AndroidSeededGrant>()
  /** Post-switch settle budget. It must SURVIVE the re-grant cycles it
   * triggers: each re-grant re-runs the connect effect, whose cleanup clears
   * only the TIMER — the attempt budget lives here and is cleared when a
   * frame arrives, when the budget is exhausted, or when a switch reseeds. */
  const switchSettleRef = useRef<{ attemptsLeft: number }>()
  const settleTimerRef = useRef<ReturnType<typeof setInterval>>()

  const clearSettleTimer = useCallback((): void => {
    if (settleTimerRef.current !== undefined) {
      clearInterval(settleTimerRef.current)
      settleTimerRef.current = undefined
    }
  }, [])

  const reportLive = useCallback((next: boolean): void => {
    setLive(next)
    liveRef.current?.(next)
    // A drawn frame proves the stream settled: retire the switch watchdog.
    if (next && switchSettleRef.current !== undefined) {
      switchSettleRef.current = undefined
      clearSettleTimer()
    }
  }, [clearSettleTimer])

  /** One automatic re-grant, then the static fallback. */
  const autoReGrant = useCallback((): void => {
    // A switch stint owns the retry cadence: a device that is still coming up
    // refuses every attempt within ~1 s, so letting this path run during a
    // stint would burn the one-shot budget and drop to the fallback before
    // the settle timer's first tick. The timer re-grants on its own schedule
    // and declares the fallback itself once the budget is spent.
    if (switchSettleRef.current !== undefined) return
    if (autoRetriedRef.current) {
      setFailure(unavailableCopy)
      setPhase('fallback')
    } else {
      autoRetriedRef.current = true
      setAttempt(current => current + 1)
    }
  }, [unavailableCopy])

  /** Arm the settle timer for the current connect cycle. No-ops unless a
   * switch budget is active. Each tick: a drawn frame → retire; budget left →
   * spend one attempt and re-grant (the effect re-run restarts this timer);
   * exhausted → explicit fallback so the user sees 重试 instead of a stale
   * black frame. */
  const startSettleTimer = useCallback((): void => {
    if (switchSettleRef.current === undefined) return
    clearSettleTimer()
    const tick = (): void => {
      const settle = switchSettleRef.current
      if (settle === undefined) {
        clearSettleTimer()
        return
      }
      const img = imgRef.current
      if (img !== null && img.naturalWidth > 0) {
        switchSettleRef.current = undefined
        clearSettleTimer()
        return
      }
      if (settle.attemptsLeft > 0) {
        settle.attemptsLeft -= 1
        autoRetriedRef.current = false
        setAttempt(current => current + 1)
      } else {
        switchSettleRef.current = undefined
        clearSettleTimer()
        setFailure(unavailableCopy)
        setPhase('fallback')
      }
    }
    settleTimerRef.current = setInterval(tick, ANDROID_SWITCH_SETTLE_INTERVAL_MS)
  }, [clearSettleTimer, unavailableCopy])

  /** Manual refresh: clear the auto-retry budget and re-grant. */
  const refresh = useCallback((): void => {
    autoRetriedRef.current = false
    setFailure('')
    setAttempt(current => current + 1)
  }, [])

  /** A decoded frame is the ONE liveness signal this transport has. */
  const onFrameLoad = useCallback((naturalWidth: number): void => {
    if (!(naturalWidth > 0)) return
    // A frame that draws restores the one-shot budget, so a long session
    // survives more than a single token expiry.
    autoRetriedRef.current = false
    reportLive(true)
  }, [reportLive])

  useEffect(() => {
    if (!enabled) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    let disposed = false
    setPhase('granting')
    setGrant(undefined)
    setFailure('')
    reportLive(false)

    const cleanup = (): void => {
      disposed = true
      generationRef.current += 1
      imgRef.current?.removeAttribute('src')
      // Clear only the TIMER — the switch settle budget must survive the
      // effect re-run its own re-grant causes.
      clearSettleTimer()
      reportLive(false)
    }

    // One-shot seeded capability (the device-switch flow): apply it exactly
    // once, on the grant cycle whose serial matches the seed. Later re-grants
    // go through /grant normally (a stale seeded token must never be reused).
    const seed = seededGrant
    if (seed !== undefined && seed !== consumedSeedRef.current && seed.serial === serial) {
      consumedSeedRef.current = seed
      switchSettleRef.current = { attemptsLeft: ANDROID_SWITCH_SETTLE_ATTEMPTS }
      setGrant({ streamUrl: seed.streamUrl })
      setPhase('live')
      startSettleTimer()
      return cleanup
    }

    void requestStreamGrant(fetcher ?? fetch, { device: serial === undefined ? {} : { serial } }).then(result => {
      if (disposed || generation !== generationRef.current) return
      if (!result.ok) {
        // Initial grant failure (403/409/unavailable host) → static fallback.
        setFailure(androidRouteErrorTextOf(result, copyRef.current))
        setPhase('fallback')
        return
      }
      setGrant(result.grant)
      setPhase('live')
      // A watchdog-triggered re-grant lands here: keep watching until a frame
      // actually draws (no-op when no switch budget is active).
      startSettleTimer()
    })

    return cleanup
  }, [attempt, serial, enabled, fetcher, reportLive, seededGrant, startSettleTimer, clearSettleTimer])

  /** One control POST; failures are non-fatal (the img error path re-grants). */
  const control = useCallback((action: AndroidControlAction): void => {
    if (serial === undefined || serial === '') return
    void postAndroidControl(fetcher ?? fetch, serial, action).then(result => {
      if (result.ok && result.result.rotation !== undefined) setRotation(result.result.rotation)
    })
  }, [serial, fetcher])

  const sendButton = useCallback((name: string): void => {
    control({ kind: 'button', name })
  }, [control])

  const sendRotate = useCallback((): void => {
    control({ kind: 'rotate' })
  }, [control])

  /**
   * One pointer event → normalized coordinates of the DISPLAYED box. No
   * orientation mapping: the streamed frame follows the display rotation and
   * `input tap` addresses that same space (see protocol.ts).
   */
  const pointOf = (event: ReactPointerEvent<HTMLElement>): AndroidPoint => {
    return normalizePointerPoint(event, event.currentTarget.getBoundingClientRect())
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    const point = pointOf(event)
    pointerRef.current = {
      id: event.pointerId,
      start: point,
      latest: point,
      startAt: Date.now(),
      sampledAt: Date.now(),
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // capture is best-effort
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const active = pointerRef.current
    if (active === undefined || active.id !== event.pointerId) return
    // ~50 ms trailing-edge sample: refresh the gesture's latest point at a
    // bounded cadence (move storms cost one normalization per window).
    const now = Date.now()
    if (now - active.sampledAt < ANDROID_DRAG_MOVE_SAMPLE_MS) return
    active.sampledAt = now
    active.latest = pointOf(event)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const active = pointerRef.current
    if (active === undefined || active.id !== event.pointerId) return
    pointerRef.current = undefined
    // The final event is authoritative; the sampled latest point is the
    // fallback for a release that lands without usable coordinates.
    const final = pointOf(event)
    const end = Number.isFinite(final.x) && Number.isFinite(final.y) ? final : active.latest
    control(androidGestureActionOf(active.start, end, Date.now() - active.startAt))
  }

  return {
    phase,
    streamUrl: grant?.streamUrl,
    failure,
    live,
    rotation,
    imgRef,
    refresh,
    retryOnce: autoReGrant,
    onFrameLoad,
    sendButton,
    sendRotate,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
