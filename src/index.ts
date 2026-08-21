/**
 * @zseven-w/dsh-android — build, run, and interact with a live Android device
 * inside a DeepSeek Harness conversation, driven entirely through adb.
 *
 * Plugin lifecycle: one AndroidHostController owns the in-process frame loop
 * for the session (no serve-sim child, no internal port — see
 * docs/architecture.zh.md decision 1); twenty model-facing tools are
 * registered through `ctx.effect` so unloading the plugin unregisters them,
 * and the returned disposer stops the stream, the keep-alive loop, and any
 * debug work still in flight.
 *
 * Emulators and physical devices are the SAME target here: the adb serial is
 * the only identity, so there is no dsh-ios-style simulator/real-device split
 * anywhere in this file.
 *
 * On a host without adb the tools still register but fail with a clear
 * explanatory error — the same degradation style dsh-ios uses on non-macOS.
 * @module @zseven-w/dsh-android
 */

import type { Context } from '@deepseek-ai/cordis'
import type ToolRegistry from '@deepseek-ai/dsh-tools'
import { AndroidHostController } from './android-host.js'
import { createAndroidTools, ANDROID_TOOL_NAMES } from './tools.js'
import { createAndroidUiTools, ANDROID_UI_TOOL_NAMES } from './tool-uitree.js'
import { createAndroidOcrTools, ANDROID_OCR_TOOL_NAMES } from './tool-ocr.js'
import { createAndroidRowTools, ANDROID_ROW_TOOL_NAMES } from './tool-list-rows.js'
import { createAndroidLogTools } from './tool-logs.js'
import { createAndroidDebugTools, ANDROID_DEBUG_TOOL_NAMES } from './tool-debug.js'
import { registerAndroidSkill } from './skill.js'
import { installStreamRoutes } from './stream-routes.js'

// ── public API ───────────────────────────────────────────────────────────────

export {
  AdbError,
  AdbToolchain,
  DEFAULT_BOOT_TIMEOUT_MS,
  SERIAL_PATTERN,
  bootAvd,
  listAvds,
  resolveAdbBinary,
  resolveEmulatorBinary,
  type AdbBinary,
  type AdbBinarySource,
  type AdbDeviceState,
  type AndroidDevice,
  type AndroidDeviceDetails,
  type ExecOptions,
} from './adb.js'
export {
  AdbFrameLoop,
  MultipartFrameWriter,
  PngFrameSplitter,
  STREAM_BOUNDARY,
  pngDimensions,
  type DeviceFrame,
  type FrameLoopEvents,
} from './frame-source.js'
export {
  ANDROID_BUTTONS,
  ANDROID_DEVICE_ACTIONS,
  AndroidHostController,
  NON_ASCII_TYPE_HINT,
  ROTATION_CYCLE,
  escapeInputText,
  isAndroidDeviceAction,
  isInputTextSafe,
  type AndroidButton,
  type AndroidDeviceAction,
  type AndroidDrag,
  type AndroidHostOptions,
  type AndroidHostStatus,
  type AndroidStreamInfo,
} from './android-host.js'
export {
  StreamAccessController,
  TOKEN_TTL_MS,
  classifyScreenshotPath,
  isLoopbackRemoteAddress,
  isTrustedRequest,
  openVerifiedScreenshot,
  prepareStreamAccessKey,
  screenshotDir,
  stateRoot,
  type ScreenshotTokenPayload,
  type ScreenshotVerdict,
  type StreamTokenPayload,
} from './stream-access.js'
export {
  CAPTURE_ROUTE_PATH,
  CONTROL_ROUTE_PATH,
  DEVICES_ROUTE_PATH,
  DEVICE_ACTION_ROUTE_PATH,
  GRANT_ROUTE_PATH,
  PLUGIN_ROUTE_PREFIX,
  SCREENSHOT_ROUTE_PREFIX,
  STATUS_ROUTE_PATH,
  STREAM_ROUTE_PREFIX,
  SWITCH_DEVICE_ROUTE_PATH,
  StreamRoutes,
  deviceStateErrorCode,
  installStreamRoutes,
  mountStreamRoutes,
  nextCapturePath,
  type AndroidRouteErrorCode,
  type StreamRouteMount,
} from './stream-routes.js'
export {
  ANDROID_LABEL_HINT,
  filterAndroidApps,
  listAndroidApps,
  noMatchCandidateLines,
  noMatchListingHint,
  parseDumpsysPackageVersions,
  parsePmListPackages,
  resolveAppByName,
  type AndroidApp,
} from './app-list.js'
export {
  APK_SEARCH_SKIPPED_DIRECTORIES,
  applicationIdFromOutputMetadata,
  applicationIdFromSources,
  assembleGradleArgs,
  assembleTask,
  buildFailureDetail,
  buildRun,
  detectProject,
  filterBuildOutput,
  findBuiltApk,
  isApkFile,
  launchPackage,
  moduleDirectoryOf,
  resolveApplicationId,
  runGradleBuild,
  type AndroidBuildRunResult,
  type AndroidProject,
  type BuildRunOptions,
  type BuiltApk,
  type ResolvedApplicationId,
} from './build-run.js'
/**
 * The core tool layer. `./tools.js` re-exports `./tool-support.js` (device
 * resolution, the shared ScreenshotStore, the interaction router) and
 * `./tool-apps.js` (list/launch/build-run), so one star export carries the
 * whole surface without listing it twice.
 */
