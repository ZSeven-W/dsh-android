/**
 * Model-facing logcat capture for the Android plugin.
 *
 * `android_logs` wraps `adb logcat` in two bounded modes, the same contract
 * dsh-ios's `ios_sim_logs` offers over the unified log:
 *
 * - `snapshot`: the recent persisted ring (`logcat -d -v time -T <timestamp>`),
 *   where the timestamp is computed from the DEVICE clock — a phone in another
 *   timezone would otherwise be handed a start time from the future and return
 *   nothing;
 * - `follow`: a live capture window that returns everything accumulated once
 *   `duration_seconds` elapses — a bounded capture, never a hanging stream:
 *   the tool call settles when the window closes.
 *
 * Output is capped *while capturing* (a tail ring of ~300 lines / ~30 KB, plus
 * a one-line hint naming the narrowing params), so a chatty device can never
 * drown the model no matter how much it emits — and Android emits a lot: a
 * stock emulator idles at hundreds of lines a second.
 *
 * The spawned adb child is reaped on window close, on abort, and on the hard
 * safety deadline through a process-GROUP kill: `adb logcat` keeps a server
 * connection open, and killing only the direct child would leave the device
 * side streaming.
 * @module @zseven-w/dsh-android/tool-logs
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Readable } from 'node:stream'
import type { AndroidHostController } from './android-host.js'
import type { AndroidDeviceInfo } from './tools.js'

/** Output cap: keep the tail of at most ~300 lines / ~30 KB, always. */
export const MAX_LOG_LINES = 300
export const MAX_LOG_BYTES = 30 * 1024

const DEFAULT_SNAPSHOT_DURATION = '2m'
const DEFAULT_FOLLOW_SECONDS = 10
const MAX_FOLLOW_SECONDS = 60
/** SIGTERM → SIGKILL grace when reaping the logcat process group. */
const KILL_GRACE_MS = 2_000
/** Hard safety net so a stuck `logcat -d` can never outlive its budget. */
const SNAPSHOT_SAFETY_MS = 3 * 60 * 1000
/** Follow-mode safety net past its own window (kill is idempotent). */
const FOLLOW_SAFETY_GRACE_MS = 30_000
/** stderr diagnostics ring for failure messages. */
const STDERR_RING_LINES = 20
const STDERR_LINE_MAX_CHARS = 240
/** Timeout for the two small shell round trips (device clock, pidof). */
const HELPER_TIMEOUT_MS = 15_000

/** One-line narrowing hint appended to `lines` (uncounted) on truncation. */
const TRUNCATION_HINT = '[dsh-android: output capped at 300 lines / 30 KB — narrow with bundle_id, tag, '
  + 'priority, buffer or grep, or a shorter duration]'

const SNAPSHOT_DURATION_PATTERN = /^\d{1,4}[smh]$/u
const ANSI_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[A-Za-z]/gu
/** logcat prints these separators, not log lines; drop them. */
const BANNER_PATTERN = /^-{5,}\s*beginning of /u

/** Log buffers `logcat -b` accepts (the ones worth exposing). */
export const LOG_BUFFERS = ['main', 'system', 'crash', 'events', 'radio', 'all'] as const
export type AndroidLogBuffer = (typeof LOG_BUFFERS)[number]

/** logcat priority thresholds (`*:<P>`). */
export const LOG_PRIORITIES = ['V', 'D', 'I', 'W', 'E', 'F'] as const
export type AndroidLogPriority = (typeof LOG_PRIORITIES)[number]

export type AndroidLogsMode = 'snapshot' | 'follow'

export interface AndroidLogsArgs {
  device?: string
  mode?: AndroidLogsMode
  /** snapshot window, e.g. "2m", "30s", "1h". Default "2m". */
  duration?: string
  /** follow window in seconds, 1..60 (clamped). Default 10. */
  duration_seconds?: number
  /** Package whose process the capture is limited to (`--pid=$(pidof -s …)`). */
  bundle_id?: string
  /** logcat tag filter, e.g. "ActivityManager". */
  tag?: string
  /** Minimum priority; V D I W E F. */
  priority?: AndroidLogPriority
  /** Log buffer to read. */
  buffer?: AndroidLogBuffer
  /** Client-side regular expression applied to each captured line. */
  grep?: string
}

