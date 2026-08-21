/**
 * Static smoke for the adb-facing core: `lib/adb.js`, `lib/frame-source.js`
 * and `lib/android-host.js`.
 *
 * Nothing here touches a real device. Two substitution seams carry the whole
 * suite:
 *
 * 1. A SHIM `adb` — a Node script written into a mkdtemp directory — stands in
 *    for the real binary, reachable through the `ADB` env var, through `PATH`,
 *    or through a fake `ANDROID_HOME/platform-tools`, so the three-tier
 *    resolution order is exercised for real instead of asserted from theory.
 *    The shim answers `devices -l` and `wm size` as text and `exec-out
 *    screencap -p` as BINARY bytes (a string round trip would corrupt the PNG,
 *    which is the exact bug `execOut` exists to prevent); anything else exits 1
 *    so an unexpected invocation fails loudly.
 * 2. A fake TOOLCHAIN object for AndroidHostController — `execOut` answers with
 *    a 1×1 PNG and `spawnExecOut` returns a scripted `node -e` child that
 *    prints that PNG on a timer, which is exactly the shape of the persistent
 *    `while :; do screencap -p; done` loop the real host drives.
 *
 * Run `pnpm run build` (or the tsc subset) first: the suite imports the
 * COMPILED `lib/*.js`, never `src`.
 */

import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  TINY_PNG_B64,
  createStepReporter,
  expectThrow,
  withEnv,
} from './_smoke-harness.mjs'

const { step, finish } = createStepReporter()
const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
const libDir = join(root, 'lib')
const TINY_PNG = Buffer.from(TINY_PNG_B64, 'base64')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Import one compiled module, or report the whole suite as SKIP. */
async function importLib(name) {
  return import(pathToFileURL(join(libDir, name)).href)
}

let adb
let frameSource
let androidHost
try {
  ;[adb, frameSource, androidHost] = await Promise.all([
    importLib('adb.js'),
    importLib('frame-source.js'),
    importLib('android-host.js'),
  ])
} catch (error) {
  // The compiled lib is produced by `pnpm run build`; without it there is
  // nothing to smoke, and a hard failure here would only report the build.
  step('lib/*.js is built', 'SKIP', `run \`pnpm run build\` first — ${error instanceof Error ? error.message : String(error)}`)
  finish()
  process.exit(0)
}

const { AdbToolchain, AdbError, SERIAL_PATTERN, resolveAdbBinary } = adb
const { PngFrameSplitter, pngDimensions } = frameSource
const {
  ANDROID_BUTTONS,
  AndroidHostController,
  escapeInputText,
  isInputTextSafe,
} = androidHost

// ── the shim adb (and the fake SDK layouts around it) ────────────────────────

const workspace = mkdtempSync(join(tmpdir(), 'dsh-android-smoke-'))

const SHIM_SOURCE = `#!/usr/bin/env node
// Shim adb for the dsh-android smoke suite. Text answers go through
// process.stdout as strings; screencap answers as a raw Buffer so the binary
// path is genuinely binary. Unknown invocations exit 1 (loudly).
const png = Buffer.from(${JSON.stringify(TINY_PNG_B64)}, 'base64')
const argv = process.argv.slice(2)
let rest = argv
if (rest[0] === '-s') rest = rest.slice(2)
const verb = rest[0]
if (verb === 'devices') {
  process.stdout.write([
    '* daemon not running; starting now at tcp:5037',
    '* daemon started successfully',
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1',
    'R5CT30ABCDE            device product:a54xnaxx model:SM_A546U device:a54x transport_id:2',
    'R5CT99OFFLN            unauthorized usb:1-1 transport_id:3',
    '',
  ].join('\\n'))
  process.exit(0)
}
if (verb === 'exec-out' && rest[1] === 'screencap') {
  process.stdout.write(png)
  process.exit(0)
}
if (verb === 'shell') {
  const command = rest.slice(1).join(' ')
  if (command.startsWith('wm size')) {
    process.stdout.write('Physical size: 1080x2400\\r\\nOverride size: 540x1200\\r\\n')
    process.exit(0)
  }
  if (command.startsWith('getprop sys.boot_completed')) {
    process.stdout.write('1\\n')
    process.exit(0)
  }
  if (command.startsWith('input ')) process.exit(0)
}
process.stderr.write('shim adb: unsupported invocation: ' + argv.join(' ') + '\\n')
process.exit(1)
`