export * from './tools.js'
export {
  ANDROID_UI_TOOL_NAMES,
  createAndroidUiTools,
  type AndroidToolHost,
  type AndroidUiTools,
  type AndroidUiToolsOptions,
} from './tool-uitree.js'
export {
  ANDROID_OCR_TOOL_NAMES,
  createAndroidOcrTools,
  type AndroidOcrTools,
} from './tool-ocr.js'
export {
  ANDROID_ROW_TOOL_NAMES,
  createAndroidRowTools,
  type AndroidRowTools,
} from './tool-list-rows.js'
export {
  LOG_BUFFERS,
  LOG_PRIORITIES,
  LogLineRing,
  MAX_LOG_BYTES,
  MAX_LOG_LINES,
  compileGrep,
  createAndroidLogTools,
  deviceStartTimestamp,
  durationSeconds,
  followSeconds,
  postProcess,
  resolvePackagePid,
  runLogCapture,
  snapshotDuration,
  type AndroidLogBuffer,
  type AndroidLogPriority,
  type AndroidLogTools,
  type AndroidLogsArgs,
  type AndroidLogsMode,
  type AndroidLogsResult,
} from './tool-logs.js'
export {
  ANDROID_DEBUG_TOOL_NAMES,
  capBacktrace,
  createAndroidDebugTools,
  parseMeminfo,
  parsePackageInfo,
  parseProcessTable,
  type AndroidAppInfoResult,
  type AndroidBacktraceResult,
  type AndroidDebugTools,
  type AndroidDebugToolsOptions,
  type AndroidMeminfoResult,
  type AndroidProcess,
  type AndroidProcessesResult,
  type BacktraceEngine,
  type MemoryCategory,
} from './tool-debug.js'
export {
  ANDROID_SKILL_CONTENT,
  ANDROID_SKILL_DESCRIPTION,
  ANDROID_SKILL_NAME,
  ANDROID_SKILL_WHEN_TO_USE,
  registerAndroidSkill,
} from './skill.js'
import { resolveVisionServices } from './vision.js'

// ── plugin entry ─────────────────────────────────────────────────────────────

/** Stable plugin name (the loader entry id in cordis.patch.yml). */
export {
  IMAGE_REF_SCHEMA,
  imageInputActive,
  renderJsonWithImage,
  resolveVisionServices,
  saveScreenshotAttachment,
  type AndroidImageRef,
  type AndroidVisionServices,
  type AttachmentStoreLike,
  type LlmServiceLike,
  type VisionExecLike,
} from './vision.js'

export const name = 'dsh-android'

/** Services this plugin's root fiber requires. */
export const inject = ['tools']

/**
 * rc.2 source worktrees augmented the legacy `cordis` package name while the
 * published rc line augments `@deepseek-ai/cordis`. Keep this plugin's build
 * structural so the same source type-checks against both without changing its
 * runtime service contract.
 */
type HostContext = Context & {
  tools: ToolRegistry
}