export interface AndroidLogsResult {
  device: AndroidDeviceInfo
  mode: AndroidLogsMode
  /** Human-readable capture window, e.g. "last 2m" or "follow 10s". */
  window: string
  /** Number of log lines returned (the truncation hint is not counted). */
  lineCount: number
  /** True when more log lines existed than were returned. */
  truncated: boolean
  /** Tail of captured lines; the final element is the hint when truncated. */
  lines: string[]
  /** Pid the capture was limited to, when bundle_id resolved one. */
  pid?: number
  /** How the capture was narrowed, when the device clock could not be read. */
  note?: string
}

/** The tool definition bound to one host controller. */
export interface AndroidLogTools {
  androidLogs: ToolDefinition
}

type LogChild = ChildProcessByStdio<null, Readable, Readable>

interface LogCapture {
  lines: string[]
  truncated: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stripAnsi(text: string): string {
  return ANSI_PATTERN.test(text) ? text.replace(ANSI_PATTERN, '') : text
}

function renderJson(_args: unknown, value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const deviceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serial: { type: 'string', required: true },
    name: { type: 'string', required: true },
    androidVersion: { type: 'string', required: true },
    state: { type: 'string', required: true },
  },
} as const

/**
 * Tail ring of cleaned log lines, capped by count AND byte budget WHILE
 * capturing. Ported unchanged in behaviour from dsh-ios tool-logs.ts: the cap
 * must bite during the capture, not after, or a `logcat -d` on a busy device
 * buffers megabytes before anyone can trim it.
 */
export class LogLineRing {
  lines: string[] = []
  bytes = 0
  truncated = false
  #partial = ''

  push(chunk: Buffer): void {
    const text = this.#partial + chunk.toString('utf8')
    const parts = text.split('\n')
    this.#partial = parts.pop() ?? ''
    for (const part of parts) this.#append(part)
    this.#trim()
  }

  /**
   * Flush the trailing unterminated line. A follow window is closed by
   * SIGTERM, so the capture routinely ends mid-line — without this the last
   * (often the most interesting) line was silently dropped.
   */
  flush(): void {
    if (this.#partial === '') return
    this.#append(this.#partial)
    this.#partial = ''
    this.#trim()
  }

  #append(part: string): void {
    const line = stripAnsi(part).replace(/\r$/, '').trimEnd()
    if (line === '' || BANNER_PATTERN.test(line)) return
    this.lines.push(line)
    this.bytes += Buffer.byteLength(line, 'utf8') + 1
  }

  #trim(): void {
    while (this.lines.length > MAX_LOG_LINES || this.bytes > MAX_LOG_BYTES) {
      const removed = this.lines.shift()
      if (removed === undefined) break
      this.bytes -= Buffer.byteLength(removed, 'utf8') + 1
      this.truncated = true
    }
  }
}

/**
 * Kill the whole adb child's process group. The child is spawned detached so
 * it leads its own group; signalling the group reaps the `adb` client before
 * it can be left holding an open logcat connection to the daemon.
 */