function writeShim(path) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, SHIM_SOURCE, { mode: 0o755 })
  chmodSync(path, 0o755)
  return path
}

const shimDirect = writeShim(join(workspace, 'direct', 'adb'))
const shimOnPath = writeShim(join(workspace, 'pathbin', 'adb'))
const fakeSdk = join(workspace, 'fakesdk')
const shimInSdk = writeShim(join(fakeSdk, 'platform-tools', 'adb'))
const emptyDir = join(workspace, 'empty')
mkdirSync(emptyDir, { recursive: true })
const missingAdb = join(workspace, 'nope', 'adb')

// A resolution probe must not inherit the developer's real environment.
const CLEAN_ENV = {
  ADB: undefined,
  PATH: emptyDir,
  ANDROID_HOME: emptyDir,
  ANDROID_SDK_ROOT: emptyDir,
}

// ── 1. resolveAdbBinary: env → PATH → SDK ───────────────────────────────────

await withEnv({ ...CLEAN_ENV, ADB: shimDirect }, () => {
  const binary = resolveAdbBinary()
  step(
    'resolveAdbBinary prefers the ADB env var',
    binary.available === true && binary.source === 'env' && binary.command === shimDirect,
    `${binary.source} → ${binary.command ?? '(none)'}`,
  )
})

await withEnv({ ...CLEAN_ENV, ADB: missingAdb }, () => {
  const binary = resolveAdbBinary()
  step(
    'a broken ADB env var refuses instead of silently falling through',
    binary.available === false
      && binary.source === 'unavailable'
      && /is not an executable file/.test(binary.reason ?? ''),
    binary.reason ?? '(no reason)',
  )
})

await withEnv({ ...CLEAN_ENV, PATH: join(workspace, 'pathbin') }, () => {
  const binary = resolveAdbBinary()
  step(
    'resolveAdbBinary falls back to adb on PATH',
    binary.available === true && binary.source === 'path' && binary.command === shimOnPath,
    `${binary.source} → ${binary.command ?? '(none)'}`,
  )
})

await withEnv({ ...CLEAN_ENV, ANDROID_HOME: fakeSdk }, () => {
  const binary = resolveAdbBinary()
  step(
    'resolveAdbBinary falls back to <ANDROID_HOME>/platform-tools/adb',
    binary.available === true && binary.source === 'sdk' && binary.command === shimInSdk,
    `${binary.source} → ${binary.command ?? '(none)'}`,
  )
})

await withEnv(CLEAN_ENV, () => {
  const binary = resolveAdbBinary()
  // A machine with a genuine SDK under ~ still resolves; what must NEVER
  // happen is resolving to one of this suite's fake roots, and an
  // unavailable verdict must carry the actionable hint.
  const clean = binary.available
    ? binary.source === 'sdk' && !binary.command.startsWith(workspace)
    : /set ADB, add it to PATH, or install the Android SDK platform-tools/.test(binary.reason ?? '')
  step(
    'with nothing configured adb is either the machine SDK or an explanatory unavailable',
    clean,
    binary.available ? `machine sdk → ${binary.command}` : (binary.reason ?? '(no reason)'),
  )
})

await withEnv(CLEAN_ENV, async () => {
  const toolchain = new AdbToolchain()
  if (toolchain.available) {
    step('requireAdb explains an unavailable adb', 'SKIP', 'this machine has a real SDK on the default path')
    return
  }
  await expectThrow(
    step,
    'requireAdb explains an unavailable adb',
    () => toolchain.exec(['devices']),
    /dsh-android: adb is unavailable/,
  )
})

// ── 2. listDevices / execOut / screenSize through the shim ──────────────────

const shimToolchain = new AdbToolchain({ available: true, source: 'env', command: shimDirect })

