/**
 * Static smoke for `android_logs` — no real device.
 *
 * Two halves. The first exercises the pure pieces (the capped tail ring, the
 * duration/window validators, the grep compiler) because those are what stand
 * between a chatty device and a drowned model — an Android emulator idles at
 * hundreds of logcat lines a second, so the cap has to bite WHILE capturing,
 * not after. The second runs the whole tool against a fake `adb` on PATH,
 * which lets the assertions check the exact logcat argv a call built and, for
 * follow mode, that the child is actually reaped when the window closes.
 *
 * Run `pnpm run build` first — this suite imports the COMPILED lib/*.js.
 * When lib is missing it prints SKIP and exits 0.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createStepReporter, expectThrow, makeExec, withEnv } from './_smoke-harness.mjs'

const { step, finish } = createStepReporter()

/**
 * The fake adb. `logcat -d` prints a controllable number of lines; `logcat`
 * without `-d` streams until signalled and writes a marker file on exit, which
 * is how the follow test proves the process group was reaped.
 */
const FAKE_ADB = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const logPath = process.env.DSH_SMOKE_ADB_LOG
if (logPath) appendFileSync(logPath, JSON.stringify(argv) + '\\n')

let rest = argv
if (rest[0] === '-s') rest = rest.slice(2)
const out = text => process.stdout.write(text.endsWith('\\n') ? text : text + '\\n')
// Success paths NEVER call process.exit(): it discards buffered stdout on
// Linux pipes (CI saw 900 chatty lines arrive as 251). Letting the event
// loop drain flushes everything; \`handled\` guards the fallthrough.
let handled = false