function signalProcessGroup(child: LogChild, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid === undefined) {
    child.kill(signal)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    child.kill(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error(
    `android_logs: capture aborted${typeof signal.reason === 'string' && signal.reason !== '' ? `: ${signal.reason}` : ''}`,
  )
}

interface RunLogOptions {
  adb: string
  serial: string
  /** Arguments after `adb -s <serial>`. */
  args: readonly string[]
  /** Follow-mode window: SIGTERM the child after this many ms (normal return). */
  windowMs?: number
  signal: AbortSignal
}

/**
 * Spawn `adb -s <serial> logcat …` and stream its stdout through the capped
 * ring until the window closes (follow), the child exits (snapshot), or the
 * caller's signal aborts. The child group is always reaped.
 */
export function runLogCapture(options: RunLogOptions): Promise<LogCapture> {
  const { adb, serial, args, windowMs, signal } = options
  if (signal.aborted) throw abortError(signal)
  const ring = new LogLineRing()
  const stderrRing: string[] = []
  let stderrPartial = ''
  const child: LogChild = spawn(adb, ['-s', serial, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Group leader so one kill reaps the adb client and anything it forked.
    detached: true,
  })
  child.stdout.on('data', (chunk: Buffer) => ring.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => {
    const text = stderrPartial + chunk.toString('utf8')
    const parts = text.split('\n')
    stderrPartial = parts.pop() ?? ''
    for (const raw of parts) {
      const line = stripAnsi(raw).trimEnd()
      if (line === '') continue
      stderrRing.push(line.length > STDERR_LINE_MAX_CHARS ? `${line.slice(0, STDERR_LINE_MAX_CHARS)}…` : line)
      if (stderrRing.length > STDERR_RING_LINES) stderrRing.shift()
    }
  })

  return new Promise<LogCapture>((resolve, reject) => {
    let settled = false
    let killedByUs = false
    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      if (windowTimer !== undefined) clearTimeout(windowTimer)
      clearTimeout(safetyTimer)
      signal.removeEventListener('abort', onAbort)
      finish()
    }
    const killTree = (graceMs: number): void => {
      killedByUs = true
      signalProcessGroup(child, 'SIGTERM')
      if (graceMs > 0) {
        const killer = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), graceMs)
        killer.unref?.()
      }
    }
    const onAbort = (): void => killTree(KILL_GRACE_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    const windowTimer = windowMs === undefined ? undefined : setTimeout(() => killTree(KILL_GRACE_MS), windowMs)
    // Hard safety net: no logcat child may outlive its budget, whatever happens.
    const safetyTimer = setTimeout(
      () => killTree(0),
      windowMs === undefined ? SNAPSHOT_SAFETY_MS : windowMs + FOLLOW_SAFETY_GRACE_MS,
    )
    child.once('error', error => {
      settle(() => reject(new Error(`android_logs: \`adb -s ${serial} ${args.join(' ')}\` failed to start: ${errorMessage(error)}`)))
    })
    child.once('close', code => {
      settle(() => {
        if (signal.aborted) {
          reject(abortError(signal))
          return
        }
        if (!killedByUs && code !== 0 && code !== null) {
          const detail = stderrRing.length === 0 ? '' : `: ${stderrRing.join('\n')}`
          reject(new Error(`android_logs: \`adb -s ${serial} ${args.join(' ')}\` failed (exit ${String(code)})${detail}`))
          return
        }
        ring.flush()
        resolve({ lines: [...ring.lines], truncated: ring.truncated })
      })
    })
  })
}

/** Validate the snapshot window and return it verbatim (default 2m). */
export function snapshotDuration(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return DEFAULT_SNAPSHOT_DURATION
  const trimmed = value.trim()
  if (!SNAPSHOT_DURATION_PATTERN.test(trimmed)) {
    throw new Error(`android_logs: duration must look like "2m", "30s", or "1h" (got ${JSON.stringify(value)})`)
  }
  return trimmed
}

/** `2m` → 120. The pattern above guarantees the shape. */
export function durationSeconds(duration: string): number {
  const unit = duration.slice(-1)
  const value = Number(duration.slice(0, -1))
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1
  return value * multiplier
}

/** Follow-mode window in seconds: integer ≥ 1, clamped to the 60 s maximum. */
export function followSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FOLLOW_SECONDS
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`android_logs: duration_seconds must be a number ≥ 1 (got ${JSON.stringify(value)})`)
  }
  return Math.min(Math.round(value), MAX_FOLLOW_SECONDS)
}

/** Client-side grep compiled once per call; invalid patterns fail loudly. */
export function compileGrep(value: string | undefined): RegExp | undefined {
  if (value === undefined || value.trim() === '') return undefined
  try {
    return new RegExp(value)
  } catch (error) {
    throw new Error(`android_logs: grep is not a valid regular expression: ${errorMessage(error)}`)
  }
}

/**
 * The `-T` start timestamp for a snapshot, computed ON THE DEVICE.
 *
 * logcat timestamps are in the device's local time with no zone marker, so a
 * start time computed from the HOST clock is silently wrong for any phone in
 * another timezone (and for an emulator whose clock has drifted) — usually far
 * enough in the future that the snapshot comes back empty, which reads like
 * "the app logged nothing". `seconds` is a validated integer, so the arithmetic
 * expansion below carries no untrusted text.
 */