const devices = await shimToolchain.listDevices()
const emulator = devices.find(device => device.serial === 'emulator-5554')
const phone = devices.find(device => device.serial === 'R5CT30ABCDE')
const unauthorized = devices.find(device => device.serial === 'R5CT99OFFLN')
step(
  'listDevices skips the header and daemon noise and parses every row',
  devices.length === 3 && emulator !== undefined && phone !== undefined && unauthorized !== undefined,
  devices.map(device => `${device.serial}=${device.state}`).join(' '),
)
step(
  'listDevices classifies an emulator serial and un-underscores the model',
  emulator?.emulator === true && emulator?.model === 'sdk gphone64 arm64' && emulator?.transportId === '1',
  JSON.stringify(emulator),
)
step(
  'listDevices classifies a USB phone as physical',
  phone?.emulator === false && phone?.state === 'device' && phone?.model === 'SM A546U',
  JSON.stringify(phone),
)
step(
  'listDevices keeps an unauthorized device (state preserved, not dropped)',
  unauthorized?.state === 'unauthorized' && unauthorized?.emulator === false,
  JSON.stringify(unauthorized),
)
step(
  'every parsed serial satisfies SERIAL_PATTERN',
  devices.every(device => SERIAL_PATTERN.test(device.serial)),
  devices.map(device => device.serial).join(', '),
)

const online = await shimToolchain.onlineDevices()
step(
  'onlineDevices filters to the `device` state only',
  online.length === 2 && online.every(device => device.state === 'device'),
  online.map(device => device.serial).join(', '),
)

const captured = await shimToolchain.execOut('emulator-5554', ['screencap', '-p'])
step(
  'execOut is binary-safe (screencap bytes survive byte-for-byte)',
  Buffer.isBuffer(captured) && captured.equals(TINY_PNG),
  `${captured.length} bytes, signature 0x${captured.subarray(0, 4).toString('hex')}`,
)

const size = await shimToolchain.screenSize('emulator-5554')
step(
  'screenSize prefers the Override size over the Physical size',
  size.width === 540 && size.height === 1200,
  `${size.width}x${size.height}`,
)

const shellOut = await shimToolchain.shell('emulator-5554', ['wm', 'size'])
step(
  'shell normalizes CRLF to LF',
  !shellOut.includes('\r'),
  JSON.stringify(shellOut.slice(0, 40)),
)

await expectThrow(
  step,
  'an unsupported adb invocation throws AdbError with the stderr detail',
  () => shimToolchain.exec(['bogus-verb']),
  /unsupported invocation/,
)
step(
  'the thrown failure is an AdbError carrying its args',
  await shimToolchain.exec(['bogus-verb']).then(() => false, error => error instanceof AdbError && error.args.includes('bogus-verb')),
)

// ── 3. PngFrameSplitter: concatenated frames + resync over garbage ──────────

{
  const splitter = new PngFrameSplitter()
  const garbage = Buffer.from('adb: device offline\n')
  // A near-miss prefix of the PNG signature must not derail the scan.
  const nearMiss = Buffer.from([0x89, 0x50, 0x4e, 0x46, 0xff, 0x00])
  const stream = Buffer.concat([
    garbage,
    TINY_PNG,
    nearMiss,
    TINY_PNG,
    TINY_PNG,
    Buffer.from('trailing noise'),
  ])
  // Feed in ragged chunks so a frame boundary lands mid-chunk at least once.
  const frames = []
  for (let offset = 0; offset < stream.length; offset += 7) {
    frames.push(...splitter.push(stream.subarray(offset, offset + 7)))
  }
  step(
    'PngFrameSplitter cuts 3 frames out of a garbage-interleaved byte stream',
    frames.length === 3 && frames.every(frame => frame.equals(TINY_PNG)),
    `${frames.length} frames, sizes ${frames.map(frame => frame.length).join('/')}`,
  )
  // Resync: after the trailing noise the splitter must still accept a frame.
  const resynced = splitter.push(Buffer.concat([Buffer.from(' more junk'), TINY_PNG]))
  step(
    'PngFrameSplitter resynchronizes after trailing garbage',
    resynced.length === 1 && resynced[0].equals(TINY_PNG),
    `${resynced.length} frame(s)`,
  )
}

{
  const splitter = new PngFrameSplitter()
  const half = TINY_PNG.length >> 1
  const first = splitter.push(TINY_PNG.subarray(0, half))
  const second = splitter.push(TINY_PNG.subarray(half))
  step(
    'a frame split across two chunks emits exactly once, when it completes',
    first.length === 0 && second.length === 1 && second[0].equals(TINY_PNG),
    `${first.length} then ${second.length}`,
  )
}

