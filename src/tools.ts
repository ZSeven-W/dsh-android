/**
 * Model-facing core tools for the Android plugin (adb-centric, see
 * docs/architecture.zh.md decision 0).
 *
 * Every tool returns plain JSON — never an image content block, because the
 * DeepSeek adapter rejects image blocks anywhere in a request. Visual bytes
 * reach the UI only through `output.presentationMeta`, which projects pure,
 * replayable data (device serial, screenshot file path, stable stream route
 * id); the client/web-route layer re-mints signed access at render time.
 *
 * Degradation mirrors dsh-ios: the tools ALWAYS register, and each `execute`
 * throws a clear explanatory error when adb is unresolvable — a machine
 * without the Android SDK must load the plugin and be told why, not silently
 * lose eight verbs.
 *
 * Emulators and physical devices share ONE code path here. adb does not
 * distinguish them and neither do we, so there is no dsh-ios-style
 * simulator/real-device split, no WebDriverAgent gate, and no second listing.
 *
 * This module owns the five device/stream verbs; the three app-lifecycle
 * verbs live in `tool-apps.ts` (the 800-line file rule) and the shared
 * runtime in `tool-support.ts`. Both are re-exported here, so `./tools.js`
 * stays the one import path the sibling tool families use.
 * @module @zseven-w/dsh-android/tools
 */

import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootAvd, listAvds, type AndroidDevice } from './adb.js'
import type { AndroidHostController } from './android-host.js'
import { createAndroidAppTools } from './tool-apps.js'
import {
  INTERACT_ACTIONS,
  INTERACT_SETTLE_MS,
  SCROLL_DIRECTIONS,
  ScreenshotStore,
  assertAdbAvailable,
  captureScreenshot,
  deviceSchema,
  deviceSummary,
  errorMessage,
  performInteract,
  renderJson,
  resolveTarget,
  screenshotMeta,
  sleep,
  type AndroidDeviceInfo,
  type AndroidInteractAction,
  type AndroidInteractArgs,
  type AndroidScreenshotResult,
} from './tool-support.js'
import { screenshotDir } from './stream-access.js'
import { IMAGE_REF_SCHEMA, renderJsonWithImage, type AndroidVisionServices } from './vision.js'

export * from './tool-support.js'
export * from './tool-apps.js'

/** Registered tool names, in registration order. */
export const ANDROID_TOOL_NAMES = [
  'android_devices',
  'android_boot',
  'android_shutdown',
  'android_screenshot',
  'android_interact',
  'android_list_apps',
  'android_launch_app',
  'android_build_run',
] as const

/** One row of `android_devices`. */
export interface AndroidDeviceListing extends AndroidDeviceInfo {
  /** Emulators and phones both stream; the kind is informational. */
  kind: 'emulator' | 'physical'
  model?: string
  product?: string
  sdk?: number
  /** AVD name, when the emulator console answered. */
  avdName?: string
  /** True for the device the panel is currently streaming. */
  streaming?: boolean
}

export interface AndroidDevicesResult {
  devices: AndroidDeviceListing[]
  count: number
  /** Serials in the fully-online `device` state. */
  online: string[]
  /** AVD names this machine can boot with android_boot (may be empty). */
  avds: string[]
  /** Set when AVD discovery failed; the device list is still authoritative. */
  note?: string
}

export interface AndroidBootResult {
  device: AndroidDeviceInfo
  state: 'streaming'
  streaming: true
  /** True when an AVD was launched (rather than an online device adopted). */
  booted: boolean
}

export interface AndroidShutdownResult {
  device: AndroidDeviceInfo
  state: 'shutdown'
  streaming: false
}

export interface AndroidInteractResult extends AndroidScreenshotResult {
  action: AndroidInteractAction
}

export interface AndroidToolsOptions {
  /** Plugin-owned cache root (default `<tmp>/dsh-android`). */
  cacheDir?: string
  /** Optional attachments+llm services for native image delivery. */
  vision?: AndroidVisionServices
}

/** The eight core tool definitions bound to one host controller. */
export interface AndroidTools {
  androidDevices: ToolDefinition
  androidBoot: ToolDefinition
  androidShutdown: ToolDefinition
  androidScreenshot: ToolDefinition
  androidInteract: ToolDefinition
  androidListApps: ToolDefinition
  androidLaunchApp: ToolDefinition
  androidBuildRun: ToolDefinition
}