export async function deviceStartTimestamp(
  host: AndroidHostController,
  serial: string,
  seconds: number,
): Promise<string | undefined> {
  try {
    const stamp = await host.toolchain.shell(serial, [
      `date -d @$(( $(date +%s) - ${Math.max(1, Math.round(seconds))} )) "+%m-%d %H:%M:%S.000"`,
    ], { timeoutMs: HELPER_TIMEOUT_MS })
    const line = stamp.split('\n').map(part => part.trim()).find(part => /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(part))
    return line
  } catch {
    // Some toybox builds refuse `date -d @…`; the caller falls back to -t.
    return undefined
  }
}

/** Resolve a package's pid for `--pid=`, or throw with what to do instead. */
export async function resolvePackagePid(
  host: AndroidHostController,
  serial: string,
  packageName: string,
): Promise<number> {
  const output = await host.toolchain.shell(serial, ['pidof', '-s', packageName], { timeoutMs: HELPER_TIMEOUT_MS })
    .catch(() => '')
  const pid = Number(output.trim().split(/\s+/)[0])
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(
      `android_logs: no running process for package "${packageName}" on ${serial} — logcat can only filter `
      + 'by PID, and a stopped app has none. Launch it first (android_launch_app), or drop bundle_id and '
      + `use grep="${packageName}" to match the package name inside the lines instead.`,
    )
  }
  return pid
}

/**
 * Apply the client-side grep, then re-assert the cap defensively (grep can
 * only shrink the ring, so this is a no-op unless a stray line is oversized).
 */
export function postProcess(capture: LogCapture, grep: RegExp | undefined): { lines: string[]; truncated: boolean } {
  const lines = grep === undefined ? [...capture.lines] : capture.lines.filter(line => line.search(grep) !== -1)
  let truncated = capture.truncated
  let bytes = 0
  for (const line of lines) bytes += Buffer.byteLength(line, 'utf8') + 1
  while (lines.length > MAX_LOG_LINES || bytes > MAX_LOG_BYTES) {
    const removed = lines.shift()
    if (removed === undefined) break
    bytes -= Buffer.byteLength(removed, 'utf8') + 1
    truncated = true
  }
  return { lines, truncated }
}