{
  const dimensions = pngDimensions(TINY_PNG)
  const notPng = pngDimensions(Buffer.alloc(64, 0x41))
  step(
    'pngDimensions reads IHDR without decoding, and rejects non-PNG bytes',
    dimensions?.width === 1 && dimensions?.height === 1 && notPng === undefined,
    JSON.stringify(dimensions),
  )
}

// ── 4. input-text escaping ──────────────────────────────────────────────────

step(
  'escapeInputText turns spaces into %s and escapes shell metacharacters',
  escapeInputText('hi there') === 'hi%sthere'
    && escapeInputText('a&b;c') === 'a\\&b\\;c'
    && escapeInputText('$(rm -rf /)') === '\\$\\(rm%s-rf%s/\\)',
  escapeInputText('$(rm -rf /)'),
)
step(
  'isInputTextSafe accepts printable ASCII and refuses CJK/empty input',
  isInputTextSafe('Hello, world!') === true
    && isInputTextSafe('你好') === false
    && isInputTextSafe('') === false
    && isInputTextSafe('line\nbreak') === false,
)

// ── 5. AndroidHostController against a fake toolchain ───────────────────────

const FAKE_DEVICE = { serial: 'emulator-5554', state: 'device', emulator: true, model: 'sdk gphone64 arm64' }

/** A toolchain whose stream child is a scripted `node -e` PNG emitter. */
function makeFakeToolchain({ frameIntervalMs = 25, devices: listing = [FAKE_DEVICE] } = {}) {
  const calls = []
  const children = []
  return {
    calls,
    children,
    binary: { available: true, source: 'env', command: '/fake/adb' },
    available: true,
    requireAdb: () => '/fake/adb',
    async exec(args, options = {}) {
      calls.push(['exec', options.serial ?? '-', ...args].join(' '))
      return { stdout: '', stderr: '' }
    },
    async execOut(serial, command) {
      calls.push(['exec-out', serial, ...command].join(' '))
      return TINY_PNG
    },
    async shell(serial, command) {
      calls.push(['shell', serial, ...command].join(' '))
      return ''
    },
    spawnExecOut(serial, command) {
      calls.push(['spawn', serial, ...command].join(' '))
      const script = `const png = Buffer.from(${JSON.stringify(TINY_PNG_B64)}, 'base64')\n`
        + `const timer = setInterval(() => process.stdout.write(png), ${frameIntervalMs})\n`
        + 'process.on(\'SIGTERM\', () => { clearInterval(timer); process.exit(0) })\n'
      const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child)
      return child
    },
    async listDevices() {
      calls.push('devices')
      return listing.map(device => ({ ...device }))
    },
    async onlineDevices() {
      return listing.filter(device => device.state === 'device').map(device => ({ ...device }))
    },
    async deviceDetails(device) {
      return { serial: device.serial }
    },
    async screenSize() {
      return { width: 1080, height: 2400 }
    },
  }
}

