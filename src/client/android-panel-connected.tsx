/**
 * The connected device panel: resolves the tool result's presentationMeta (or,
 * for nested Code Mode calls, reconstructs it from the durable result text)
 * and renders the live stream (boot / build-run) or the static screenshot
 * (screenshot / interact) inside the phone frame.
 *
 * It owns everything the pure chrome (android-panel.tsx) must not know about:
 *
 * - the stream session (grant → img, control POSTs), so the top toolbar can
 *   reach the ◁ ○ □ nav keys, rotate, refresh;
 * - the header device picker + the switch/seeded-grant handshake: picking a
 *   device POSTs `/switch-device`, shows 切换中… while the old stream closes,
 *   seeds the returned capability into the session and swaps the panel meta
 *   to the new device; the panel host replaces the open request/source in
 *   place so store and registry follow. Size and frame state are untouched;
 * - the server-truth resync: when a grant falls back, `/status` is asked what
 *   is ACTUALLY streaming and the panel adopts it, so the panel and the host
 *   can never disagree about the streamed device;
 * - auto-follow: while the panel is open (and the host passed its sessionId)
 *   it re-targets to the session's NEWEST settled result — a stable target
 *   for `ANDROID_PANEL_FOLLOW_DEBOUNCE_MS`, never during a switch, and never
 *   after a manual pick until 恢复跟随 is clicked;
 * - the capture controller behind the toolbar's 截图 button and the device
 *   menu's five actions.
 *
 * Unlike dsh-ios there is exactly ONE device class: an emulator and a USB
 * phone are the same adb serial on the same stream path, so there is no
 * real-device session, no WDA progress surface and no device-kind branching.
 */

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { androidCopy, type AndroidLocale } from './copy.js'
import {
  ANDROID_CARD_TOOLS,
  androidRouteErrorTextOf,
  postDeviceAction,
  requestAndroidDevices,
  requestAndroidStatus,
  type AndroidFetcher,
  type AndroidScreenshotMeta,
  type AndroidStreamMeta,
  type AndroidSwitchResponse,
} from './protocol.js'
import { resolveAndroidMeta } from './android-meta-hydrate.js'
import { AndroidLiveFrameBody } from './android-live-frame.js'
import { useAndroidStream, type AndroidSeededGrant } from './android-stream-session.js'
import { useAndroidCapture } from './android-panel-capture.js'
import {
  AndroidDevicePicker,
  androidSwitchedStreamMetaOf,
  createAndroidDeviceSwitchController,
  type AndroidDeviceSwitchController,
} from './android-device-picker.js'
import type { CompatibleToolDetailsViewProps } from './details-compat.js'
import { CARD_STYLES } from './card-styles.js'
import { ANDROID_PANEL_SIZE_MODE_FIT, type AndroidPanelSizeMode } from './android-panel-size.js'
import { ANDROID_FRAME_STYLE_BEZEL, type AndroidFrameStyle } from './android-frame-style.js'
import type { AndroidDeviceMenuAction } from './android-device-menu.js'
import {
  AndroidFollowIndicator,
  AndroidPanelBody,
  AndroidScreenshotFrame,
  PANEL_STYLES,
  androidToolNameOf,
  type AndroidPanelMode,
} from './android-panel.js'
import {
  androidFollowNewestCandidateOf,
  androidFollowStateInitial,
  androidFollowStateNext,
  androidFollowTargetOf,
  type AndroidFollowState,
} from './android-panel-follow.js'
import {
  androidPanelSourcesSnapshot,
  androidPanelSourcesVersion,
  subscribeAndroidPanelSources,
} from './android-panel-trigger.js'
import type { AndroidPanelDisplayReport } from './android-panel-host.js'

