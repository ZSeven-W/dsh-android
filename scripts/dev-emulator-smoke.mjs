/**
 * Live smoke against a REAL Android device (emulator or USB phone).
 *
 * This is the only suite in `scripts/` that needs hardware, which is why it is
 * NOT part of `pnpm test`: CI runs it in a separate, `continue-on-error` job on
 * an emulator runner, and a developer runs it by hand when a device is
 * attached. Everything it cannot find — the compiled `lib/`, adb, an online
 * device — is reported as SKIP with exit 0, never as a failure: a machine
 * without a device has proved nothing, and pretending otherwise is worse than
 * silence.
 *
 * What it proves, end to end, on real hardware:
 *   1. `ensureStreaming` produces a first frame (measured, so a regression in
 *      the ~200 ms budget is visible);
 *   2. the persistent screencap loop sustains a real frame rate over 2 s;
 *   3. `input tap` round-trips through the host's normalized-coordinate path;
 *   4. `dispose` leaves no child behind.
 *
 * Usage: `node scripts/dev-emulator-smoke.mjs [serial]`
 */

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createStepReporter } from './_smoke-harness.mjs'

const { step, finish } = createStepReporter()
const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
const libDir = join(root, 'lib')

/** Report the remaining suite as skipped and leave with a green exit. */
function skipAll(reason) {
  step('live device smoke', 'SKIP', reason)
  finish()
  process.exit(0)
}

let androidHost
try {
  androidHost = await import(pathToFileURL(join(libDir, 'android-host.js')).href)
} catch (error) {
  skipAll(`lib/ is not built — run \`pnpm run build\` first (${error instanceof Error ? error.message : String(error)})`)
}

const { AndroidHostController } = androidHost
const host = new AndroidHostController(undefined, { idleTimeoutMs: 0, firstFrameTimeoutMs: 30_000 })

if (!host.available) {
  skipAll(host.toolchain.binary.reason ?? 'adb is unavailable on this machine')
}

let online
try {
  online = await host.toolchain.onlineDevices()
} catch (error) {
  skipAll(`adb could not list devices: ${error instanceof Error ? error.message : String(error)}`)
}

const requested = process.argv[2]
const device = requested === undefined
  ? online[0]
  : online.find(candidate => candidate.serial === requested)
if (device === undefined) {
  skipAll(requested === undefined
    ? 'no online device — start an emulator or plug in a phone with USB debugging enabled'
    : `no online device has the serial ${requested}`)
}

const serial = device.serial
step('an online device is attached', true, `${serial} (${device.emulator ? 'emulator' : 'physical'}${device.model === undefined ? '' : `, ${device.model}`})`)

try {
  // 1. First frame.
  const startedAt = Date.now()
  const info = await host.ensureStreaming({ serial })
  const firstFrameMs = Date.now() - startedAt
  step(
    'ensureStreaming produces a first frame',
    typeof info.width === 'number' && info.width > 0 && typeof info.height === 'number' && info.height > 0,
    `${info.width}x${info.height} in ${firstFrameMs} ms`,
  )

  // 2. Sustained frame rate over 2 s.
  const release = host.acquire()
  let frames = 0
  const unsubscribe = host.subscribeFrames(() => {
    frames += 1
  })
  await new Promise(resolve => setTimeout(resolve, 2_000))
  unsubscribe()
  step(
    'the persistent screencap loop sustains a usable frame rate',
    frames >= 2,
    `${frames} frames in 2 s (~${(frames / 2).toFixed(1)} fps)`,
  )

  // 3. Control round trip. A center tap on the home screen is the least
  //    consequential input available; it is still an input, so this suite is
  //    documented as emulator-first.
  const tapStartedAt = Date.now()
  await host.tap(serial, 0.5, 0.5)
  step('input tap round-trips', true, `${Date.now() - tapStartedAt} ms`)

  const rotation = await host.getRotation(serial)
  step('the display rotation reads back', [0, 1, 2, 3].includes(rotation), `user_rotation=${rotation}`)

  const shot = await host.screenshot(serial)
  step(
    'screencap returns a decodable PNG',
    shot.png.length > 1_000 && shot.png.readUInt32BE(0) === 0x89504e47,
    `${shot.png.length} bytes ${shot.width}x${shot.height}`,
  )

  release()
} finally {
  await host.dispose()
}

step('dispose stops the stream', host.running === false)

finish()