{
  const toolchain = makeFakeToolchain()
  const host = new AndroidHostController(toolchain, { idleTimeoutMs: 0, firstFrameTimeoutMs: 5_000 })
  try {
    step('the host reports availability from its toolchain', host.available === true && host.running === false)

    const seen = []
    const unsubscribe = host.subscribeFrames(frame => seen.push(frame))

    const started = Date.now()
    const info = await host.ensureStreaming({ serial: FAKE_DEVICE.serial })
    step(
      'ensureStreaming resolves with the first frame size',
      info.serial === FAKE_DEVICE.serial && info.width === 1 && info.height === 1,
      `${info.width}x${info.height} in ${Date.now() - started} ms`,
    )
    step(
      'ensureStreaming spawns exactly one persistent screencap loop',
      toolchain.calls.filter(call => call.startsWith('spawn ')).length === 1
        && toolchain.calls.some(call => call.includes('while :; do screencap -p; done')),
      toolchain.calls.find(call => call.startsWith('spawn ')) ?? '(none)',
    )
    step(
      'streamedSerial and latestFrame reflect the live loop',
      host.running === true
        && host.streamedSerial === FAKE_DEVICE.serial
        && host.latestFrame?.png.equals(TINY_PNG) === true,
      `sequence ${host.latestFrame?.sequence}`,
    )

    // A second call for the same serial must be a no-op, not a second child.
    await host.ensureStreaming({ serial: FAKE_DEVICE.serial })
    step(
      're-ensuring the same serial reuses the running loop',
      toolchain.calls.filter(call => call.startsWith('spawn ')).length === 1,
    )

    await sleep(120)
    unsubscribe()
    const afterUnsubscribe = seen.length
    await sleep(120)
    step(
      'subscribeFrames fans out live frames and its disposer stops the fan-out',
      seen.length >= 2 && seen.length === afterUnsubscribe,
      `${seen.length} frames observed`,
    )

    const before = host.status().consumers
    const release = host.acquire()
    const held = host.status().consumers
    release()
    release() // idempotent by contract
    step(
      'acquire/release move the consumer count exactly once',
      before === 0 && held === 1 && host.status().consumers === 0,
      `${before} → ${held} → ${host.status().consumers}`,
    )

    const status = host.status()
    step(
      'status reports the live stream shape',
      status.running === true
        && status.serial === FAKE_DEVICE.serial
        && status.width === 1
        && status.height === 1
        && status.adbSource === 'env'
        && Array.isArray(status.stderr),
      JSON.stringify({ ...status, stderr: status.stderr.length }),
    )

    // ── control surface ───────────────────────────────────────────────────
    toolchain.calls.length = 0
    await host.tap(FAKE_DEVICE.serial, 0.5, 0.5)
    step(
      'tap maps normalized coordinates onto the FRAME size (not `wm size`)',
      toolchain.calls.some(call => /^shell emulator-5554 input tap \d+ \d+$/.test(call)),
      toolchain.calls.join(' | '),
    )
    await expectThrow(
      step,
      'tap refuses coordinates outside 0..1',
      () => host.tap(FAKE_DEVICE.serial, 1.5, 0.5),
      /normalized 0\.\.1/,
    )

    toolchain.calls.length = 0
    await host.drag(FAKE_DEVICE.serial, { fromX: 0.5, fromY: 0.9, toX: 0.5, toY: 0.1, duration: 0.4 })
    step(
      'drag becomes one `input swipe` with a millisecond duration',
      toolchain.calls.some(call => /input swipe \d+ \d+ \d+ \d+ 400$/.test(call)),
      toolchain.calls.join(' | '),
    )

    toolchain.calls.length = 0
    await host.button(FAKE_DEVICE.serial, 'back')
    await host.button(FAKE_DEVICE.serial, 'recents')
    step(
      'button maps the Android three-key names onto keycodes',
      toolchain.calls.includes('shell emulator-5554 input keyevent KEYCODE_BACK')
        && toolchain.calls.includes('shell emulator-5554 input keyevent KEYCODE_APP_SWITCH')
        && ANDROID_BUTTONS.home === 'KEYCODE_HOME',
      toolchain.calls.join(' | '),
    )
    await expectThrow(
      step,
      'an unknown button names the accepted set',
      () => host.button(FAKE_DEVICE.serial, 'siri'),
      /unknown button .*expected one of .*home/s,
    )

    toolchain.calls.length = 0
    await host.type(FAKE_DEVICE.serial, 'hello world')
    step(
      'ASCII text goes straight through `input text`',
      toolchain.calls.includes('shell emulator-5554 input text hello%sworld'),
      toolchain.calls.join(' | '),
    )
    await expectThrow(
      step,
      'non-ASCII text is refused with the ADBKeyboard install hint (never mistyped)',
      () => host.type(FAKE_DEVICE.serial, '你好'),
      /ADBKeyboard/,
    )

    toolchain.calls.length = 0
    await host.rotate(FAKE_DEVICE.serial, 1)
    step(
      'rotate pins accelerometer_rotation before writing user_rotation',
      toolchain.calls[0] === 'shell emulator-5554 settings put system accelerometer_rotation 0'
        && toolchain.calls[1] === 'shell emulator-5554 settings put system user_rotation 1',
      toolchain.calls.join(' | '),
    )
    await expectThrow(step, 'rotate refuses a value outside 0..3', () => host.rotate(FAKE_DEVICE.serial, 9), /must be 0, 1, 2 or 3/)

    toolchain.calls.length = 0
    await host.deviceAction(FAKE_DEVICE.serial, 'notifications')
    step(
      'deviceAction expands the notification shade',
      toolchain.calls.includes('shell emulator-5554 cmd statusbar expand-notifications'),
      toolchain.calls.join(' | '),
    )

    const shot = await host.screenshot(FAKE_DEVICE.serial)
    step(
      'screenshot captures a fresh PNG independently of the stream loop',
      shot.png.equals(TINY_PNG) && shot.width === 1 && shot.height === 1,
      `${shot.png.length} bytes ${shot.width}x${shot.height}`,
    )

    const resolved = await host.resolveTarget()
    step(
      'resolveTarget falls back to the streamed device',
      resolved.serial === FAKE_DEVICE.serial,
      resolved.serial,
    )
    await expectThrow(
      step,
      'resolveTarget names android_devices for an unknown serial',
      () => host.resolveTarget('ghost-9999'),
      /no connected device has the serial ghost-9999.*android_devices/s,
    )

    await host.stop()
    step('stop retires the loop', host.running === false && host.streamedSerial === undefined)
  } finally {
    await host.dispose()
  }
}