export interface AndroidPanelProps {
  toolName: string
  block: ToolCallBlock
  /**
   * The session the panel belongs to (the panel host passes the open
   * request's sessionId). Present → auto-follow is enabled. Absent (the
   * per-tool details seat) → follow stays off.
   */
  sessionId?: string
  fetcher?: AndroidFetcher
  colorScheme: 'light' | 'dark'
  locale: AndroidLocale
  onClose?: () => void
  /** Controlled size mode (the panel host owns it via the panel store). */
  sizeMode?: AndroidPanelSizeMode
  /** Controlled size-mode change (absent → internal state, fit default). */
  onSizeModeChange?: (mode: AndroidPanelSizeMode) => void
  /** Controlled frame shell mode (absent → internal state, bezel default). */
  frameStyle?: AndroidFrameStyle
  /** Controlled frame-style change (absent → internal state). */
  onFrameStyleChange?: (style: AndroidFrameStyle) => void
  /** Frame display report for the panel host (its landscape auto-widen). */
  onDisplayChange?: (display: AndroidPanelDisplayReport) => void
  /** A successful device switch — the panel already adopted the new device
   * (synthetic meta + seeded grant); the host uses this to replace the open
   * request/source so the store and registry follow the switch. */
  onDeviceSwitched?: (result: AndroidSwitchResponse) => void
}

