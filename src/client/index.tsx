/**
 * Browser presentation for the dsh-android device tools.
 *
 * Registers `tool.call.toolview` slots for the four tools that emit visual
 * presentationMeta (`android_boot`, `android_screenshot`, `android_interact`,
 * `android_build_run`); every other tool keeps the default generic card. Each
 * registered view is wrapped in an error boundary so a throwing slot component
 * never takes down the conversation, and theme/locale are synced through the
 * host services exactly like dsh-openpencil/dsh-ios.
 *
 * The device display lives ONLY in the persistent right-side panel
 * (Codex-style): the per-tool `tool.details.toolview` details seat is
 * registered through the same `ctx.slots.inject` guard dsh-openpencil uses, so
 * a future DSH runtime that declares it gets the native details surface for
 * free. The installed rc.6 runtime does NOT declare that seat, so on rc.6 the
 * plugin mounts its own page-owned right panel host and opens it when the user
 * clicks a device tool row. The row-click trigger steps aside if the details
 * seat ever gets declared. Inline tool cards are compact one-line summaries
 * (title, device, badge, "open in sidebar" cue) with NO imagery.
 *
 * A stream-status capsule is registered in the `conversation.input.dock` slot:
 * while the panel is closed and a device stream is online it renders a small
 * pill above the input box that opens the panel for the streamed device.
 *
 * Nested Code Mode (PTC) calls never carry `presentationMeta` (the harness
 * projects it only for top-level calls). The cards and the panel instead
 * reconstruct the identical meta from the settled result's durable JSON text
 * via `android-meta-hydrate.ts`; standard-mode sessions are untouched.
 */

import { useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { AndroidCardBoundary } from './card-boundary.js'
import { AndroidStreamCard, type AndroidCardOptions } from './android-stream-card.js'
import { AndroidScreenshotCard } from './android-screenshot-card.js'
import { AndroidBuildRunCard } from './android-build-run-card.js'
import { ANDROID_CARD_TOOLS } from './protocol.js'
import { AndroidDetailsPanel } from './android-panel-connected.js'
import { mountAndroidPanelHost, type AndroidPanelHost } from './android-panel-host.js'
import { installAndroidPanelRowTrigger, type AndroidPanelSource } from './android-panel-trigger.js'
import { AndroidStatusCapsule } from './android-status-capsule.js'
import type { CompatibleToolDetailsViewProps } from './details-compat.js'

// Re-exported so the dev-panel-smoke script reuses the exact wire helpers and
// pure state machines from the BUILT bundle.
export * from './protocol.js'
export { AndroidCardBoundary } from './card-boundary.js'
export { AndroidStreamCard, androidCardChrome, androidCardDeviceLabelOf, type AndroidCardOptions } from './android-stream-card.js'
export { AndroidScreenshotCard } from './android-screenshot-card.js'
export { AndroidBuildRunCard } from './android-build-run-card.js'
export { androidCopy, formatBytes, type AndroidCopy, type AndroidLocale } from './copy.js'
export { androidResultSummaryOf, androidResultTextOf, type AndroidResultSummary } from './android-result.js'
export {
  hydrateAndroidMeta,
  resolveAndroidMeta,
  type AndroidMetaSource,
  type ResolvedAndroidMeta,
} from './android-meta-hydrate.js'
export {
  useAndroidStream,
  ANDROID_SWITCH_SETTLE_INTERVAL_MS,
  ANDROID_SWITCH_SETTLE_ATTEMPTS,
  type AndroidSeededGrant,
  type AndroidStreamPhase,
  type AndroidStreamSession,
} from './android-stream-session.js'
export {
  useAndroidScreenshot,
  type AndroidScreenshotPhase,
  type AndroidScreenshotSession,
} from './android-screenshot-session.js'
export {
  AndroidLiveFrame,
  AndroidLiveFrameBody,
  type AndroidLiveFrameSessionState,
} from './android-live-frame.js'
export {
  AndroidSelect,
  AndroidSelectMenu,
  ANDROID_SELECT_STYLES,
  ANDROID_SELECT_ACTIVE_BG,
  ANDROID_SELECT_HOVER_BG,
  ANDROID_SELECT_MARKER_COLORS,
  type AndroidSelectGroup,
  type AndroidSelectOption,
  type AndroidSelectProps,
} from './android-select.js'
export {
  ANDROID_DEVICE_KIND_ICON_PATHS,
  ANDROID_DEVICE_PICKER_KEYFRAMES,
  ANDROID_DEVICE_PICKER_STYLES,
  AndroidDeviceKindIcon,
  AndroidDevicePicker,
  AndroidDevicePickerBody,
  androidDeviceGroupsOf,
  androidDeviceLabelOf,
  androidDeviceSelectGroupsOf,
  androidSwitchedStreamMetaOf,
  createAndroidDeviceSwitchController,
  type AndroidDeviceGroup,
  type AndroidDevicePickerBodyProps,
  type AndroidDeviceSwitchController,
} from './android-device-picker.js'
export {
  ANDROID_FOLLOW_INDICATOR_STYLES,
  AndroidFollowIndicator,
  AndroidLiveIndicator,
  AndroidPanelBody,
  AndroidScreenshotFrame,
  AndroidScreenshotFrameBody,
  PANEL_LIVE_INDICATOR_STYLES,
  PANEL_STYLES,
  androidToolNameOf,
  type AndroidPanelBodyProps,
  type AndroidPanelMode,
} from './android-panel.js'
export {
  AndroidPhoneFrame,
  DEVICE_FRAME_STYLES,
  DEVICE_SIDE_BUTTONS,
  FRAMELESS_FRAME_STYLES,
  PHONE_BEZEL_STYLES,
  androidPanelFrameStyles,
  androidPhoneScreenStyles,
} from './android-panel-frame.js'
export {
  AndroidDetailsPanel,
  AndroidPanel,
  type AndroidPanelProps,
} from './android-panel-connected.js'
export {
  ANDROID_FRAME_BEZEL_SHELL,
  ANDROID_FRAME_DEVICE_SHELL,
  ANDROID_FRAME_RADIUS_FALLBACK_PX,
  ANDROID_FRAME_SCREEN_RADIUS_RATIO,
  ANDROID_FRAME_SHELL_BORDER_PX,
  ANDROID_FRAME_STYLE_BEZEL,
  ANDROID_FRAME_STYLE_OPTIONS,
  androidFrameStyleLabelOf,
  androidFrameStyleOf,
  androidPanelFrameBorderPxOf,
  androidPanelFrameInsetOf,
  androidPanelFrameRadiusFallbackOf,
  androidPanelScreenBoxOf,
  androidPanelScreenRadiusOf,
  androidPanelScreenWidthOf,
  androidPanelShellPadOf,
  androidPanelShellRadiusOf,
  type AndroidFrameStyle,
} from './android-frame-style.js'
export {
  ANDROID_DEVICE_MENU_ACTIONS,
  ANDROID_DEVICE_MENU_ICON_PATHS,
  ANDROID_DEVICE_MENU_STYLES,
  AndroidDeviceMenu,
  androidDeviceActionLabelOf,
  type AndroidDeviceMenuAction,
} from './android-device-menu.js'
export {
  ANDROID_TOOLBAR_ACTION_IDS,
  ANDROID_TOOLBAR_ICON_PATHS,
  ANDROID_TOOLBAR_NAV_ACTIONS,
  ANDROID_TOOLBAR_STYLES,
  ANDROID_TOOLBAR_TOOLTIP_DELAY_MS,
  AndroidSizeQuickSegment,
  AndroidToolbarIcon,
  AndroidToolbarIconButton,
  AndroidToolbarTooltip,
  androidToolbarActionLabelOf,
  type AndroidToolbarActionId,
} from './android-toolbar.js'
export {
  ANDROID_PANEL_DOCK_ATTRIBUTE,
  claimAndroidPanelDock,
  type AndroidPanelDockLease,
} from './android-panel-dock.js'
export {
  ANDROID_PANEL_DEFAULT_WIDTH,
  ANDROID_PANEL_FULLSCREEN_BREAKPOINT,
  ANDROID_PANEL_LANDSCAPE_HEIGHT_PX,
  ANDROID_PANEL_LEFT_CLEARANCE,
  ANDROID_PANEL_MAX_WIDTH,
  ANDROID_PANEL_MIN_WIDTH,
  androidPanelDisplayIsLandscape,
  androidPanelEffectiveWidth,
  androidPanelLandscapeTargetWidthOf,
  androidPanelRequestKey,
  androidPanelStore,
  androidPanelWidthBounds,
  androidPanelWidthStateInitial,
  androidPanelWidthStateNext,
  androidSwitchedPanelRequestOf,
  clampAndroidPanelWidth,
  createAndroidPanelStore,
  mountAndroidPanelHost,
  resizedAndroidPanelWidth,
  type AndroidPanelDisplayReport,
  type AndroidPanelHost,
  type AndroidPanelRequest,
  type AndroidPanelStore,
  type AndroidPanelWidthAction,
  type AndroidPanelWidthState,
} from './android-panel-host.js'
export {
  ANDROID_PANEL_INTERACTIVE_SELECTOR,
  androidPanelClickIsInteractive,
  androidPanelClickRowCallIdOf,
  androidPanelSourcesSnapshot,
  androidPanelSourcesVersion,
  hasAndroidPanelSourceForSession,
  installAndroidPanelRowTrigger,
  registerAndroidPanelSource,
  resolveAndroidPanelSource,
  subscribeAndroidPanelSources,
  useAndroidPanelSource,
  type AndroidPanelSource,
} from './android-panel-trigger.js'
export {
  ANDROID_PANEL_AUTO_OPEN_TOOLS,
  androidPanelAutoOpenActivatedAt,
  androidPanelAutoOpenKey,
  androidPanelAutoOpenShouldOpen,
  forgetAndroidPanelAutoOpenCall,
  rememberAndroidPanelAutoOpenCall,
  takeAndroidPanelAutoOpenCall,
  type AndroidPanelAutoOpenDecision,
} from './android-panel-auto-open.js'
export {
  ANDROID_PANEL_FOLLOW_DEBOUNCE_MS,
  androidFollowNewestCandidateOf,
  androidFollowStateInitial,
  androidFollowStateNext,
  androidFollowTargetOf,
  type AndroidFollowAction,
  type AndroidFollowCandidate,
  type AndroidFollowDecision,
  type AndroidFollowState,
  type AndroidFollowTarget,
} from './android-panel-follow.js'
export {
  ANDROID_PANEL_DEVICE_SCALE_FALLBACK,
  ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT,
  ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH,
  ANDROID_PANEL_PERCENT_OPTIONS,
  ANDROID_PANEL_PRESET_OPTIONS,
  ANDROID_PANEL_QUICK_SIZE_OPTIONS,
  ANDROID_PANEL_SIZE_MODE_FIT,
  ANDROID_PANEL_SIZE_OPTIONS,
  androidDeviceScaleOf,
  androidPanelDisplayLogicalWidthOf,
  androidPanelFrameLayoutOf,
  androidPanelFrameWidthOf,
  androidPanelSizeModeIdOf,
  androidPanelSizeModeOf,
  androidPanelSnapPxOf,
  type AndroidFrameLayout,
  type AndroidPanelSizeMode,
} from './android-panel-size.js'
export {
  ANDROID_CAPTURE_CONFIRM_MS,
  createAndroidCaptureController,
  useAndroidCapture,
  type AndroidCaptureController,
  type AndroidCapturePhase,
  type AndroidCaptureSession,
  type AndroidCaptureTimers,
} from './android-panel-capture.js'
export {
  ANDROID_STATUS_POLL_MS,
  ANDROID_STATUS_REFRESH_DEBOUNCE_MS,
  AndroidStatusCapsule,
  AndroidStatusCapsuleBody,
  androidStreamStatusRequestOf,
  createAndroidStatusPoller,
  fetchAndroidStreamStatus,
  type AndroidStatusCapsuleBodyProps,
  type AndroidStatusFetcher,
  type AndroidStatusPollTimers,
} from './android-status-capsule.js'
export type { CompatibleToolDetailsViewProps } from './details-compat.js'

/** Required client services. */
export const inject = ['slots', 'theme', 'locale']

type AndroidCardComponent = (props: ToolCallViewProps & AndroidCardOptions) => React.JSX.Element

function subscribeThemeOf(ctx: ClientContext): (notify: () => void) => (() => boolean) {
  return notify => ctx.on('theme/change', notify)
}

function getColorSchemeOf(ctx: ClientContext): () => 'light' | 'dark' {
  return () => ctx.theme.getTheme().active.colorScheme
}

function subscribeLocaleOf(ctx: ClientContext): (notify: () => void) => (() => boolean) {
  return notify => ctx.on('locale/change', notify)
}

function getLocaleOf(ctx: ClientContext): () => string {
  return () => ctx.locale.getLocale().active
}

function hostSyncedCard(
  ctx: ClientContext,
  Card: AndroidCardComponent,
  autoOpen?: (source: AndroidPanelSource) => void,
): (props: ToolCallViewProps) => React.JSX.Element {
  const subscribeTheme = subscribeThemeOf(ctx)
  const getColorScheme = getColorSchemeOf(ctx)
  const subscribeLocale = subscribeLocaleOf(ctx)
  const getLocale = getLocaleOf(ctx)

  const HostSyncedCard = (props: ToolCallViewProps): React.JSX.Element => {
    const colorScheme = useSyncExternalStore(subscribeTheme, getColorScheme, getColorScheme)
    const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)
    return (
      <AndroidCardBoundary>
        <Card {...props} colorScheme={colorScheme} locale={locale} autoOpen={autoOpen} />
      </AndroidCardBoundary>
    )
  }
  return HostSyncedCard
}

