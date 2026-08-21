/**
 * Development smoke test for the dsh-android device panel + conversation cards.
 *
 * Run after `pnpm run build:client`:
 *   node scripts/dev-panel-smoke.mjs
 *
 * Static (SSR) only — no browser, no network, no devices. Loads the BUILT
 * browser bundle (lib/client.js) in Node through the `window.__ModuleLoader__`
 * shim (see scripts/_smoke-harness.mjs) and `react-dom/server` renders the
 * components, so every assertion is made against the exact bytes the plugin
 * ships. A `throwingFetcher` is passed everywhere a component could fetch, so
 * any network access DURING RENDER fails the suite loudly.
 *
 * Coverage:
 * - cards: compact one-line summaries with NO imagery, zh/en copy, data-*
 *   anchors (`data-android-card-kind`, `data-state`, `data-android-card-action`);
 * - meta hydrate: the three kinds and their gates (boot state/streaming,
 *   screenshot absolute path + byte count, build_run launched + packageName);
 * - protocol: request bodies, the defensive parsers, `postJson` never throwing,
 *   the code→copy mapping for EVERY AndroidRouteErrorCode, and the coalesced
 *   pointer gesture (tap slop, drag duration clamp);
 * - panel SSR: stream + screenshot modes, the Android nav triad in the
 *   toolbar, the live frame's `data-android-live-frame` anchor and the pointer
 *   box's aspect (a landscape 2400×1080 frame stays 2400/1080 — no rotation
 *   math exists in this client);
 * - pure geometry: size modes, the derived device scale, frame-style radii;
 * - pure state machines: auto-open, auto-follow, panel width + landscape
 *   auto-widen, the capture controller (fake timers) and the status poller.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStepReporter, loadClientExports } from './_smoke-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require2 = createRequire(import.meta.url)
// The shared DSH profile can expose several React generations. Resolve React
// from the same package neighborhood as react-dom/server so SSR never mixes
// element symbols from one version with a renderer from another.
const reactDomServerPath = require2.resolve('react-dom/server')
const reactRuntimeRequire = createRequire(reactDomServerPath)
const React = reactRuntimeRequire('react')
const { renderToString } = reactRuntimeRequire('react-dom/server')

const { step, finish } = createStepReporter()

const client = loadClientExports(
  readFileSync(join(root, 'lib', 'client.js'), 'utf8'),
  '@zseven-w/dsh-android',
  specifier => reactRuntimeRequire(specifier),
)

const CALL_ID = 'call-android-panel-smoke'

function settledBlock(toolName, meta, options = {}) {
  return {
    kind: 'tool-result',
    seq: 1,
    time: options.time ?? Date.now(),
    callId: options.callId ?? CALL_ID,
    call: { name: toolName, argsRaw: '{}' },
    callTime: Date.now(),
    content: options.content ?? [],
    isError: options.isError ?? false,
    callView: null,
    resultView: null,
    subCalls: [],
    meta: options.meta !== undefined ? options.meta : meta,
  }
}

function jsonBlock(toolName, value, options = {}) {
  return settledBlock(toolName, undefined, {
    ...options,
    meta: undefined,
    content: [{ type: 'text', text: JSON.stringify(value) }],
  })
}

/** Fails the SSR test loudly if any component tries to fetch during render. */
function throwingFetcher() {
  throw new Error('a component attempted a network request during server rendering')
}

/** A fetcher over a plain handler: `(path, parsedBody) => {status?, body}`. */
function jsonFetcher(handler) {
  return async (path, init) => {
    const parsed = init?.body === undefined ? undefined : JSON.parse(init.body)
    const result = await handler(path, parsed, init)
    const status = result.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
    }
  }
}

const BOOT_META = {
  kind: 'android-stream',
  device: { serial: 'emulator-5554', name: 'sdk_gphone64_arm64', androidVersion: '14', state: 'device' },
  streamRouteId: 'dsh-android/stream/emulator-5554',
}
const SCREENSHOT_META = {
  kind: 'android-screenshot',
  screenshotPath: '/tmp/dsh-android/screenshots/screenshot-emulator_5554-0.png',
  path: '/tmp/dsh-android/screenshots/screenshot-emulator_5554-0.png',
  device: { serial: 'emulator-5554', name: 'sdk_gphone64_arm64', state: 'device' },
}
const BUILD_META = {
  kind: 'android-build-run',
  device: { serial: 'emulator-5554', name: 'sdk_gphone64_arm64', state: 'device' },
  packageName: 'com.example.app',
  apkPath: '/tmp/app/build/outputs/apk/debug/app-debug.apk',
}

const render = (component, props) => renderToString(React.createElement(component, props))

const cardProps = (toolName, block, extra = {}) => ({
  callId: CALL_ID,
  toolName,
  block,
  sessionId: 'session-1',
  openFile: () => {},
  fetcher: throwingFetcher,
  locale: 'en',
  colorScheme: 'dark',
  ...extra,
})