if (rest[0] === 'devices') {
  out([
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:1',
    '',
  ].join('\\n'))
  handled = true
}
if (!handled && rest[0] === 'shell') {
  const command = rest.slice(1).join(' ')
  if (command.includes('getprop ro.product.model')) {
    out('sdk_gphone64_arm64\\nGoogle\\n14\\n34')
  } else if (command.startsWith('date -d @')) {
    if (process.env.DSH_SMOKE_NO_DATE === '1') {
      process.stderr.write('date: bad -d\\n')
      process.exit(1)
    }
    out('08-21 20:07:00.000')
  } else if (command.startsWith('pidof')) {
    out(process.env.DSH_SMOKE_PID ?? '')
  } else {
    process.stderr.write('fake-adb: unhandled shell ' + command + '\\n')
    process.exit(1)
  }
  handled = true
}
if (!handled && rest[0] === 'logcat') {
  const count = Number(process.env.DSH_SMOKE_LOG_LINES ?? '5')
  const line = index => '08-21 20:08:' + String(index % 60).padStart(2, '0')
    + '.000 I/Smoke( 1234): line ' + index
  if (rest.includes('-d')) {
    out('--------- beginning of main')
    for (let index = 0; index < count; index += 1) out(line(index))
  } else {
    // follow mode: stream until reaped, then record that we exited cleanly.
    const marker = process.env.DSH_SMOKE_FOLLOW_MARKER
    const stop = () => {
      if (marker) { try { writeFileSync(marker, 'reaped') } catch {} }
      process.stdout.end(() => process.exit(0))
    }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    let index = 0
    const timer = setInterval(() => { out(line(index)); index += 1 }, 30)
    setTimeout(() => { clearInterval(timer); stop() }, 20000).unref?.()
  }
  handled = true
}
if (!handled) {
  process.stderr.write('fake-adb: unhandled ' + JSON.stringify(argv) + '\\n')
  process.exit(1)
}
`

const shim = mkdtempSync(join(tmpdir(), 'dsh-android-logs-smoke-'))
const adbPath = join(shim, 'adb')
writeFileSync(adbPath, FAKE_ADB, { mode: 0o755 })
chmodSync(adbPath, 0o755)
const adbLog = join(shim, 'adb-calls.log')
writeFileSync(adbLog, '')
// Keep AVD discovery deterministic and offline (nothing here lists AVDs, but
// an ANDROID_HOME pointing at a real SDK would still be consulted).
mkdirSync(join(shim, 'emulator'), { recursive: true })

function calls() {
  return readFileSync(adbLog, 'utf8').split('\n').filter(line => line !== '').map(line => JSON.parse(line))
}

/** The last recorded `logcat` invocation, as one string. */
function lastLogcat() {
  const matches = calls().filter(argv => argv.includes('logcat'))
  const last = matches[matches.length - 1]
  return last === undefined ? undefined : last.slice(last.indexOf('logcat')).join(' ')
}

function reset() {
  writeFileSync(adbLog, '')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  let lib
  try {
    lib = await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href)
  } catch (error) {
    step('lib/index.js is built', 'SKIP', `import failed (${error?.message ?? error}) — run pnpm run build`)
    finish()
    return
  }
  const {
    AdbToolchain,
    AndroidHostController,
    LogLineRing,
    MAX_LOG_BYTES,
    MAX_LOG_LINES,
    compileGrep,
    createAndroidLogTools,
    durationSeconds,
    followSeconds,
    postProcess,
    snapshotDuration,
  } = lib

  // ── pure: the capped tail ring ─────────────────────────────────────────────
  const ring = new LogLineRing()
  for (let index = 0; index < MAX_LOG_LINES + 120; index += 1) {
    ring.push(Buffer.from(`08-21 20:08:00.000 I/Smoke( 1): line ${index}\n`, 'utf8'))
  }
  step('the ring keeps at most 300 lines and marks the capture truncated',
    ring.lines.length === MAX_LOG_LINES && ring.truncated === true,
    `${ring.lines.length} lines`)
  step('the ring keeps the TAIL (the newest lines survive)',
    ring.lines[ring.lines.length - 1].endsWith(`line ${MAX_LOG_LINES + 119}`),
    ring.lines[ring.lines.length - 1])

  const byteRing = new LogLineRing()
  // 40 lines of 2 KB each is 80 KB — well past the 30 KB budget, so the byte
  // cap must bite long before the 300-line cap would.
  for (let index = 0; index < 40; index += 1) {
    byteRing.push(Buffer.from(`${'x'.repeat(2048)}-${index}\n`, 'utf8'))
  }
  step('the ring enforces the 30 KB budget independently of the line count',
    byteRing.bytes <= MAX_LOG_BYTES && byteRing.lines.length < MAX_LOG_LINES && byteRing.truncated === true,
    `${byteRing.lines.length} lines / ${byteRing.bytes} bytes`)

  const partialRing = new LogLineRing()
  partialRing.push(Buffer.from('complete line\nthe last, unterminated line', 'utf8'))
  step('a follow window closed mid-line does not drop that line (flush)',
    (() => {
      const before = partialRing.lines.length
      partialRing.flush()
      return before === 1 && partialRing.lines.length === 2
        && partialRing.lines[1] === 'the last, unterminated line'
    })(), 'flush() appends the trailing partial')

  const bannerRing = new LogLineRing()
  bannerRing.push(Buffer.from('--------- beginning of main\nreal line\n', 'utf8'))
  step('logcat buffer separators are dropped, not counted as log lines',
    bannerRing.lines.length === 1 && bannerRing.lines[0] === 'real line', JSON.stringify(bannerRing.lines))

  // ── pure: window validation ────────────────────────────────────────────────
  step('snapshot durations accept the documented shapes and default to 2m',
    snapshotDuration(undefined) === '2m' && snapshotDuration('30s') === '30s' && snapshotDuration('1h') === '1h',
    '2m / 30s / 1h')
  step('snapshotDuration rejects everything outside ^\\d{1,4}[smh]$',
    ['abc', '2', '2d', '99999m'].every(bad => {
      try { snapshotDuration(bad); return false } catch { return true }
    }), 'abc / 2 / 2d / 99999m all throw')
  step('durations convert to seconds for the device-side start timestamp',
    durationSeconds('2m') === 120 && durationSeconds('30s') === 30 && durationSeconds('1h') === 3600,
    '2m=120s 1h=3600s')
  step('follow windows default to 10 s and clamp at 60 s',
    followSeconds(undefined) === 10 && followSeconds(5) === 5 && followSeconds(600) === 60,
    'clamped to 60')
  await expectThrow(step, 'a follow window below 1 s is refused',
    async () => followSeconds(0), /duration_seconds must be a number/)
  await expectThrow(step, 'an invalid grep regex fails loudly instead of matching nothing',
    async () => compileGrep('('), /not a valid regular expression/)
  step('postProcess applies the grep and re-asserts the cap',
    (() => {
      const capture = { lines: ['keep me', 'drop me', 'keep me too'], truncated: false }
      const result = postProcess(capture, compileGrep('keep'))
      return result.lines.length === 2 && result.truncated === false
    })(), 'grep only shrinks')

  // ── end to end against the fake adb ────────────────────────────────────────
  await withEnv({
    ADB: undefined,
    ANDROID_HOME: shim,
    ANDROID_SDK_ROOT: undefined,
    PATH: `${shim}${delimiter}${process.env.PATH ?? ''}`,
    DSH_SMOKE_ADB_LOG: adbLog,
    DSH_SMOKE_LOG_LINES: '5',
    DSH_SMOKE_NO_DATE: undefined,
    DSH_SMOKE_PID: undefined,
  }, async () => {
    const toolchain = new AdbToolchain()
    step('the fake adb resolves off PATH', toolchain.available && toolchain.binary.command === adbPath,
      toolchain.binary.source)
    const host = new AndroidHostController(toolchain, { idleTimeoutMs: 0 })
    const { androidLogs } = createAndroidLogTools(host)

    reset()
    const snapshot = await androidLogs.execute({}, makeExec('android_logs', {}))
    // The start timestamp comes from the DEVICE clock (the fake answers
    // 08-21 20:07:00.000), never from this host's — a phone in another
    // timezone would otherwise be handed a start time from the future.
    step('snapshot builds `logcat -d -v time -T <device timestamp>`',
      lastLogcat() === 'logcat -d -v time -T 08-21 20:07:00.000', lastLogcat())
    step('snapshot reports the window, the line count and the device',
      snapshot.mode === 'snapshot' && snapshot.window === 'last 2m'
      && snapshot.lineCount === 5 && snapshot.truncated === false
      && snapshot.device.serial === 'emulator-5554' && snapshot.device.androidVersion === '14',
      `${snapshot.lineCount} lines, window "${snapshot.window}"`)
    step('the buffer separator never reaches the model',
      snapshot.lines.every(line => !line.includes('beginning of')), `${snapshot.lines.length} lines`)

    reset()
    const filtered = await androidLogs.execute(
      { duration: '30s', grep: 'line 3' }, makeExec('android_logs', {}))
    step('the client-side grep drops non-matching lines',
      filtered.lineCount === 1 && filtered.lines[0].endsWith('line 3') && filtered.window === 'last 30s',
      JSON.stringify(filtered.lines))

    reset()
    const narrowed = await androidLogs.execute(
      { buffer: 'crash', tag: 'AndroidRuntime', priority: 'E' }, makeExec('android_logs', {}))
    step('buffer/tag/priority are assembled into the logcat filter spec',
      lastLogcat().includes('-b crash') && lastLogcat().includes('AndroidRuntime:E *:S'),
      lastLogcat())
    step('a narrowed snapshot still returns the standard shape',
      narrowed.mode === 'snapshot' && Array.isArray(narrowed.lines), `${narrowed.lineCount} lines`)

    // The cap must bite on a chatty device, and the hint must be attached
    // WITHOUT being counted as a log line.
    reset()
    await withEnv({ DSH_SMOKE_LOG_LINES: '900' }, async () => {
      const capped = await androidLogs.execute({}, makeExec('android_logs', {}))
      step('a chatty device is capped at 300 lines with an uncounted narrowing hint',
        capped.truncated === true
        && capped.lineCount === MAX_LOG_LINES
        && capped.lines.length === MAX_LOG_LINES + 1
        && capped.lines[capped.lines.length - 1].includes('output capped at 300 lines'),
        `${capped.lineCount} counted, ${capped.lines.length} returned`)
    })

    // A device whose clock cannot be read must SAY that the window changed
    // rather than silently returning a different span than was asked for.
    reset()
    await withEnv({ DSH_SMOKE_NO_DATE: '1' }, async () => {
      const fallback = await androidLogs.execute({}, makeExec('android_logs', {}))
      step('an unreadable device clock falls back to a line count and says so',
        lastLogcat().includes('-t 300') && typeof fallback.note === 'string'
        && fallback.note.includes('device clock could not be read'),
        lastLogcat())
    })

    // bundle_id needs a live pid; a stopped app gets the alternative, not zero
    // lines that read like "the app logged nothing".
    reset()
    await expectThrow(step, 'bundle_id on a stopped app names grep as the alternative',
      () => androidLogs.execute({ bundle_id: 'dev.example.demo' }, makeExec('android_logs', {})),
      /no running process for package "dev\.example\.demo".*grep="dev\.example\.demo"/s)
    reset()
    await withEnv({ DSH_SMOKE_PID: '4242' }, async () => {
      const scoped = await androidLogs.execute(
        { bundle_id: 'dev.example.demo' }, makeExec('android_logs', {}))
      step('bundle_id resolves a pid and limits the capture with --pid',
        lastLogcat().includes('--pid=4242') && scoped.pid === 4242, lastLogcat())
    })

    // follow: bounded window, and the child is really reaped.
    reset()
    const marker = join(shim, 'follow-reaped')
    rmSync(marker, { force: true })
    await withEnv({ DSH_SMOKE_FOLLOW_MARKER: marker }, async () => {
      const startedAt = Date.now()
      const followed = await androidLogs.execute(
        { mode: 'follow', duration_seconds: 1 }, makeExec('android_logs', {}))
      const elapsed = Date.now() - startedAt
      step('follow settles when its window closes (never a hanging stream)',
        followed.mode === 'follow' && followed.window === 'follow 1s'
        && elapsed >= 900 && elapsed < 10_000,
        `${elapsed} ms`)
      step('follow captured lines and streams without -d',
        followed.lineCount > 0 && !lastLogcat().includes(' -d '), lastLogcat())
      await sleep(300)
      step('the follow child is reaped by the process-group signal',
        existsSync(marker), existsSync(marker) ? 'marker written on SIGTERM' : 'child was left running')
    })

    // Aborting a call must not leave a logcat child behind either.
    reset()
    const aborter = new AbortController()
    const abortExec = { ...makeExec('android_logs', {}), signal: aborter.signal }
    const pending = androidLogs.execute({ mode: 'follow', duration_seconds: 30 }, abortExec)
    setTimeout(() => aborter.abort(new Error('smoke abort')), 300)
    await expectThrow(step, 'an aborted follow rejects rather than running its full window',
      () => pending, /smoke abort/)

    await host.dispose()
  })

  finish()
}

try {
  await main()
} finally {
  rmSync(shim, { recursive: true, force: true })
}