/** Register one `tool.call.toolview` slot per tool name (openpencil shape). */
function registerCard(
  ctx: ClientContext,
  toolName: string,
  Card: AndroidCardComponent,
  autoOpen?: (source: AndroidPanelSource) => void,
): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: toolName },
    hostSyncedCard(ctx, Card, autoOpen),
  ))
}

function hostSyncedDetailsPanel(
  ctx: ClientContext,
): (props: CompatibleToolDetailsViewProps) => React.JSX.Element {
  const subscribeTheme = subscribeThemeOf(ctx)
  const getColorScheme = getColorSchemeOf(ctx)
  const subscribeLocale = subscribeLocaleOf(ctx)
  const getLocale = getLocaleOf(ctx)

  const HostSyncedDetailsPanel = (props: CompatibleToolDetailsViewProps): React.JSX.Element => {
    const colorScheme = useSyncExternalStore(subscribeTheme, getColorScheme, getColorScheme)
    const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)
    return (
      <AndroidCardBoundary>
        <AndroidDetailsPanel {...props} colorScheme={colorScheme} locale={locale} />
      </AndroidCardBoundary>
    )
  }
  return HostSyncedDetailsPanel
}

/** Register one per-tool `tool.details.toolview` slot (openpencil shape). */
function registerDetailsPanel(
  ctx: ClientContext,
  toolName: string,
  onDetailsSlotDeclared: () => (() => void),
): void {
  ctx.slots.inject('tool.details.toolview', () => {
    const disposeRegistration = ctx.slots.register(
      { name: 'tool.details.toolview', key: toolName },
      hostSyncedDetailsPanel(ctx),
    )
    // A declaring runtime activates the native details seat: the rc.6
    // fallback (page-owned panel + row-click trigger) steps aside. Noop on
    // rc.6, where `inject` waits forever for a slot that never appears.
    const disposeFallback = onDetailsSlotDeclared()
    return [disposeRegistration, disposeFallback]
  })
}