try {
  step('client bundle loads through the module-loader shim', true, 'lib/client.js evaluated in Node')

  // ═══════════════════════════════════════════════════════════════════════════
  // Shared stream engine
  // ═══════════════════════════════════════════════════════════════════════════
  step(
    'one shared stream engine (AndroidLiveFrame.sharedStreamHook === useAndroidStream)',
    typeof client.useAndroidStream === 'function'
      && client.AndroidLiveFrame.sharedStreamHook === client.useAndroidStream,
    'panel + frame share one module object',
  )
  step(
    'no WebSocket surface is exported (control is REST only)',
    Object.keys(client).every(key => !/websocket|wsurl|wsfactory/i.test(key))
      && client.CONTROL_ROUTE_PATH === '/_dsh/dsh-android/control',
    'POST /control is the only control channel',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Conversation cards — compact, no imagery
  // ═══════════════════════════════════════════════════════════════════════════
  const bootCard = render(client.AndroidStreamCard, cardProps('android_boot', settledBlock('android_boot', BOOT_META)))
  step(
    'boot card renders the compact summary with NO imagery',
    bootCard.includes('data-android-card-kind="compact"')
      && bootCard.includes('data-state="live"')
      && bootCard.includes('data-android-card-action="boot"')
      && bootCard.includes('sdk_gphone64_arm64')
      && bootCard.includes('Open in sidebar')
      && !bootCard.includes('<img')
      && !bootCard.includes('data-android-live-frame'),
    'AndroidStreamCard is panel-only chrome',
  )
  const bootRunning = render(client.AndroidStreamCard, cardProps('android_boot', { name: 'android_boot', argsRaw: '{}' }))
  step(
    'running boot card shows the starting state and is not openable',
    bootRunning.includes('data-state="running"') && !bootRunning.includes('Open in sidebar'),
    'running calls never register a panel source',
  )
  const shotCardZh = render(
    client.AndroidScreenshotCard,
    cardProps('android_screenshot', settledBlock('android_screenshot', SCREENSHOT_META, {
      content: [{ type: 'text', text: JSON.stringify({ path: SCREENSHOT_META.path, bytes: 20480, width: 1080, height: 2400 }) }],
    }), { locale: 'zh' }),
  )
  step(
    'screenshot card renders zh copy + caption + open link, no <img>',
    shotCardZh.includes('data-android-card-action="screenshot"')
      && shotCardZh.includes('20.0 KB')
      && shotCardZh.includes('1080×2400')
      && shotCardZh.includes('打开截图')
      && shotCardZh.includes('在侧边栏打开')
      && !shotCardZh.includes('<img'),
    'zh table drives every string',
  )
  const interactCard = render(
    client.AndroidScreenshotCard,
    cardProps('android_interact', settledBlock('android_interact', SCREENSHOT_META)),
  )
  step(
    'interact reuses the screenshot card with its own action sub-label',
    interactCard.includes('data-android-card-action="interact"') && interactCard.includes('Interact'),
    'one card, two tools',
  )
  const buildCard = render(client.AndroidBuildRunCard, cardProps('android_build_run', settledBlock('android_build_run', BUILD_META)))
  step(
    'build-run card shows the package name and the open-APK link',
    buildCard.includes('data-android-card-action="build-run"')
      && buildCard.includes('com.example.app')
      && buildCard.includes('Open APK')
      && !buildCard.includes('<img'),
    'no imagery in the conversation stream',
  )
  const errorCard = render(
    client.AndroidStreamCard,
    cardProps('android_boot', settledBlock('android_boot', undefined, { isError: true, content: [{ type: 'text', text: 'adb: device offline' }] })),
  )
  step(
    'an error result renders the defensive card, never a preview',
    errorCard.includes('data-state="error"') && errorCard.includes('adb: device offline'),
    'errors keep the plain card',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Meta hydration (nested Code Mode results carry no presentationMeta)
  // ═══════════════════════════════════════════════════════════════════════════
  const hydratedBoot = client.hydrateAndroidMeta('android_boot', jsonBlock('android_boot', {
    state: 'booted',
    streaming: true,
    device: { serial: 'emulator-5554', name: 'sdk_gphone64_arm64', androidVersion: '14', state: 'device' },
  }))
  step(
    'android_boot hydrates the android-stream envelope (state booted + streaming)',
    hydratedBoot?.kind === 'android-stream'
      && hydratedBoot.device.serial === 'emulator-5554'
      && hydratedBoot.streamRouteId === 'dsh-android/stream/emulator-5554',
    'streamRouteId derives from the serial',
  )
  // The live server reports state:'streaming' (adopt-an-online-serial path);
  // the hydrate gate must accept it — this exact shape failed the first
  // integration run against a real emulator.
  const hydratedStreaming = client.hydrateAndroidMeta('android_boot', jsonBlock('android_boot', {
    state: 'streaming',
    streaming: true,
    booted: false,
    device: { serial: 'emulator-5554', name: 'sdk_gphone64_arm64', androidVersion: '14', state: 'device' },
  }))
  step(
    "android_boot hydrates the server's real state:'streaming' shape",
    hydratedStreaming?.kind === 'android-stream'
      && hydratedStreaming.streamRouteId === 'dsh-android/stream/emulator-5554',
    'adopt-an-online-serial results must hydrate too',
  )
  step(
    'a boot result that is not streaming never hydrates',
    client.hydrateAndroidMeta('android_boot', jsonBlock('android_boot', { state: 'booted', streaming: false, device: { serial: 'x' } })) === null
      && client.hydrateAndroidMeta('android_boot', jsonBlock('android_boot', { state: 'offline', streaming: true, device: { serial: 'x' } })) === null,
    'both gates are enforced',
  )
  const hydratedShot = client.hydrateAndroidMeta('android_screenshot', jsonBlock('android_screenshot', {
    path: '/tmp/dsh-android/screenshots/screenshot-emulator_5554-3.png',
    bytes: 0,
    device: { serial: 'emulator-5554' },
  }))
  step(
    'android_screenshot hydrates on an absolute path + bytes >= 0',
    hydratedShot?.kind === 'android-screenshot' && hydratedShot.screenshotPath === hydratedShot.path,
    'path and screenshotPath stay duplicated like the host projects them',
  )
  step(
    'a relative path or a missing byte count never hydrates',
    client.hydrateAndroidMeta('android_screenshot', jsonBlock('android_screenshot', { path: 'rel.png', bytes: 1, device: { serial: 'x' } })) === null
      && client.hydrateAndroidMeta('android_screenshot', jsonBlock('android_screenshot', { path: '/a.png', device: { serial: 'x' } })) === null,
    'defensive gates hold',
  )
  step(
    'android_interact hydrates only for a known action',
    client.hydrateAndroidMeta('android_interact', jsonBlock('android_interact', { action: 'tap', path: '/a.png', bytes: 5, device: { serial: 'x' } }))?.kind === 'android-screenshot'
      && client.hydrateAndroidMeta('android_interact', jsonBlock('android_interact', { action: 'nope', path: '/a.png', bytes: 5, device: { serial: 'x' } })) === null,
    'the action set distinguishes interact results',
  )
  const hydratedBuild = client.hydrateAndroidMeta('android_build_run', jsonBlock('android_build_run', {
    state: 'launched',
    packageName: 'com.example.app',
    apkPath: '/tmp/app-debug.apk',
    device: { serial: 'emulator-5554' },
  }))
  step(
    'android_build_run hydrates on state launched + packageName',
    hydratedBuild?.kind === 'android-build-run' && hydratedBuild.packageName === 'com.example.app'
      && client.hydrateAndroidMeta('android_build_run', jsonBlock('android_build_run', { state: 'installed', packageName: 'x', device: { serial: 'y' } })) === null,
    'a non-launched build never opens the panel',
  )
  step(
    'projected presentationMeta always wins over hydration',
    client.resolveAndroidMeta('android_boot', settledBlock('android_boot', BOOT_META))?.source === 'meta'
      && client.resolveAndroidMeta('android_boot', jsonBlock('android_boot', { state: 'booted', streaming: true, device: { serial: 's' } }))?.source === 'hydrated',
    'standard-mode sessions are untouched',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Protocol: bodies, parsers, error codes, gestures
  // ═══════════════════════════════════════════════════════════════════════════
  step(
    'grant bodies carry no wsUrl concept and use the android kinds',
    JSON.stringify(client.streamGrantBodyOf({ device: { serial: 'emulator-5554' } })) === '{"kind":"stream","device":"emulator-5554"}'
      && JSON.stringify(client.streamGrantBodyOf({})) === '{"kind":"stream"}'
      && JSON.stringify(client.screenshotGrantBodyOf('/a.png')) === '{"kind":"screenshot","path":"/a.png"}',
    'matches src/stream-routes.ts handleGrant',
  )
  step(
    'control bodies match the route contract',
    JSON.stringify(client.controlBodyOf('emulator-5554', { kind: 'button', name: 'back' }))
      === '{"device":"emulator-5554","action":{"kind":"button","name":"back"}}'
      && JSON.stringify(client.switchDeviceBodyOf('emulator-5554')) === '{"device":"emulator-5554"}',
    '{device, action} with a normalized action',
  )
  const tapAction = client.androidGestureActionOf({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }, 120)
  const dragAction = client.androidGestureActionOf({ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }, 640)
  const slowDrag = client.androidGestureActionOf({ x: 0, y: 0 }, { x: 1, y: 1 }, 9000)
  const fastDrag = client.androidGestureActionOf({ x: 0, y: 0 }, { x: 1, y: 1 }, 10)
  step(
    'one gesture → one control action (tap slop 0.02, drag clamp 0.05–2s)',
    tapAction.kind === 'tap' && tapAction.x === 0.505
      && dragAction.kind === 'drag' && dragAction.durationMs === 640
      && slowDrag.durationMs === client.ANDROID_DRAG_DURATION_MAX_S * 1000
      && fastDrag.durationMs === client.ANDROID_DRAG_DURATION_MIN_S * 1000
      && client.ANDROID_TAP_SLOP === 0.02
      && client.ANDROID_DRAG_MOVE_SAMPLE_MS === 50,
    'coalescing matches `input swipe` semantics',
  )
  step(
    'pointer normalization is a pure display-box mapping (no rotation)',
    JSON.stringify(client.normalizePointerPoint({ clientX: 60, clientY: 120 }, { left: 10, top: 20, width: 100, height: 200 }))
      === '{"x":0.5,"y":0.5}',
    'the frame follows the display rotation, so coordinates pass straight through',
  )

  const ERROR_CODES = [
    'forbidden', 'bad_method', 'bad_content_type', 'bad_request', 'device_unknown',
    'device_offline', 'device_unauthorized', 'device_busy', 'stream_not_running',
    'stream_failed', 'token_invalid', 'screenshot_missing', 'adb_unavailable', 'unavailable',
  ]
  const en = client.androidCopy('en')
  const zh = client.androidCopy('zh')
  const unmappedCodes = ERROR_CODES.filter(code => {
    const text = client.androidRouteErrorTextOf({ error: 'RAW', code }, en)
    return text === 'RAW' || text === undefined || text === ''
  })
  step(
    'every AndroidRouteErrorCode maps to a localized copy key',
    unmappedCodes.length === 0,
    unmappedCodes.length === 0 ? `${ERROR_CODES.length} codes mapped` : `unmapped: ${unmappedCodes.join(', ')}`,
  )
  step(
    'an unknown code falls back to the host English detail',
    client.androidRouteErrorTextOf({ error: 'host detail', code: 'brand_new' }, en) === 'host detail'
      && client.androidRouteErrorTextOf({ error: 'host detail' }, en) === 'host detail',
    'older/newer hosts degrade gracefully',
  )
  step(
    'device_unauthorized copy is actionable in both locales',
    /USB debugging/i.test(en.errDeviceUnauthorized) && zh.errDeviceUnauthorized.includes('USB 调试'),
    'the user is told what to do on the phone',
  )
  const enKeys = Object.keys(en).sort()
  const zhKeys = Object.keys(zh).sort()
  step(
    'the zh table covers exactly the en key set',
    JSON.stringify(enKeys) === JSON.stringify(zhKeys),
    `${enKeys.length} keys`,
  )

  // Defensive parsers over mocked transports.
  const failing = await client.requestStreamGrant(async () => { throw new Error('boom') }, {})
  step(
    'postJson never throws — a transport failure resolves as a failure value',
    failing.ok === false && failing.error.includes('boom'),
    'no unhandled rejection ever reaches the conversation',
  )
  const coded = await client.requestStreamGrant(
    jsonFetcher(() => ({ status: 409, body: { ok: false, code: 'device_busy', error: 'another device is streaming' } })),
    { device: { serial: 'emulator-5554' } },
  )
  step(
    'a coded route failure is parsed into {code, error}',
    coded.ok === false && coded.code === 'device_busy' && coded.status === 409,
    'the panel localizes off the code',
  )
  const granted = await client.requestStreamGrant(
    jsonFetcher(() => ({ body: { ok: true, streamUrl: '/_dsh/dsh-android/stream/tok', expiresAt: 42, device: 'emulator-5554' } })),
    {},
  )
  step(
    'a stream grant parses without requiring any ws field',
    granted.ok === true && granted.grant.streamUrl === '/_dsh/dsh-android/stream/tok' && granted.grant.device === 'emulator-5554',
    'no wsUrl in the contract',
  )
  const status = await client.requestAndroidStatus(
    jsonFetcher(() => ({ body: { ok: true, running: true, serial: 'emulator-5554', deviceName: 'Pixel' } })),
  )
  step(
    'the status snapshot reads the host field name `serial`',
    status.running === true && status.serial === 'emulator-5554' && status.deviceName === 'Pixel',
    'matches handleStatus',
  )
  const listing = await client.requestAndroidDevices(jsonFetcher(() => ({
    body: {
      ok: true,
      devices: [
        { serial: 'emulator-5554', state: 'device', kind: 'emulator', model: 'sdk_gphone64_arm64', streaming: true },
        { serial: 'R5CT1234', state: 'unauthorized', kind: 'physical', model: 'SM-G991B' },
        { bogus: true },
      ],
      avds: ['Pixel_7_API_34', 42],
    },
  })))
  step(
    'the device listing is ONE array + the AVD names, malformed rows dropped',
    listing.devices.length === 2
      && listing.devices[0].streaming === true
      && listing.devices[1].kind === 'physical'
      && JSON.stringify(listing.avds) === '["Pixel_7_API_34"]',
    'no dual-array split like dsh-ios',
  )
  const badListing = await client.requestAndroidDevices(async () => { throw new Error('down') })
  step(
    'a failed listing degrades to empty arrays instead of throwing',
    badListing.devices.length === 0 && badListing.avds.length === 0,
    'the picker retries on the next open',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Panel SSR
  // ═══════════════════════════════════════════════════════════════════════════
  const panelProps = {
    toolName: 'android_boot',
    block: settledBlock('android_boot', BOOT_META),
    sessionId: 'session-1',
    fetcher: throwingFetcher,
    colorScheme: 'dark',
    locale: 'en',
    onClose: () => {},
  }
  const streamPanel = render(client.AndroidPanel, panelProps)
  step(
    'connected stream panel server-renders the granting phase with zero network',
    streamPanel.includes('data-android-panel="true"')
      && streamPanel.includes('data-android-mode="stream"')
      && streamPanel.includes('data-android-frame-state="granting"')
      && streamPanel.includes('data-android-live-indicator="offline"')
      && !streamPanel.includes('<img'),
    'effects (and therefore the grant) never run during SSR',
  )
  step(
    'the toolbar carries the Android nav triad as three PEER buttons',
    streamPanel.includes('data-android-toolbar-action="back"')
      && streamPanel.includes('data-android-toolbar-action="home"')
      && streamPanel.includes('data-android-toolbar-action="recents"')
      && streamPanel.includes('data-android-toolbar-action="rotate"')
      && streamPanel.includes('data-android-toolbar-action="refresh"')
      && !streamPanel.includes('onDoubleClick')
      && !/double/i.test(streamPanel),
    '◁ ○ □ with no double-click semantics',
  )
  step(
    'the header hosts the device picker + auto-follow pill',
    streamPanel.includes('data-android-device-picker="true"')
      && streamPanel.includes('data-android-follow-indicator="true"')
      && streamPanel.includes('data-android-follow-state="active"')
      && streamPanel.includes('data-android-panel-size-mode="true"')
      && streamPanel.includes('data-android-frame-style-control="true"'),
    'picker, follow, size and frame controls all present',
  )
  const screenshotPanel = render(client.AndroidPanel, {
    ...panelProps,
    toolName: 'android_screenshot',
    block: settledBlock('android_screenshot', SCREENSHOT_META),
  })
  step(
    'screenshot-mode panel hides the live/offline readout',
    screenshotPanel.includes('data-android-mode="screenshot"')
      && screenshotPanel.includes('data-android-screenshot-frame="panel"')
      && !screenshotPanel.includes('data-android-live-indicator'),
    'the Live dot only makes sense for a stream',
  )
  const unavailablePanel = render(client.AndroidPanel, {
    ...panelProps,
    block: settledBlock('android_boot', undefined, { meta: { kind: 'nonsense' } }),
  })
  step(
    'a meta-less panel falls back to the no-preview surface',
    unavailablePanel.includes('data-android-mode="unavailable"')
      && !unavailablePanel.includes('data-android-device-picker="true"'),
    'unknown meta never throws',
  )

  // Live phase: the pure body over an explicit session snapshot.
  const fakeSession = {
    phase: 'live',
    streamUrl: '/_dsh/dsh-android/stream/token-abc',
    failure: '',
    imgRef: { current: null },
    refresh: () => {},
    retryOnce: () => {},
    onFrameLoad: () => {},
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
  }
  const landscapeFrame = render(client.AndroidLiveFrameBody, {
    meta: BOOT_META,
    locale: 'zh',
    session: fakeSession,
    naturalWidth: 2400,
    naturalHeight: 1080,
  })
  step(
    'a LANDSCAPE frame keeps its own aspect — no counter-rotation anywhere',
    landscapeFrame.includes('data-android-live-frame="panel"')
      && landscapeFrame.includes('data-android-frame-state="live"')
      && landscapeFrame.includes('data-android-display-width="2400"')
      && landscapeFrame.includes('data-android-display-height="1080"')
      && landscapeFrame.includes('aspect-ratio:2400 / 1080')
      && !/rotate\(/.test(landscapeFrame)
      && landscapeFrame.includes('/_dsh/dsh-android/stream/token-abc'),
    'the 2400×1080 frame the emulator actually streams renders as-is',
  )
  const fallbackFrame = render(client.AndroidLiveFrameBody, {
    meta: BOOT_META,
    locale: 'zh',
    session: { ...fakeSession, phase: 'fallback', streamUrl: undefined, failure: zh.errDeviceUnauthorized },
  })
  step(
    'the fallback phase shows the localized reason plus a retry affordance',
    fallbackFrame.includes('data-android-frame-state="fallback"')
      && fallbackFrame.includes(zh.errDeviceUnauthorized)
      && fallbackFrame.includes('重试')
      && !fallbackFrame.includes('<img'),
    'coded failures reach the user in their language',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Pure geometry: size modes + frame styles
  // ═══════════════════════════════════════════════════════════════════════════
  step(
    'the device scale is DERIVED from the frame short side (fallback 2.625)',
    client.androidDeviceScaleOf(undefined, undefined) === client.ANDROID_PANEL_DEVICE_SCALE_FALLBACK
      && Math.abs(client.androidDeviceScaleOf(1080, 2400) - 1080 / 412) < 1e-9
      && Math.abs(client.androidDeviceScaleOf(2400, 1080) - 1080 / 412) < 1e-9,
    'a landscape frame reports the same density as portrait',
  )
  const portraitLogical = client.androidPanelDisplayLogicalWidthOf(1080, 2400)
  const landscapeLogical = client.androidPanelDisplayLogicalWidthOf(2400, 1080)
  step(
    // The derived density (short side / 412) is an approximation of the real
    // 2.625, so the landscape dp width lands within a dp of the true 915.
    'the percent basis follows the DISPLAYED width (dp)',
    Math.round(portraitLogical) === 412 && Math.abs(landscapeLogical - 915) < 2,
    `portrait ${Math.round(portraitLogical)}dp · landscape ${landscapeLogical.toFixed(1)}dp`,
  )
  step(
    'fit / percent / preset widths',
    client.androidPanelFrameWidthOf({ kind: 'fit' }, 1080, 2400) === '100%'
      && client.androidPanelFrameWidthOf({ kind: 'percent', value: 100 }, 1080, 2400) === '412px'
      && client.androidPanelFrameWidthOf({ kind: 'percent', value: 50 }, 1080, 2400) === '206px'
      && client.androidPanelFrameWidthOf({ kind: 'preset', width: 240 }, 1080, 2400) === '240px',
    'portrait presets are the raw short-side px',
  )
  const landscapePreset = client.androidPanelFrameWidthOf({ kind: 'preset', width: 240 }, 2400, 1080)
  step(
    'a landscape preset scales by the displayed aspect (short-side semantics)',
    landscapePreset === `${Math.round(240 * 2400 / 1080)}px`,
    `landscape S = ${landscapePreset}`,
  )
  step(
    'the Android corner ratio is 30/412 and shells stay concentric',
    Math.abs(client.ANDROID_FRAME_SCREEN_RADIUS_RATIO - 30 / 412) < 1e-12
      && client.androidPanelScreenRadiusOf(412, 915) === 30
      && client.androidPanelScreenRadiusOf(240, 520) === 17.5
      && client.androidPanelShellRadiusOf('bezel', 30) === 36
      && client.androidPanelShellRadiusOf('device', 30) === 46
      && client.androidPanelShellRadiusOf('none', 30) === 30,
    'flatter than the iOS 55/390 corner, by design',
  )
  step(
    'the screen box subtracts padding AND border per side (even rims)',
    client.androidPanelFrameInsetOf('none') === 0
      && client.androidPanelFrameInsetOf('bezel') === 7
      && client.androidPanelFrameInsetOf('device') === 17
      && client.androidPanelScreenWidthOf(300.4, 'bezel') === 300 - 14,
    'the WP27 rim-symmetry derivation is shared by every path',
  )
  step(
    'the three frame styles are none / bezel(default) / device 手机框',
    JSON.stringify(client.ANDROID_FRAME_STYLE_OPTIONS) === '["none","bezel","device"]'
      && client.ANDROID_FRAME_STYLE_BEZEL === 'bezel'
      && client.androidFrameStyleOf('nope') === 'bezel'
      && client.androidFrameStyleLabelOf('device', zh) === '手机框'
      && client.androidFrameStyleLabelOf('device', en) === 'Phone frame',
    'zh label reads 手机框, not 真机框',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-open (android_boot only)
  // ═══════════════════════════════════════════════════════════════════════════
  step(
    'only android_boot is an auto-open verb',
    JSON.stringify(client.ANDROID_PANEL_AUTO_OPEN_TOOLS) === '["android_boot"]',
    'no real-start counterpart exists on Android',
  )
  const openInput = {
    toolName: 'android_boot',
    isError: false,
    blockTime: client.androidPanelAutoOpenActivatedAt + 10,
    sessionId: 'session-1',
    activatedAt: client.androidPanelAutoOpenActivatedAt,
    currentSessionId: 'session-1',
  }
  step(
    'auto-open guards: verb, error, session match, activation timestamp',
    client.androidPanelAutoOpenShouldOpen(openInput) === true
      && client.androidPanelAutoOpenShouldOpen({ ...openInput, isError: true }) === false
      && client.androidPanelAutoOpenShouldOpen({ ...openInput, toolName: 'android_screenshot' }) === false
      && client.androidPanelAutoOpenShouldOpen({ ...openInput, currentSessionId: 'other' }) === false
      && client.androidPanelAutoOpenShouldOpen({ ...openInput, blockTime: client.androidPanelAutoOpenActivatedAt - 1 }) === false,
    'a history replay never reopens the panel',
  )
  const openKey = client.androidPanelAutoOpenKey('session-1', CALL_ID)
  client.rememberAndroidPanelAutoOpenCall(openKey)
  step(
    'the one-shot registry yields exactly once',
    client.takeAndroidPanelAutoOpenCall(openKey) === true
      && client.takeAndroidPanelAutoOpenCall(openKey) === false,
    'a re-render never reopens a closed panel',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-follow state machine
  // ═══════════════════════════════════════════════════════════════════════════
  const DEBOUNCE = client.ANDROID_PANEL_FOLLOW_DEBOUNCE_MS
  let follow = client.androidFollowStateInitial('emulator-5554')
  follow = client.androidFollowStateNext(follow, { kind: 'result', serial: 'R5CT1234', version: 10, now: 1000 })
  const beforeDeadline = client.androidFollowStateNext(follow, { kind: 'tick', now: 1000 + DEBOUNCE - 1 })
  const afterDeadline = client.androidFollowStateNext(follow, { kind: 'tick', now: 1000 + DEBOUNCE })
  step(
    'a differing newest target re-targets only after the debounce window',
    beforeDeadline.decisions.length === 0
      && afterDeadline.decisions.length === 1
      && afterDeadline.decisions[0].serial === 'R5CT1234',
    `${DEBOUNCE}ms window`,
  )
  let pingpong = client.androidFollowStateInitial('emulator-5554')
  pingpong = client.androidFollowStateNext(pingpong, { kind: 'result', serial: 'R5CT1234', version: 10, now: 0 })
  pingpong = client.androidFollowStateNext(pingpong, { kind: 'result', serial: 'R5CT9999', version: 20, now: 900 })
  pingpong = client.androidFollowStateNext(pingpong, { kind: 'tick', now: 900 + DEBOUNCE })
  step(
    'alternating results re-arm the window and settle on exactly one target',
    pingpong.decisions.length === 1 && pingpong.decisions[0].serial === 'R5CT9999',
    'no ping-pong between two devices',
  )
  let overridden = client.androidFollowStateNext(follow, { kind: 'manual-pick', serial: 'emulator-5556' })
  overridden = client.androidFollowStateNext(overridden, { kind: 'result', serial: 'R5CT1234', version: 30, now: 5000 })
  overridden = client.androidFollowStateNext(overridden, { kind: 'tick', now: 99999 })
  const resumed = client.androidFollowStateNext(overridden, { kind: 'resume-follow' })
  step(
    'a manual pick stands auto-follow down until 恢复跟随 is clicked',
    overridden.userOverrode === true
      && overridden.decisions.length === 0
      && overridden.currentSerial === 'emulator-5556'
      && resumed.userOverrode === false,
    'the user always wins',
  )
  let inflight = client.androidFollowStateNext(follow, { kind: 'switch-start' })
  const noDecisionWhileSwitching = client.androidFollowStateNext(inflight, { kind: 'tick', now: 99999 })
  const releasedOnSettle = client.androidFollowStateNext(inflight, { kind: 'switch-settled', serial: 'x', now: 99999 })
  step(
    'no decision fires while a switch is in flight; the settle releases an aged target',
    noDecisionWhileSwitching.decisions.length === 0 && releasedOnSettle.decisions.length === 1,
    'switches never overlap',
  )
  const onlineListing = {
    devices: [
      { serial: 'emulator-5554', state: 'device', kind: 'emulator' },
      { serial: 'R5CT1234', state: 'unauthorized', kind: 'physical' },
    ],
    avds: [],
  }
  step(
    'only an ONLINE serial is a followable target',
    client.androidFollowTargetOf('emulator-5554', onlineListing)?.serial === 'emulator-5554'
      && client.androidFollowTargetOf('R5CT1234', onlineListing) === undefined
      && client.androidFollowTargetOf('nope', onlineListing) === undefined,
    'the panel never yanks the view for a dead device',
  )
  const followSources = [
    { sessionId: 'session-1', callId: 'a', toolName: 'android_screenshot', block: settledBlock('android_screenshot', SCREENSHOT_META, { time: 100 }) },
    { sessionId: 'session-2', callId: 'b', toolName: 'android_boot', block: settledBlock('android_boot', { ...BOOT_META, device: { serial: 'OTHER' } }, { time: 900 }) },
  ]
  step(
    'the candidate scan ignores other sessions',
    client.androidFollowNewestCandidateOf(followSources, 'session-1')?.serial === 'emulator-5554'
      && client.androidFollowNewestCandidateOf(followSources, 'session-3') === undefined,
    'session-scoped follow',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Panel width + landscape auto-widen
  // ═══════════════════════════════════════════════════════════════════════════
  let widthState = client.androidPanelWidthStateInitial(380)
  widthState = client.androidPanelWidthStateNext(widthState, { kind: 'display', naturalWidth: 1080, naturalHeight: 2400 })
  const portraitWidth = client.androidPanelEffectiveWidth(widthState, 1600)
  widthState = client.androidPanelWidthStateNext(widthState, { kind: 'display', naturalWidth: 2400, naturalHeight: 1080 })
  const landscapeWidth = client.androidPanelEffectiveWidth(widthState, 1600)
  const overrode = client.androidPanelWidthStateNext(widthState, { kind: 'manual-width', width: 420 })
  const back = client.androidPanelWidthStateNext(overrode, { kind: 'display', naturalWidth: 1080, naturalHeight: 2400 })
  step(
    'a landscape frame auto-widens the panel; a manual drag wins; portrait restores',
    client.androidPanelDisplayIsLandscape(2400, 1080) === true
      && client.androidPanelDisplayIsLandscape(1080, 2400) === false
      && portraitWidth === 380
      && landscapeWidth > portraitWidth
      && overrode.userOverrode === true
      && client.androidPanelEffectiveWidth(overrode, 1600) === 420
      && back.preferred === 380,
    `portrait ${portraitWidth}px → landscape ${landscapeWidth}px`,
  )
  step(
    'width clamping honours the conversation clearance',
    client.clampAndroidPanelWidth(5000, 1600) === client.androidPanelWidthBounds(1600).max
      && client.clampAndroidPanelWidth(10, 1600) === client.androidPanelWidthBounds(1600).min
      && client.resizedAndroidPanelWidth(380, 900, 800, 1600) === 480,
    'a left-edge drag grows the panel',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Device picker: kind groups + AVD hint + switch controller
  // ═══════════════════════════════════════════════════════════════════════════
  const pickerHtml = render(client.AndroidDevicePickerBody, {
    devices: listing.devices,
    avds: ['Pixel_7_API_34'],
    currentDevice: { serial: 'emulator-5554', name: 'sdk_gphone64_arm64' },
    switching: false,
    error: '',
    locale: 'zh',
    onSelect: () => {},
  })
  step(
    'the picker trigger names the current device (no fetch during render)',
    pickerHtml.includes('data-android-device-picker="true"')
      && pickerHtml.includes('data-android-device-current="emulator-5554"')
      && pickerHtml.includes('sdk_gphone64_arm64'),
    'listing is fetched on open only',
  )
  const pickerGroups = client.androidDeviceSelectGroupsOf(listing.devices, ['Pixel_7_API_34'], { serial: 'emulator-5554' }, 'zh')
  const menuHtml = render(client.AndroidSelectMenu, {
    groups: pickerGroups,
    value: 'emulator-5554',
    onPick: () => {},
    ariaLabel: zh.devicePicker,
  })
  step(
    'devices group by kind with their glyphs; the streamed one is marked ●',
    menuHtml.includes('data-android-device-kind-group="emulator"')
      && menuHtml.includes('data-android-device-kind-group="physical"')
      && menuHtml.includes('data-android-device-kind-icon="emulator"')
      && menuHtml.includes('data-android-device-kind-icon="physical"')
      && menuHtml.includes('data-android-select-marker="active"')
      && menuHtml.includes('模拟器')
      && menuHtml.includes('实体设备'),
    'one array, two readable groups',
  )
  step(
    'an unauthorized device is listed but unpickable',
    menuHtml.includes('data-android-device-online="false"')
      && /data-android-device-serial="R5CT1234"[^>]*/.test(menuHtml)
      && menuHtml.includes('aria-disabled="true"'),
    'picking it could only ever produce a coded 409',
  )
  step(
    'AVDs render as an inert "start it with android_boot" hint group',
    menuHtml.includes('data-android-avds-group="true"')
      && menuHtml.includes('data-android-avd="Pixel_7_API_34"')
      && menuHtml.includes('用 android_boot 启动'),
    'booting an AVD is never a click in the panel',
  )
  const switchingHtml = render(client.AndroidDevicePickerBody, {
    devices: listing.devices,
    avds: [],
    currentDevice: { serial: 'emulator-5554' },
    switching: true,
    error: '',
    locale: 'en',
    onSelect: () => {},
  })
  const errorHtml = render(client.AndroidDevicePickerBody, {
    devices: listing.devices,
    avds: [],
    currentDevice: { serial: 'emulator-5554' },
    switching: false,
    error: en.errDeviceBusy,
    locale: 'en',
    onSelect: () => {},
  })
  step(
    'the picker has a transitional switching state and an inline error state',
    switchingHtml.includes('data-android-device-switching="true"')
      && switchingHtml.includes('data-android-device-spinner="true"')
      && switchingHtml.includes('disabled=""')
      && errorHtml.includes('data-android-device-error="true"')
      && errorHtml.includes('role="alert"')
      && errorHtml.includes(en.errDeviceBusy),
    'a failed switch reverts the selection and explains itself',
  )
  let switchCalls = 0
  let switched
  let switchError = ''
  const okController = client.createAndroidDeviceSwitchController({
    fetcher: jsonFetcher((path, body) => {
      switchCalls += 1
      return { body: { ok: true, streamUrl: '/_dsh/dsh-android/stream/new', device: body.device, deviceName: 'Pixel 7' } }
    }),
    copy: en,
    onSwitched: result => { switched = result },
    onError: message => { switchError = message },
  })
  const first = okController.switchTo('R5CT1234')
  const second = okController.switchTo('R5CT1234')
  await new Promise(resolve => setImmediate(resolve))
  step(
    'the switch controller POSTs once and refuses a concurrent pick',
    first === true && second === false && switchCalls === 1
      && switched?.device === 'R5CT1234' && switched.deviceName === 'Pixel 7' && switchError === '',
    'the client half of the no-concurrent-switches contract',
  )
  okController.dispose()
  let failedMessage = ''
  const badController = client.createAndroidDeviceSwitchController({
    fetcher: jsonFetcher(() => ({ status: 409, body: { ok: false, code: 'device_offline', error: 'the device is offline, not ready' } })),
    copy: en,
    onSwitched: () => {},
    onError: message => { failedMessage = message },
  })
  badController.switchTo('R5CT1234')
  await new Promise(resolve => setImmediate(resolve))
  step(
    'a refused switch reports the LOCALIZED reason',
    failedMessage === en.errDeviceOffline,
    failedMessage,
  )
  badController.dispose()
  step(
    'a switch response becomes the synthetic stream meta the panel adopts',
    JSON.stringify(client.androidSwitchedStreamMetaOf({ streamUrl: '/x', device: 'R5CT1234', deviceName: 'Pixel 7' }))
      === '{"kind":"android-stream","device":{"serial":"R5CT1234","name":"Pixel 7"}}',
    'same identity, new device',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Capture controller (fake timers) + device menu
  // ═══════════════════════════════════════════════════════════════════════════
  const timerQueue = []
  const fakeTimers = {
    setTimeout: (fn, ms) => { const handle = { fn, ms }; timerQueue.push(handle); return handle },
    clearTimeout: handle => {
      const index = timerQueue.indexOf(handle)
      if (index >= 0) timerQueue.splice(index, 1)
    },
  }
  let capturedBody
  let openedUrl
  const captureOptions = {
    current: {
      fetcher: jsonFetcher((path, body) => {
        capturedBody = { path, body }
        return { body: { ok: true, screenshotUrl: '/_dsh/dsh-android/screenshot/tok', path: '/tmp/shot.png', bytes: 4096 } }
      }),
      openWindow: (url) => { openedUrl = url },
      timers: fakeTimers,
      autoHideMs: 2000,
    },
  }
  const captureController = client.createAndroidCaptureController(captureOptions)
  const captureOk = await captureController.capture('emulator-5554')
  step(
    'capture POSTs {device} and opens the minted URL, then confirms',
    captureOk === true
      && capturedBody.path === '/_dsh/dsh-android/capture'
      && capturedBody.body.device === 'emulator-5554'
      && openedUrl === '/_dsh/dsh-android/screenshot/tok'
      && captureController.getPhase() === 'done',
    'busy → done',
  )
  const pendingHide = timerQueue.shift()
  pendingHide?.fn()
  step(
    'the captured toast auto-clears after the confirm delay',
    pendingHide?.ms === 2000 && captureController.getPhase() === 'idle'
      && client.ANDROID_CAPTURE_CONFIRM_MS === 2000,
    'no leaked timer',
  )
  captureController.dispose()

  const deviceMenuHtml = render(client.AndroidDeviceMenu, {
    copy: zh,
    onAction: () => {},
    open: true,
  })
  step(
    'the device menu offers exactly the five host actions, none disabled by kind',
    client.ANDROID_DEVICE_ACTIONS.length === 5
      && ['notifications', 'quick-settings', 'lock', 'wake', 'assistant']
        .every(action => deviceMenuHtml.includes(`data-android-device-action="${action}"`))
      && deviceMenuHtml.includes('通知栏')
      && deviceMenuHtml.includes('语音助手'),
    'adb treats every device the same',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Status capsule (session gate + poller)
  // ═══════════════════════════════════════════════════════════════════════════
  const capsuleLive = render(client.AndroidStatusCapsuleBody, {
    status: { running: true, serial: 'emulator-5554', deviceName: 'Pixel 7' },
    panelOpen: false,
    hasAndroidSources: true,
    locale: 'zh',
    onOpen: () => {},
  })
  step(
    'the capsule renders a live pill only when panel closed + session has sources',
    capsuleLive.includes('data-android-status-capsule="live"')
      && capsuleLive.includes('data-android-status-device="emulator-5554"')
      && capsuleLive.includes('Pixel 7 · 实时')
      && render(client.AndroidStatusCapsuleBody, { status: { running: true }, panelOpen: true, hasAndroidSources: true, locale: 'en', onOpen: () => {} }) === ''
      && render(client.AndroidStatusCapsuleBody, { status: { running: true }, panelOpen: false, hasAndroidSources: false, locale: 'en', onOpen: () => {} }) === ''
      && render(client.AndroidStatusCapsuleBody, { status: { running: false }, panelOpen: false, hasAndroidSources: true, locale: 'en', onOpen: () => {} }) === '',
    'three independent gates',
  )
  let pollCalls = 0
  const pollTimers = { ...fakeTimers, setInterval: (fn, ms) => ({ fn, ms }), clearInterval: () => {} }
  const poller = client.createAndroidStatusPoller({
    fetchStatus: async () => { pollCalls += 1; return { running: false } },
    pollIntervalMs: client.ANDROID_STATUS_POLL_MS,
    onStatus: () => {},
    timers: pollTimers,
  })
  poller.refreshSoon()
  const callsWhileDisabled = pollCalls
  poller.setEnabled(true)
  await new Promise(resolve => setImmediate(resolve))
  step(
    'the status poller never fetches until it is gated on',
    callsWhileDisabled === 0 && pollCalls === 1 && client.ANDROID_STATUS_POLL_MS === 5000,
    'a brand-new empty session issues zero requests',
  )
  poller.dispose()
  const capsuleRequest = client.androidStreamStatusRequestOf({ running: true, serial: 'emulator-5554', deviceName: 'Pixel 7' }, 'session-1')
  step(
    'the capsule click builds a synthetic android_boot stream request',
    capsuleRequest.toolName === 'android_boot'
      && capsuleRequest.sessionId === 'session-1'
      && capsuleRequest.block.meta.kind === 'android-stream'
      && capsuleRequest.block.meta.device.serial === 'emulator-5554',
    'the panel grant flow takes over from there',
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // Panel store + dock + row trigger (pure)
  // ═══════════════════════════════════════════════════════════════════════════
  const store = client.createAndroidPanelStore()
  const request = { sessionId: 'session-1', callId: CALL_ID, toolName: 'android_boot', block: settledBlock('android_boot', BOOT_META) }
  step(
    'the panel store opens, replaces in place and closes',
    store.getSnapshot() === undefined
      && store.replaceOpen(request) === false
      && store.open(request) === true
      && store.getSnapshot()?.callId === CALL_ID
      && store.replaceOpen({ ...request, block: settledBlock('android_boot', { ...BOOT_META, device: { serial: 'R5CT1234' } }) }) === true
      && store.getSnapshot()?.block.meta.device.serial === 'R5CT1234'
      && client.androidPanelRequestKey(request) === 'session-1\ncall-android-panel-smoke\nandroid_boot',
    'a switch never remounts the panel',
  )
  store.close()
  step(
    'store size/frame modes persist for the host lifetime',
    store.getSizeMode().kind === 'fit'
      && store.getFrameStyle() === 'bezel'
      && (store.setSizeMode({ kind: 'preset', width: 320 }), store.getSizeMode().width === 320)
      && (store.setFrameStyle('none'), store.getFrameStyle() === 'none'),
    'the header dropdown and the quick pill share one truth',
  )
  step(
    'the size dropdown and the toolbar quick pill agree by id',
    client.ANDROID_PANEL_QUICK_SIZE_OPTIONS.every(quick =>
      client.ANDROID_PANEL_SIZE_OPTIONS.some(option => option.id === quick.id && option.mode === quick.mode))
      && client.androidPanelSizeModeIdOf(client.androidPanelSizeModeOf('preset-M')) === 'preset-M'
      && client.androidPanelSizeModeOf('nonsense').kind === 'fit',
    'quick buttons dispatch the dropdown modes',
  )
  const fakeTarget = selector => ({
    closest: query => (query === '[data-chat-call-id]' && selector.row
      ? { dataset: { chatCallId: CALL_ID } }
      : query === client.ANDROID_PANEL_INTERACTIVE_SELECTOR && selector.interactive
        ? {}
        : null),
  })
  step(
    'row-click routing ignores controls and the live frame',
    client.androidPanelClickRowCallIdOf(fakeTarget({ row: true })) === CALL_ID
      && client.androidPanelClickIsInteractive(fakeTarget({ interactive: true })) === true
      && client.androidPanelClickIsInteractive(fakeTarget({ row: true })) === false
      && client.ANDROID_PANEL_INTERACTIVE_SELECTOR.includes('[data-android-live-frame][data-android-frame-state="live"]')
      && client.ANDROID_PANEL_INTERACTIVE_SELECTOR.includes('[data-android-panel]'),
    'a tap on the stream is device interaction, not a panel-open gesture',
  )
  const fakeRoot = { dataset: {}, style: { marginRight: '', minWidth: '' } }
  const lease = client.claimAndroidPanelDock(fakeRoot, 'owner-a', 380, 0)
  const stolen = client.claimAndroidPanelDock(fakeRoot, 'owner-b', 380, 0)
  step(
    'the dock lease is exclusive and restores the root on release',
    lease !== undefined
      && fakeRoot.style.marginRight === '380px'
      && stolen === undefined
      && (lease.release(), fakeRoot.style.marginRight === '' && fakeRoot.dataset[client.ANDROID_PANEL_DOCK_ATTRIBUTE] === undefined),
    'fail-closed around another plugin owning the margin',
  )
} catch (error) {
  step('smoke suite completed without an unexpected throw', false, error instanceof Error ? (error.stack ?? error.message) : String(error))
}

finish()