// ── 6. idle timeout and disposal ────────────────────────────────────────────

{
  const toolchain = makeFakeToolchain()
  const host = new AndroidHostController(toolchain, { idleTimeoutMs: 150, firstFrameTimeoutMs: 5_000 })
  try {
    await host.ensureStreaming({ serial: FAKE_DEVICE.serial })
    const release = host.acquire()
    await sleep(400)
    step(
      'a held consumer keeps the stream alive past the idle timeout',
      host.running === true,
      `consumers ${host.status().consumers}`,
    )
    release()
    await sleep(450)
    step(
      'with zero consumers the stream stops itself after the idle timeout',
      host.running === false,
      `running=${host.running}`,
    )
  } finally {
    await host.dispose()
  }
}

{
  const toolchain = makeFakeToolchain()
  const host = new AndroidHostController(toolchain, { idleTimeoutMs: 0 })
  await host.ensureStreaming({ serial: FAKE_DEVICE.serial })
  await host.dispose()
  step('dispose stops the loop', host.running === false)
  await expectThrow(
    step,
    'a disposed host refuses to start again',
    () => host.ensureStreaming({ serial: FAKE_DEVICE.serial }),
    /the host is disposed/,
  )
}

{
  const toolchain = makeFakeToolchain({
    devices: [{ serial: 'R5CT99OFFLN', state: 'unauthorized', emulator: false }],
  })
  const host = new AndroidHostController(toolchain, { idleTimeoutMs: 0 })
  try {
    await expectThrow(
      step,
      'streaming an unauthorized device explains the device state',
      () => host.ensureStreaming({ serial: 'R5CT99OFFLN' }),
      /is unauthorized, not ready to stream/,
    )
    await expectThrow(
      step,
      'streaming an absent serial says so instead of hanging',
      () => host.ensureStreaming({ serial: 'emulator-5554' }),
      /no connected device has the serial emulator-5554/,
    )
  } finally {
    await host.dispose()
  }
}

// ── issue #1: Windows has no Unix execute bit ────────────────────────────────
// A real adb.exe (LDPlayer) was misjudged as "not an executable file" because
// resolution required mode & 0o111. With platform stubbed to win32, a plain
// regular file with NO exec bit must resolve through the ADB env var.
{
  const winDir = mkdtempSync(join(tmpdir(), 'dsh-android-win-adb-'))
  const winAdb = join(winDir, 'adb.exe')
  writeFileSync(winAdb, '@echo off\r\n', { mode: 0o644 })
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    await withEnv({ ADB: winAdb }, async () => {
      const resolved = adb.resolveAdbBinary()
      step('issue #1: a mode-0644 adb.exe resolves on win32',
        resolved.available === true && resolved.source === 'env' && resolved.command === winAdb,
        JSON.stringify(resolved))
    })
  } finally {
    if (realPlatform) Object.defineProperty(process, 'platform', realPlatform)
  }
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  try {
    step('the Unix execute-bit check still holds off win32',
      (await withEnv({ ADB: winAdb }, async () => adb.resolveAdbBinary())).available === false)
  } finally {
    if (realPlatform) Object.defineProperty(process, 'platform', realPlatform)
  }
}

finish()