export function AndroidPanel({
  toolName,
  block,
  fetcher,
  colorScheme,
  locale,
  onClose,
  sizeMode,
  onSizeModeChange,
  frameStyle,
  onFrameStyleChange,
  onDisplayChange,
  onDeviceSwitched,
  sessionId,
}: AndroidPanelProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const [liveOpen, setLiveOpen] = useState(false)
  const [naturalWidth, setNaturalWidth] = useState<number>()
  const [naturalHeight, setNaturalHeight] = useState<number>()
  // Internal size/frame state for surfaces without a controlling store (the
  // per-tool details seat); the panel host passes controlled values.
  const [internalSizeMode, setInternalSizeMode] = useState<AndroidPanelSizeMode>(ANDROID_PANEL_SIZE_MODE_FIT)
  const activeSizeMode = sizeMode ?? internalSizeMode
  const handleSizeModeChange = onSizeModeChange ?? setInternalSizeMode
  const [internalFrameStyle, setInternalFrameStyle] = useState<AndroidFrameStyle>(ANDROID_FRAME_STYLE_BEZEL)
  const activeFrameStyle = frameStyle ?? internalFrameStyle
  const handleFrameStyleChange = onFrameStyleChange ?? setInternalFrameStyle
  const settled = 'kind' in block
  const resolved = settled && !block.isError ? resolveAndroidMeta(toolName, block) : undefined
  const meta = resolved?.meta
  const baseStreamMeta: AndroidStreamMeta | undefined = meta?.kind === 'android-stream'
    ? meta
    : meta?.kind === 'android-build-run'
      ? { kind: 'android-stream', device: meta.device }
      : undefined
  const screenshotMeta: AndroidScreenshotMeta | undefined = meta?.kind === 'android-screenshot' ? meta : undefined

  // ── auto-follow (the panel re-targets to the newest in-session result) ────
  const sourcesVersion = useSyncExternalStore(
    subscribeAndroidPanelSources,
    androidPanelSourcesVersion,
    androidPanelSourcesVersion,
  )
  const followEnabled = sessionId !== undefined && sessionId !== ''
  const [followState, dispatchFollow] = useReducer(
    androidFollowStateNext,
    undefined,
    (): AndroidFollowState => androidFollowStateInitial(resolved?.meta.device?.serial),
  )
  const followStateRef = useRef(followState)
  followStateRef.current = followState
  /** True while a follow-triggered switch is in flight — its settle (stream
   * live / fallback / switch error) reports back into the machine. */
  const followSwitchRef = useRef(false)
  /** One commit at a time (queued decisions are consumed sequentially). */
  const followCommitBusyRef = useRef(false)

  // ── device switch state (the header picker) ───────────────────────────────
  const [switchedMeta, setSwitchedMeta] = useState<AndroidStreamMeta>()
  const [seededGrant, setSeededGrant] = useState<AndroidSeededGrant>()
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const switchTargetRef = useRef<string>()
  const seedStreamUrlRef = useRef<string>()
  const switchControllerRef = useRef<AndroidDeviceSwitchController>()
  const onDeviceSwitchedRef = useRef(onDeviceSwitched)
  onDeviceSwitchedRef.current = onDeviceSwitched

  const streamMeta: AndroidStreamMeta | undefined = switchedMeta ?? baseStreamMeta
  const mode: AndroidPanelMode = streamMeta !== undefined
    ? 'stream'
    : screenshotMeta !== undefined
      ? 'screenshot'
      : 'unavailable'
  // The plugin only serves Android devices: the header title is the unified
  // "Android 设备" / "Android" regardless of which tool opened the panel. The
  // device picker below carries the identity.
  const title = copy.android

  // The stream session lives HERE (not inside the frame) so the top toolbar
  // can reach the nav keys / rotate / refresh. It stays dormant for non-stream
  // panels — one unconditional hook keeps the hook order stable.
  const streamSession = useAndroidStream({
    ...(streamMeta === undefined ? {} : { meta: streamMeta }),
    copy: copy as unknown as Record<string, string>,
    ...(fetcher === undefined ? {} : { fetcher }),
    unavailableCopy: copy.streamUnavailable,
    onLiveChange: setLiveOpen,
    enabled: streamMeta !== undefined,
    ...(seededGrant === undefined ? {} : { seededGrant }),
  })

  // Bind the device-switch controller (no network during render/SSR — the
  // controller only POSTs from a pick). The picker's transitional flag clears
  // once the stream seeded from the switch response draws a frame or falls
  // back.
  useEffect(() => {
    const controller = createAndroidDeviceSwitchController({
      fetcher: fetcher ?? fetch,
      copy: copy as unknown as Record<string, string>,
      onSwitchingChange: setSwitching,
      onSwitched: (result) => {
        setSwitchError('')
        switchTargetRef.current = result.device
        seedStreamUrlRef.current = result.streamUrl
        setSwitchedMeta(androidSwitchedStreamMetaOf(result))
        setSeededGrant({
          serial: result.device,
          streamUrl: result.streamUrl,
          ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt }),
        })
        onDeviceSwitchedRef.current?.(result)
      },
      onError: (message) => {
        // Selection reverts automatically: the panel meta never changed.
        switchTargetRef.current = undefined
        setSwitchError(message)
        if (followSwitchRef.current) {
          // A follow-triggered switch failed: end the machine's in-flight
          // guard (the panel stays on the old device).
          followSwitchRef.current = false
          dispatchFollow({ kind: 'switch-settled', now: Date.now() })
        }
      },
    })
    switchControllerRef.current = controller
    return () => controller.dispose()
    // `copy` is read once for the failure localization and is stable per
    // locale; rebinding the controller on every render would drop an
    // in-flight switch, so the fetcher is the only dependency.
  }, [fetcher])

  useEffect(() => {
    if (!switching) return
    const seedUrl = seedStreamUrlRef.current
    if (seedUrl !== undefined
      && streamSession.phase === 'live'
      && streamSession.streamUrl === seedUrl) {
      // The new grant (the switch-device capability) is live: swap done.
      seedStreamUrlRef.current = undefined
      setSwitching(false)
      if (followSwitchRef.current) {
        followSwitchRef.current = false
        dispatchFollow({ kind: 'switch-settled', serial: switchTargetRef.current, now: Date.now() })
      }
      return
    }
    if (streamSession.phase === 'fallback'
      && switchTargetRef.current !== undefined
      && streamMeta?.device?.serial === switchTargetRef.current) {
      // The seeded grant fell back: end the transitional state and let the
      // frame's fallback surface carry the failure.
      switchTargetRef.current = undefined
      setSwitching(false)
      if (followSwitchRef.current) {
        followSwitchRef.current = false
        dispatchFollow({ kind: 'switch-settled', now: Date.now() })
      }
    }
  }, [switching, streamSession.phase, streamSession.streamUrl, streamMeta])

  // Server truth wins over local belief. When the stream cannot be granted for
  // the device the panel thinks it owns, ask /status what is ACTUALLY
  // streaming and adopt it — the picker mirrors this meta, so the two can
  // never disagree (and the panel stops re-granting a stale serial).
  useEffect(() => {
    if (streamSession.phase !== 'fallback' || streamMeta === undefined) return
    let cancelled = false
    void requestAndroidStatus(fetcher ?? fetch).then(status => {
      if (cancelled || !status.running || status.serial === undefined) return
      if (status.serial === streamMeta.device?.serial) return
      setSwitchedMeta(androidSwitchedStreamMetaOf({
        device: status.serial,
        ...(status.deviceName === undefined ? {} : { deviceName: status.deviceName }),
        // No capability URL: this is a meta re-sync, not a seeded grant — the
        // next grant cycle mints a fresh one for the real device.
        streamUrl: '',
      }))
      setSeededGrant(undefined)
    })
    return () => { cancelled = true }
  }, [streamSession.phase, streamMeta, fetcher])

  /** The stream branch of a device pick, shared with the auto-follow commit
   * path: POST switch-device for the serial (the controller seeds the new
   * grant and the existing onDeviceSwitched bookkeeping keeps the store and
   * registry in sync). */
  const switchStreamTo = useCallback((serial: string): void => {
    if (serial === streamMeta?.device?.serial) return
    switchTargetRef.current = serial
    switchControllerRef.current?.switchTo(serial)
  }, [streamMeta])

  const handleSelectDevice = useCallback((value: string): void => {
    if (value === '') return
    // A picker pick is the user's explicit choice: auto-follow stands down for
    // the rest of this panel session. A switch the panel applies BY
    // auto-follow never dispatches this.
    dispatchFollow({ kind: 'manual-pick', serial: value })
    switchStreamTo(value)
  }, [switchStreamTo])

  // ── auto-follow commit: apply one decided serial via the switch path ──────
  const commitFollowQueue = useCallback(async (): Promise<void> => {
    if (!followEnabled || followCommitBusyRef.current || followStateRef.current.inflight) return
    const decision = followStateRef.current.decisions[0]
    if (decision === undefined) return
    followCommitBusyRef.current = true
    try {
      dispatchFollow({ kind: 'consume', seq: decision.seq })
      const listing = await requestAndroidDevices(fetcher ?? fetch)
      // A serial the host cannot address at all (unknown / offline /
      // unauthorized) is never followed: the panel must not yank the user's
      // live view for a device nothing can be done with.
      if (androidFollowTargetOf(decision.serial, listing) === undefined) return
      // A manual pick during the listing fetch supersedes the decision, and a
      // concurrent switch in flight is never overlapped.
      if (followStateRef.current.userOverrode || followStateRef.current.inflight) return
      followSwitchRef.current = true
      dispatchFollow({ kind: 'switch-start' })
      if (decision.serial === streamMeta?.device?.serial) {
        // The stream already serves this device: nothing to switch — but the
        // machine's current device still re-bases.
        followSwitchRef.current = false
        dispatchFollow({ kind: 'switch-settled', serial: decision.serial, now: Date.now() })
        return
      }
      switchTargetRef.current = decision.serial
      if (switchControllerRef.current?.switchTo(decision.serial) !== true) {
        // A concurrent switch is already in flight: never overlap.
        followSwitchRef.current = false
        dispatchFollow({ kind: 'switch-settled', now: Date.now() })
      }
    } finally {
      followCommitBusyRef.current = false
    }
  }, [followEnabled, fetcher, streamMeta])

  // Newest settled in-session result → arm the debounce window.
  useEffect(() => {
    if (!followEnabled) return
    const candidate = androidFollowNewestCandidateOf(androidPanelSourcesSnapshot(), sessionId ?? '')
    if (candidate === undefined) return
    dispatchFollow({ kind: 'result', serial: candidate.serial, version: candidate.time, now: Date.now() })
  }, [sourcesVersion, sessionId, followEnabled])

  // The debounce timer: one armed window → one timer at its deadline.
  useEffect(() => {
    const pending = followState.pending
    if (pending === undefined) return
    const delay = Math.max(0, pending.deadline - Date.now())
    const timer = setTimeout(() => { dispatchFollow({ kind: 'tick', now: Date.now() }) }, delay)
    return () => { clearTimeout(timer) }
  }, [followState.pending])

  // Consume decisions (re-triggers when a switch settle flips the in-flight
  // guard so an aged target releases).
  useEffect(() => {
    if (followState.decisions.length > 0) void commitFollowQueue()
  }, [followState.decisions.length, followState.inflight, commitFollowQueue])

  // The device menu's runner. A failure surfaces through the picker's inline
  // error line — the same place every other control failure lands.
  const deviceActionDevice = streamMeta?.device?.serial ?? screenshotMeta?.device?.serial
  const runDeviceAction = useCallback(async (action: AndroidDeviceMenuAction): Promise<void> => {
    setSwitchError('')
    const result = await postDeviceAction(fetcher ?? fetch, deviceActionDevice, action)
    if (!result.ok) {
      const localized = androidRouteErrorTextOf(result, copy as unknown as Record<string, string>)
      const message = localized === '' ? copy.deviceActionFailed : localized
      setSwitchError(message)
      throw new Error(message)
    }
  }, [fetcher, deviceActionDevice, copy])

  const capture = useAndroidCapture({ ...(fetcher === undefined ? {} : { fetcher }) })
  const captureDevice = (streamMeta ?? screenshotMeta)?.device?.serial
  const onScreenshot = useCallback((): void => {
    capture.capture(captureDevice)
  }, [capture, captureDevice])

  const onNavButton = useCallback((name: 'back' | 'home' | 'recents'): void => {
    streamSession.sendButton(name)
  }, [streamSession])

  // Report the frame size up to the panel host so its landscape auto-widen can
  // follow the device; non-stream panels report an all-undefined display.
  useEffect(() => {
    if (onDisplayChange === undefined) return
    if (mode === 'stream') {
      onDisplayChange({ naturalWidth, naturalHeight })
      return
    }
    onDisplayChange({ naturalWidth: undefined, naturalHeight: undefined })
  }, [mode, naturalWidth, naturalHeight, onDisplayChange])

  return (
    <AndroidPanelBody
      title={title}
      device={streamMeta?.device ?? meta?.device}
      devicePicker={streamMeta !== undefined || screenshotMeta !== undefined ? (
        <AndroidDevicePicker
          {...(fetcher === undefined ? {} : { fetcher })}
          currentDevice={streamMeta?.device ?? screenshotMeta?.device}
          switching={switching}
          error={switchError}
          locale={locale}
          onSelect={handleSelectDevice}
        />
      ) : undefined}
      followIndicator={followEnabled ? (
        <AndroidFollowIndicator
          overridden={followState.userOverrode}
          locale={locale}
          onResume={() => { dispatchFollow({ kind: 'resume-follow' }) }}
        />
      ) : undefined}
      mode={mode}
      liveOpen={liveOpen}
      colorScheme={colorScheme}
      locale={locale}
      {...(onClose === undefined ? {} : { onClose })}
      sizeMode={activeSizeMode}
      {...(naturalWidth === undefined ? {} : { naturalWidth })}
      {...(naturalHeight === undefined ? {} : { naturalHeight })}
      onSizeModeChange={handleSizeModeChange}
      frameStyle={activeFrameStyle}
      onFrameStyleChange={handleFrameStyleChange}
      {...(mode === 'stream' ? { onNavButton, onRotate: streamSession.sendRotate, onRefresh: streamSession.refresh } : {})}
      {...(meta === undefined ? {} : { onScreenshot })}
      {...(mode === 'stream' ? { onDeviceAction: runDeviceAction } : {})}
      captureState={capture.phase}
    >
      {streamMeta !== undefined ? (
        <AndroidLiveFrameBody
          meta={streamMeta}
          locale={locale}
          session={streamSession}
          {...(naturalWidth === undefined ? {} : { naturalWidth })}
          {...(naturalHeight === undefined ? {} : { naturalHeight })}
          onNaturalSize={(width, height) => {
            setNaturalWidth(width)
            setNaturalHeight(height)
          }}
        />
      ) : screenshotMeta !== undefined ? (
        <AndroidScreenshotFrame
          meta={screenshotMeta}
          {...(fetcher === undefined ? {} : { fetcher })}
          locale={locale}
          onNaturalSize={setNaturalWidth}
        />
      ) : (
        <div style={PANEL_STYLES.unavailable} role="status">
          <span style={CARD_STYLES.muted}>{copy.noPreview}</span>
        </div>
      )}
    </AndroidPanelBody>
  )
}

export interface AndroidDetailsPanelProps {
  block: ToolCallBlock
  colorScheme: 'light' | 'dark'
  locale: string
}

/**
 * Per-tool details-seat renderer for DSH runtimes that declare
 * `tool.details.toolview` (absent in rc.6 — registration is guarded by
 * `ctx.slots.inject`). The native details column supplies its own header and
 * close control, so the panel body renders without `onClose`.
 */
export function AndroidDetailsPanel({
  block,
  colorScheme,
  locale,
}: AndroidDetailsPanelProps & CompatibleToolDetailsViewProps): React.JSX.Element {
  const toolName = androidToolNameOf(block) || ANDROID_CARD_TOOLS.boot
  return (
    <AndroidPanel
      toolName={toolName}
      block={block}
      colorScheme={colorScheme}
      locale={locale === 'zh' ? 'zh' : 'en'}
    />
  )
}