/** Plugin entry: mount every model-facing contribution. */
export function apply(ctx: Context): () => Promise<void> {
  const hostCtx = ctx as HostContext
  const host = new AndroidHostController()
  // Native multimodal delivery: when the host mounts the attachment store
  // and the routed model declares image input, the capture tools attach the
  // screenshot itself as an image block (vision.ts; absent services simply
  // keep the text-only behavior).
  const vision = resolveVisionServices(ctx)
  const tools = createAndroidTools(host, { vision })
  const uiTools = createAndroidUiTools(host, { vision })
  const ocrTools = createAndroidOcrTools(host, { vision })
  const rowTools = createAndroidRowTools(host, { vision })
  const logTools = createAndroidLogTools(host)
  // Debugging & memory diagnostics: created once so the same disposer can
  // stop new calls from starting while the plugin tears down.
  const debugTools = createAndroidDebugTools(host)
  // Keep the frame loop alive across crashes; an intentional stop (or the
  // idle timeout) is never fought.
  host.startKeepAlive()

  const disposers: Array<() => void | Promise<void>> = []
  // The bundled playbook: what the tool descriptions cannot say, because it is
  // about the workflow BETWEEN the tools. A host without the skill service
  // simply does not advertise it.
  disposers.push(registerAndroidSkill(ctx))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidDevices), 'dsh-android:android_devices'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidBoot), 'dsh-android:android_boot'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidShutdown), 'dsh-android:android_shutdown'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidScreenshot), 'dsh-android:android_screenshot'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidInteract), 'dsh-android:android_interact'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidListApps), 'dsh-android:android_list_apps'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidLaunchApp), 'dsh-android:android_launch_app'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(tools.androidBuildRun), 'dsh-android:android_build_run'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(uiTools.androidUiTree), 'dsh-android:android_ui_tree'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(uiTools.androidTapElement), 'dsh-android:android_tap_element'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(rowTools.androidUiRows), 'dsh-android:android_ui_rows'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(rowTools.androidTapRow), 'dsh-android:android_tap_row'))
  // The OCR trio registers as ONE effect: they share a backend, and a partial
  // registration (dsh-ios shipped one for a while) advertises a verb in the
  // playbook that has no implementation behind it.
  disposers.push(ctx.effect(() => {
    const disposeFind = hostCtx.tools.register(ocrTools.androidFindText)
    const disposeTap = hostCtx.tools.register(ocrTools.androidTapText)
    const disposeWait = hostCtx.tools.register(ocrTools.androidWaitFor)
    return () => {
      disposeWait()
      disposeTap()
      disposeFind()
    }
  }, 'dsh-android:android_ocr'))
  disposers.push(ctx.effect(() => hostCtx.tools.register(logTools.androidLogs), 'dsh-android:android_logs'))
  disposers.push(ctx.effect(() => {
    const disposeProcesses = hostCtx.tools.register(debugTools.androidProcesses)
    const disposeBacktrace = hostCtx.tools.register(debugTools.androidBacktrace)
    const disposeMeminfo = hostCtx.tools.register(debugTools.androidMeminfo)
    const disposeAppInfo = hostCtx.tools.register(debugTools.androidAppInfo)
    return () => {
      disposeAppInfo()
      disposeMeminfo()
      disposeBacktrace()
      disposeProcesses()
      debugTools.dispose()
    }
  }, 'dsh-android:debug-tools'))

  // Signed web routes (stream, screenshot, grant, control, …): mounted on the
  // optional webServer service; headless profiles skip them entirely.
  installStreamRoutes(ctx, host)

  const adb = host.toolchain.binary
  ctx.logger.info(
    `dsh-android mounted (${ANDROID_TOOL_NAMES.join(' + ')} + ${ANDROID_UI_TOOL_NAMES.join(' + ')} + `
    + `${ANDROID_ROW_TOOL_NAMES.join(' + ')} + ${ANDROID_OCR_TOOL_NAMES.join(' + ')} + android_logs + `
    + `${ANDROID_DEBUG_TOOL_NAMES.join(' + ')}; adb: `
    + `${adb.available ? `${adb.command ?? 'adb'} (${adb.source})` : `unavailable — ${adb.reason ?? '?'}`})`,
  )
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
    await host.dispose()
  }
}