/** Cross-version minimum for the session-scoped input-dock seat. */
interface CompatibleInputDockProps {
  sessionId: string
}

function hostSyncedStatusCapsule(
  ctx: ClientContext,
): (props: CompatibleInputDockProps) => React.JSX.Element {
  const subscribeLocale = subscribeLocaleOf(ctx)
  const getLocale = getLocaleOf(ctx)
  const HostSyncedStatusCapsule = (props: CompatibleInputDockProps): React.JSX.Element => {
    const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)
    // The dock seat is session-scoped: the framework-resolved sessionId is the
    // capsule's gate — it renders/polls only while THIS session has Android
    // sources registered (see android-status-capsule.tsx).
    return <AndroidStatusCapsule locale={locale === 'zh' ? 'zh' : 'en'} sessionId={String(props.sessionId)} />
  }
  return HostSyncedStatusCapsule
}

const PANEL_TOOLS = [
  ANDROID_CARD_TOOLS.boot,
  ANDROID_CARD_TOOLS.buildRun,
  ANDROID_CARD_TOOLS.interact,
  ANDROID_CARD_TOOLS.screenshot,
] as const

/** Register canonical views plus the resident device panel surfaces. */
export function apply(ctx: ClientContext): void {
  // rc.6 fallback surface: a page-owned right panel host opened by clicking a
  // device tool row. Declared up front so the START card can be handed the
  // auto-open callback that resolves through it.
  let panelHost: AndroidPanelHost | undefined
  let rowTriggerDispose: (() => void) | undefined
  const detailsSlotDeclared = (): boolean => ctx.slots.spec('tool.details.toolview') !== undefined

  // Auto-open: a settled START verb (android_boot) opens the panel once.
  // openIfIdle (not open) so a settle never replaces an already-open panel.
  const autoOpenSource = (source: AndroidPanelSource): void => {
    panelHost?.openIfIdle(source)
  }

  registerCard(ctx, ANDROID_CARD_TOOLS.boot, AndroidStreamCard, autoOpenSource)
  registerCard(ctx, ANDROID_CARD_TOOLS.screenshot, AndroidScreenshotCard)
  registerCard(ctx, ANDROID_CARD_TOOLS.interact, AndroidScreenshotCard)
  registerCard(ctx, ANDROID_CARD_TOOLS.buildRun, AndroidBuildRunCard)

  const stepFallbackAside = (): (() => void) => {
    rowTriggerDispose?.()
    rowTriggerDispose = undefined
    panelHost?.close()
    return () => {}
  }

  // Per-tool details seat (Codex-style right panel). `slots.inject` waits
  // while the slot is undeclared — rc.6 never declares it, so this degrades
  // silently and the page-owned host below carries the surface instead.
  for (const toolName of PANEL_TOOLS) {
    registerDetailsPanel(ctx, toolName, stepFallbackAside)
  }

  // Stream-status capsule in the composer input dock (openpencil's
  // selection-chip seat, same `ctx.slots.inject` guard and entry shape).
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsh-android-status', order: 40 },
    hostSyncedStatusCapsule(ctx),
  ))

  if (typeof document !== 'undefined') {
    ctx.effect(() => {
      panelHost = mountAndroidPanelHost({
        subscribeTheme: subscribeThemeOf(ctx),
        getColorScheme: getColorSchemeOf(ctx),
        subscribeLocale: subscribeLocaleOf(ctx),
        getLocale: getLocaleOf(ctx),
      })
      if (!detailsSlotDeclared()) {
        rowTriggerDispose = installAndroidPanelRowTrigger(document, source => panelHost?.open(source) ?? false)
      }
      return () => {
        rowTriggerDispose?.()
        rowTriggerDispose = undefined
        panelHost?.dispose()
        panelHost = undefined
      }
    }, 'dsh-android: device panel host')
  }
}