/** Create the `android_logs` tool definition bound to one host controller. */
export function createAndroidLogTools(host: AndroidHostController): AndroidLogTools {
  const androidLogs = defineTool({
    name: 'android_logs',
    description: 'Read what an Android app prints while it runs, from logcat. Two bounded modes: snapshot '
      + 'reads the recent persisted ring (`logcat -d -v time` from a start timestamp computed on the DEVICE '
      + 'clock, default the last 2m); follow captures live output for `duration_seconds` (default 10, max '
      + '60) and returns everything accumulated when the window closes — never an unbounded stream. Narrow '
      + 'with bundle_id (limits the capture to that package’s running process via --pid), a tag, a minimum '
      + 'priority, a buffer (main/system/crash/events/radio/all), and a client-side `grep` regex. Output is '
      + 'capped at ~300 lines / 30 KB (tail kept; truncated:true plus a narrowing hint when the cap bites) — '
      + 'an idle emulator emits hundreds of lines a second, so narrow before widening the window. To read a '
      + 'crash specifically, use buffer:"crash".',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      mode: {
        type: 'string',
        enum: ['snapshot', 'follow'],
        description: 'snapshot: the recent persisted ring (default). follow: bounded live capture for '
          + 'duration_seconds, then return.',
      },
      duration: {
        type: 'string',
        description: 'Snapshot window, e.g. "2m", "30s", "1h" (default "2m"). Ignored in follow mode.',
      },
      duration_seconds: {
        type: 'number',
        description: 'Follow capture window in seconds, 1..60 (default 10; larger values are clamped). '
          + 'Ignored in snapshot mode.',
      },
      bundle_id: {
        type: 'string',
        description: 'Android package name whose process the capture is limited to, e.g. '
          + '"com.example.app". Resolved to a pid with `pidof -s` and passed as --pid, so the app must be '
          + 'RUNNING; when it is not, the tool says so and suggests grep instead of returning nothing.',
      },
      tag: {
        type: 'string',
        description: 'logcat tag filter, e.g. "ActivityManager" — only lines from that tag are kept '
          + '(combined with priority as `<tag>:<priority> *:S`).',
      },
      priority: {
        type: 'string',
        enum: [...LOG_PRIORITIES],
        description: 'Minimum priority: V(erbose) D(ebug) I(nfo) W(arn) E(rror) F(atal). Default keeps '
          + 'everything the buffer holds.',
      },
      buffer: {
        type: 'string',
        enum: [...LOG_BUFFERS],
        description: 'Log buffer to read (default: logcat’s own main+system+crash). Use "crash" to read '
          + 'only fatal Java/native crashes, "events" for system events, "all" for everything.',
      },
      grep: {
        type: 'string',
        description: 'Client-side regular expression applied to each captured line after the window '
          + 'closes; non-matching lines are dropped.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          mode: { type: 'string', required: true, enum: ['snapshot', 'follow'] },
          window: { type: 'string', required: true },
          lineCount: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          lines: { type: 'array', required: true, items: { type: 'string' } },
          pid: { type: 'integer' },
          note: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 300_000,
    isConcurrencySafe: () => true,
    async execute(args: AndroidLogsArgs, exec) {
      if (!host.available) {
        throw new Error(
          `android_logs: adb is unavailable — ${host.toolchain.binary.reason ?? 'adb was not found'}. Install `
          + 'the Android SDK platform-tools, put adb on PATH, or set the ADB environment variable, then retry.',
        )
      }
      const adb = host.toolchain.requireAdb()
      const target = await host.resolveTarget(
        args.device === undefined || args.device.trim() === '' ? undefined : args.device.trim(),
      ).catch((error: unknown) => {
        throw new Error(`android_logs: ${errorMessage(error).replace(/^dsh-android: /, '')}`)
      })
      const details = await host.toolchain.deviceDetails(target).catch(() => undefined)
      const device: AndroidDeviceInfo = {
        serial: target.serial,
        name: details?.model ?? target.model ?? target.serial,
        androidVersion: details?.androidVersion ?? '',
        state: target.state,
      }
      const mode: AndroidLogsMode = args.mode ?? 'snapshot'
      const grep = compileGrep(args.grep)
      const filters: string[] = []
      if (args.buffer !== undefined) filters.push('-b', args.buffer)
      let pid: number | undefined
      if (args.bundle_id !== undefined && args.bundle_id.trim() !== '') {
        pid = await resolvePackagePid(host, target.serial, args.bundle_id.trim())
        filters.push(`--pid=${pid}`)
      }
      // A tag filter is a trailing `<tag>:<priority>` spec plus `*:S` to
      // silence everything else; a bare priority is `*:<P>`.
      const priority = args.priority ?? 'V'
      const tagSpec: string[] = args.tag !== undefined && args.tag.trim() !== ''
        ? [`${args.tag.trim()}:${priority}`, '*:S']
        : args.priority === undefined ? [] : [`*:${priority}`]

      let capture: LogCapture
      let window: string
      let note: string | undefined
      if (mode === 'follow') {
        const seconds = followSeconds(args.duration_seconds)
        capture = await runLogCapture({
          adb,
          serial: target.serial,
          args: ['logcat', '-v', 'time', ...filters, ...tagSpec],
          windowMs: seconds * 1000,
          signal: exec.signal,
        })
        window = `follow ${seconds}s`
      } else {
        const duration = snapshotDuration(args.duration)
        const since = await deviceStartTimestamp(host, target.serial, durationSeconds(duration))
        const bounds = since === undefined
          ? ['-t', String(MAX_LOG_LINES)]
          : ['-T', since]
        if (since === undefined) {
          note = `the device clock could not be read, so the snapshot is the last ${MAX_LOG_LINES} lines `
            + `rather than the last ${duration}`
        }
        capture = await runLogCapture({
          adb,
          serial: target.serial,
          args: ['logcat', '-d', '-v', 'time', ...bounds, ...filters, ...tagSpec],
          signal: exec.signal,
        })
        window = `last ${duration}`
      }

      const { lines, truncated } = postProcess(capture, grep)
      const lineCount = lines.length
      if (truncated) lines.push(TRUNCATION_HINT)
      return {
        device,
        mode,
        window,
        lineCount,
        truncated,
        lines,
        ...(pid === undefined ? {} : { pid }),
        ...(note === undefined ? {} : { note }),
      } satisfies AndroidLogsResult
    },
    presentCall: (args: AndroidLogsArgs) => ({
      card: 'generic',
      title: args.mode === 'follow' ? 'Follow Android logs' : 'Read Android logs',
      kind: 'execute',
    }),
  })

  return { androidLogs }
}