/** Create the eight `android_*` core tool definitions bound to one host. */
export function createAndroidTools(host: AndroidHostController, options: AndroidToolsOptions = {}): AndroidTools {
  const vision = options.vision
  const cacheDir = options.cacheDir ?? join(tmpdir(), 'dsh-android')
  // The screenshot ROUTE serves exactly one directory (stream-access's
  // screenshotDir()), so the default store must BE that directory or every
  // capture would be un-grantable. A caller-supplied cacheDir keeps the same
  // `<cacheDir>/screenshots` layout.
  const screenshots = new ScreenshotStore(
    options.cacheDir === undefined ? screenshotDir() : join(cacheDir, 'screenshots'),
  )

  const androidDevices = defineTool({
    name: 'android_devices',
    description: 'List every device adb can see — emulators and USB/network-attached phones alike — with '
      + 'its serial, connection state, model and Android version, plus the AVD names this machine can boot '
      + 'under `avds`. The SERIAL is the identity every other android_* tool takes; emulators and physical '
      + 'devices go through exactly the same tools. A device in state "unauthorized" needs the USB-debugging '
      + 'prompt accepted ON the device; "offline" usually means it is still booting. Run this first to '
      + 'discover what to pass as `device`.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          devices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                serial: { type: 'string', required: true },
                name: { type: 'string', required: true },
                androidVersion: { type: 'string', required: true },
                state: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['emulator', 'physical'] },
                model: { type: 'string' },
                product: { type: 'string' },
                sdk: { type: 'integer' },
                avdName: { type: 'string' },
                streaming: { type: 'boolean' },
              },
            },
          },
          count: { type: 'integer', required: true },
          online: { type: 'array', required: true, items: { type: 'string' } },
          avds: { type: 'array', required: true, items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute() {
      assertAdbAvailable(host, 'android_devices')
      let listed: AndroidDevice[]
      try {
        listed = await host.toolchain.listDevices()
      } catch (error) {
        // A failed enumeration THROWS: an empty list must always be a fact
        // about the machine, never about adb having fallen over.
        throw new Error(
          `android_devices: adb could not enumerate devices: ${errorMessage(error)} — try \`adb kill-server\` `
          + 'and retry, or check that the USB cable carries data',
        )
      }
      const streamed = host.streamedSerial
      const devices: AndroidDeviceListing[] = []
      for (const device of listed) {
        // getprop only answers for an online device; an offline/unauthorized
        // row still lists, it just carries less.
        const details = device.state === 'device'
          ? await host.toolchain.deviceDetails(device).catch(() => undefined)
          : undefined
        devices.push({
          ...deviceSummary(device, details),
          kind: device.emulator ? 'emulator' : 'physical',
          ...(device.model === undefined ? {} : { model: device.model }),
          ...(device.product === undefined ? {} : { product: device.product }),
          ...(details?.sdk === undefined ? {} : { sdk: details.sdk }),
          ...(details?.avdName === undefined ? {} : { avdName: details.avdName }),
          ...(device.serial === streamed ? { streaming: true } : {}),
        })
      }
      let avds: string[] = []
      let note: string | undefined
      try {
        avds = await listAvds()
      } catch (error) {
        // AVD discovery is optional by design (decision 0): a machine with no
        // emulator launcher still drives every attached device.
        note = `AVD discovery unavailable: ${errorMessage(error)}`
      }
      if (devices.length === 0 && avds.length === 0 && note === undefined) {
        note = 'adb sees no device and no AVD was discovered — start an emulator, or plug in a phone with '
          + 'USB debugging enabled (Settings → Developer options), then run this tool again'
      }
      return {
        devices,
        count: devices.length,
        online: devices.filter(device => device.state === 'device').map(device => device.serial),
        avds,
        ...(note === undefined ? {} : { note }),
      } satisfies AndroidDevicesResult
    },
    presentCall: () => ({ card: 'generic', title: 'List Android devices' }),
  })

  const androidBoot = defineTool({
    name: 'android_boot',
    description: 'Start the live panel stream for an Android device, booting an AVD first when needed. '
      + 'Pass `device` as either an adb SERIAL that is already online (emulator-5554, a USB serial, or '
      + 'ip:port — the stream starts immediately) or an AVD NAME from android_devices.avds (the emulator '
      + 'is launched and the tool waits for it to finish booting, which takes minutes on a cold start). '
      + 'The stream stays alive for the conversation so the UI can show the device live.',
    parameters: {
      device: {
        type: 'string',
        required: true,
        description: 'An online adb serial (from android_devices.devices) or an AVD name (from '
          + 'android_devices.avds). Serials stream immediately; an AVD name is booted first.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          state: { type: 'string', required: true, const: 'streaming' },
          streaming: { type: 'boolean', required: true, const: true },
          booted: { type: 'boolean', required: true },
        },
      },
      render: renderJson,
      presentationMeta: (_args: unknown, value: JsonValue): JsonValue => {
        const result = value as unknown as AndroidBootResult
        return {
          kind: 'android-stream',
          device: { ...result.device },
          streamRouteId: `dsh-android/stream/${result.device.serial}`,
        }
      },
    },
    timeoutMs: 420_000,
    async execute(args: { device: string }) {
      assertAdbAvailable(host, 'android_boot')
      const reference = typeof args.device === 'string' ? args.device.trim() : ''
      if (reference === '') {
        throw new Error('android_boot: device is required — pass an online serial or an AVD name (run android_devices)')
      }
      const listed = await host.toolchain.listDevices()
      let target: AndroidDevice | undefined = listed.find(
        device => device.serial === reference && device.state === 'device',
      )
      let booted = false
      if (target === undefined) {
        target = await bootReferencedAvd(host, reference, listed)
        booted = true
      }
      try {
        await host.ensureStreaming({ serial: target.serial })
      } catch (error) {
        throw new Error(
          `android_boot: the live stream for ${target.serial} did not start: `
          + `${errorMessage(error).replace(/^dsh-android: /, '')}`,
        )
      }
      const details = await host.toolchain.deviceDetails(target).catch(() => undefined)
      return {
        device: deviceSummary(target, details),
        state: 'streaming',
        streaming: true,
        booted,
      } satisfies AndroidBootResult
    },
    presentCall: (args: { device: string }) => ({
      card: 'generic',
      title: `Stream Android device ${args.device}`,
      kind: 'execute',
    }),
  })

  const androidShutdown = defineTool({
    name: 'android_shutdown',
    description: 'Stop the live stream and power OFF an EMULATOR (`adb emu kill`). Physical devices are '
      + 'refused: a phone is powered off from the phone, never from this machine — unplug it, or just stop '
      + 'using it (the stream idles out on its own). Pass the emulator serial from android_devices.',
    parameters: {
      device: {
        type: 'string',
        required: true,
        description: 'Emulator serial to power off, e.g. "emulator-5554" (from android_devices).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          state: { type: 'string', required: true, const: 'shutdown' },
          streaming: { type: 'boolean', required: true, const: false },
        },
      },
      render: renderJson,
    },
    timeoutMs: 120_000,
    async execute(args: { device: string }) {
      const { device, summary } = await resolveTarget(host, 'android_shutdown', args.device)
      if (!device.emulator) {
        throw new Error(
          `android_shutdown: ${device.serial} is a physical device — this tool powers off EMULATORS only. `
          + 'A phone is powered off from the phone itself; to stop using it here, simply stop calling the '
          + 'tools (the stream reaps itself after five idle minutes) or unplug the cable.',
        )
      }
      if (host.streamedSerial === device.serial) await host.stop()
      try {
        await host.toolchain.exec(['emu', 'kill'], { serial: device.serial, timeoutMs: 30_000 })
      } catch (error) {
        throw new Error(
          `android_shutdown: \`adb -s ${device.serial} emu kill\` failed: ${errorMessage(error)} — the `
          + 'emulator console may already be gone; run android_devices to check',
        )
      }
      return {
        device: { ...summary, state: 'offline' },
        state: 'shutdown',
        streaming: false,
      } satisfies AndroidShutdownResult
    },
    presentCall: (args: { device: string }) => ({
      card: 'generic',
      title: `Shut down emulator ${args.device}`,
      kind: 'execute',
    }),
  })

  const androidScreenshot = defineTool({
    name: 'android_screenshot',
    description: 'Capture a PNG of the device screen and return a small JSON summary (path, bytes, size, '
      + 'device). The image itself reaches the UI through the tool card, never as an image block in the '
      + 'result. The returned path is for the USER to look at: do NOT feed it to an image-reading tool '
      + 'unless this model accepts image input — on a text-only model that call always fails. To READ the '
      + 'screen use android_find_text (OCR text + pixel coordinates) or android_ui_tree (uiautomator '
      + 'elements) instead.',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the currently streamed device, else the only online '
          + 'one (with two or more attached, the serial is required).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer' },
          height: { type: 'integer' },
          device: { ...deviceSchema, required: true },
          image: IMAGE_REF_SCHEMA,
        },
      },
      render: renderJsonWithImage,
      presentationMeta: (_args: unknown, value: JsonValue): JsonValue => screenshotMeta(value),
    },
    timeoutMs: 120_000,
    async execute(args: { device?: string }, exec) {
      const { device, summary } = await resolveTarget(host, 'android_screenshot', args.device)
      return captureScreenshot(host, screenshots, 'android_screenshot', device, summary,
        vision === undefined ? undefined : { services: vision, exec })
    },
    presentCall: (args: { device?: string }) => ({
      card: 'generic',
      title: args.device === undefined ? 'Screenshot Android device' : `Screenshot ${args.device}`,
      kind: 'execute',
    }),
  })

  const androidInteract = defineTool({
    name: 'android_interact',
    description: 'Interact with an Android device: tap at normalized 0..1 coordinates of the streamed frame, '
      + 'type text, press a navigation/hardware button (back, home, recents, power, volume_up, volume_down, '
      + 'enter, delete, or a raw KEYCODE_*), send a gesture (a drag: {"fromX":…,"fromY":…,"toX":…,"toY":…,'
      + '"duration":…} in 0..1), or scroll with a direction. ON A REAL PHONE EVERY TAP HAS REAL CONSEQUENCES '
      + '(posts, likes, purchases, messages): NEVER tap an unidentified control to find out what it does — '
      + 'if a control cannot be identified, STOP and report what you see instead of guessing coordinates. '
      + 'Use action "scroll" to scroll; never hand-build a swipe, the tool already clamps the path away from '
      + "Android's gesture-navigation strips, which otherwise swallow it. After the action settles (~300 ms) "
      + 'a fresh screenshot is captured and returned with the same summary shape as android_screenshot. '
      + 'Coordinates are fractions of the LIVE FRAME, which follows the display rotation — no reverse '
      + 'mapping is ever needed.',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      action: {
        type: 'string',
        required: true,
        enum: [...INTERACT_ACTIONS],
        description: 'Interaction to send to the device.',
      },
      x: {
        type: 'number',
        description: 'Tap X, normalized 0..1 (required for "tap"; for "scroll" the anchor the gesture '
          + 'starts from, default 0.5).',
      },
      y: {
        type: 'number',
        description: 'Tap Y, normalized 0..1 (required for "tap"; for "scroll" the anchor the gesture '
          + 'starts from, default 0.5).',
      },
      text: {
        type: 'string',
        description: 'Text to type (required when action is "type"). ASCII goes through `input text`; '
          + 'non-ASCII (Chinese, emoji) needs the ADBKeyboard IME installed and selected on the device, '
          + 'otherwise the call is refused with the install hint rather than typing the wrong characters.',
      },
      name: {
        type: 'string',
        description: 'Button name (required when action is "button"): back, home, recents, power, '
          + 'volume_up, volume_down, menu, enter, delete — or a raw KEYCODE_* name.',
      },
      direction: {
        type: 'string',
        enum: [...SCROLL_DIRECTIONS],
        description: 'Scroll direction (required when action is "scroll"). Named by the CONTENT: "down" '
          + 'reveals content further down the page (the finger moves UP), "up" the opposite; "left"/"right" '
          + 'scroll horizontally the same way.',
      },
      amount: {
        type: 'number',
        description: 'Fraction of the screen the scroll travels, 0..1 (default 0.6). Only used for "scroll".',
      },
      json: {
        type: 'json',
        description: 'Gesture JSON (required when action is "gesture"): a normalized drag, e.g. '
          + '{"fromX":0.1,"fromY":0.5,"toX":0.9,"toY":0.5,"duration":0.3}. Android has one gesture '
          + 'primitive (`input swipe`), so a gesture IS a drag.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: [...INTERACT_ACTIONS] },
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer' },
          height: { type: 'integer' },
          device: { ...deviceSchema, required: true },
          image: IMAGE_REF_SCHEMA,
        },
      },
      render: renderJsonWithImage,
      presentationMeta: (_args: unknown, value: JsonValue): JsonValue => screenshotMeta(value),
    },
    timeoutMs: 180_000,
    async execute(args: AndroidInteractArgs, exec) {
      const { device, summary } = await resolveTarget(host, 'android_interact', args.device)
      try {
        await performInteract(host, device.serial, args)
      } catch (error) {
        const message = errorMessage(error)
        if (message.startsWith('android_interact:')) throw error
        throw new Error(
          `android_interact: ${args.action} on ${device.serial} failed: ${message.replace(/^dsh-android: /, '')}`,
        )
      }
      // The effect screenshot is what makes an interaction observable in one
      // round trip; 300 ms is the settle window dsh-ios measured for the same
      // purpose, and Android's transitions land inside it.
      await sleep(INTERACT_SETTLE_MS)
      const screenshot = await captureScreenshot(host, screenshots, 'android_interact', device, summary,
        vision === undefined ? undefined : { services: vision, exec })
      return { action: args.action, ...screenshot } satisfies AndroidInteractResult
    },
    presentCall: (args: AndroidInteractArgs) => ({
      card: 'generic',
      title: `${args.action} on Android device`,
      kind: 'execute',
      rawInput: args.action === 'tap'
        ? { x: args.x, y: args.y }
        : args.action === 'type'
          ? { text: args.text }
          : args.action === 'button'
            ? { name: args.name }
            : args.action === 'scroll'
              ? { direction: args.direction, amount: args.amount }
              : { gesture: args.json },
    }),
  })

  const appTools = createAndroidAppTools(host)
  return {
    androidDevices,
    androidBoot,
    androidShutdown,
    androidScreenshot,
    androidInteract,
    ...appTools,
  }
}

/**
 * The `device` argument of android_boot was not an online serial: it must name
 * an AVD, or the caller gets told exactly what IS available. Booting is
 * deliberately the ONLY place an emulator is launched — the panel's
 * switch-device route refuses offline targets rather than starting one, since
 * an Android cold boot takes minutes and has no serial until it appears.
 */
async function bootReferencedAvd(
  host: AndroidHostController,
  reference: string,
  listed: readonly AndroidDevice[],
): Promise<AndroidDevice> {
  const known = listed.find(device => device.serial === reference)
  const avds = await listAvds().catch(() => [] as string[])
  if (!avds.includes(reference)) {
    if (known !== undefined) {
      throw new Error(
        `android_boot: device ${reference} is ${known.state}, not ready to stream`
        + (known.state === 'unauthorized'
          ? ' — accept the USB debugging prompt on the device, then retry'
          : ' — wait for it to finish booting, then retry'),
      )
    }
    throw new Error(
      `android_boot: "${reference}" is neither an online adb serial nor a known AVD name — run `
      + 'android_devices and pass a serial from `devices` or a name from `avds` '
      + `(serials seen: ${listed.length === 0 ? 'none' : listed.map(device => device.serial).join(', ')}; `
      + `AVDs: ${avds.length === 0 ? 'none discovered' : avds.join(', ')})`,
    )
  }
  let launched: { serial: string }
  try {
    launched = await bootAvd(host.toolchain, reference)
  } catch (error) {
    throw new Error(
      `android_boot: booting the AVD "${reference}" failed: ${errorMessage(error).replace(/^dsh-android: /, '')}`,
    )
  }
  const refreshed = await host.toolchain.onlineDevices()
  const target = refreshed.find(device => device.serial === launched.serial)
  if (target === undefined) {
    throw new Error(
      `android_boot: the AVD "${reference}" booted as ${launched.serial} but adb no longer lists it as `
      + 'online — run android_devices and retry',
    )
  }
  return target
}
