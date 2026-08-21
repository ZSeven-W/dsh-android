/**
 * Debugging & memory diagnostics for the Android plugin: processes, stack
 * dumps, memory, and package facts.
 *
 * The dsh-ios twin drives lldb/leaks/sample on a Mac-hosted simulator. None of
 * that has an adb equivalent an unprivileged shell can reach, so the honesty
 * rule from that module is the load-bearing part here: every result NAMES the
 * engine that produced it and what that engine cannot see. An agent that reads
 * an empty backtrace as "the app has no stack" is the failure this closes.
 *
 * - `android_processes` — `ps -A -o PID,NAME`, filtered.
 * - `android_backtrace` — `kill -3 <pid>` asks ART to dump every thread's
 *   stack into `/data/anr/`. The adb shell user (uid 2000) may send the signal
 *   only to processes it can signal, and `/data/anr` is `system:system 0770`,
 *   so on a production phone BOTH steps usually fail. The tool then degrades
 *   to the `crash` log buffer and says so in `engine`, rather than returning
 *   an empty stack that reads like "no crash happened".
 * - `android_meminfo` — `dumpsys meminfo <pkg>`: TOTAL PSS plus the App
 *   Summary categories. The counterpart of ios_sim_leaks's summary mode.
 * - `android_app_info` — `dumpsys package <pkg>`. A package that is NOT
 *   installed is a normal answer (`installed:false` + a note), not an error:
 *   the caller asked a question and got a fact.
 * @module @zseven-w/dsh-android/tool-debug
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AndroidHostController } from './android-host.js'
import {
  DEBUG_MAX_BUFFER,
  MAX_BACKTRACE_LINES,
  capBacktrace,
  firstThreadBlock,
  parseMeminfo,
  parsePackageInfo,
  parseProcessTable,
  readNewestAnrTrace,
  type AndroidProcess,
  type MemoryCategory,
} from './debug-parse.js'
import type { AndroidDeviceInfo } from './tools.js'

// The parsers (and the one ANR-trace read) live in ./debug-parse.js; they are
// re-exported here so `./tool-debug.js` stays the single import path for the
// debug layer, exactly like ./tools.js is for the core tools.
export {
  capBacktrace,
  parseMeminfo,
  parsePackageInfo,
  parseProcessTable,
  type AndroidProcess,
  type MemoryCategory,
} from './debug-parse.js'

/** Registered tool names, in registration order. */
export const ANDROID_DEBUG_TOOL_NAMES = [
  'android_processes',
  'android_backtrace',
  'android_meminfo',
  'android_app_info',
] as const

/** Timeout for one dumpsys/ps/logcat round trip. */
const DEBUG_TIMEOUT_MS = 60_000

const BACKTRACE_TRUNCATION_HINT = '[dsh-android: backtrace truncated at ~200 lines — pass all_threads:false '
  + 'for just the main thread]'
/** What a not-installed answer must say instead of leaving a guess standing. */
const APP_LIST_HINT = 'run android_list_apps to see what is installed'

/** How a backtrace was actually produced — never implied, always reported. */
export type BacktraceEngine = 'anr-trace' | 'logcat-crash'

export interface AndroidDebugToolsOptions {
  /** Plugin-owned cache root (accepted for symmetry; nothing is written yet). */
  cacheDir?: string
  /** Hard deadline for one debug round trip (default 60000 ms, min 1000). */
  timeoutMs?: number
}

export interface AndroidProcessesResult {
  device: AndroidDeviceInfo
  count: number
  processes: AndroidProcess[]
  /** Set when a filter matched nothing, explaining what was searched. */
  hint?: string
}

export interface AndroidBacktraceResult {
  device: AndroidDeviceInfo
  /** Pid the dump was requested for, when one was resolved. */
  pid?: number
  packageName?: string
  /** Which mechanism produced `lines` — read this before trusting them. */
  engine: BacktraceEngine
  allThreads: boolean
  lineCount: number
  truncated: boolean
  lines: string[]
  /** ANR trace file the dump was read from, when one was readable. */
  tracePath?: string
  /** What the engine could NOT do (permission, missing trace, …). */
  note?: string
}

export interface AndroidMeminfoResult {
  device: AndroidDeviceInfo
  packageName: string
  pid?: number
  /** TOTAL PSS in kilobytes — the number to watch over time. */
  totalPssKb: number
  totalRssKb?: number
  totalSwapPssKb?: number
  javaHeapKb?: number
  nativeHeapKb?: number
  codeKb?: number
  stackKb?: number
  graphicsKb?: number
  /** Largest mapping categories from the detail table, biggest first. */
  topCategories: MemoryCategory[]
  /** Set when the process was not running or the dump was partial. */
  note?: string
}

export interface AndroidAppInfoResult {
  device: AndroidDeviceInfo
  packageName: string
  installed: boolean
  version?: string
  versionCode?: number
  minSdk?: number
  targetSdk?: number
  /** Writable data directory (`/data/user/0/<pkg>`). */
  dataDir?: string
  /** Installed APK directory. */
  codePath?: string
  firstInstallTime?: string
  lastUpdateTime?: string
  /** Which installer recorded the package (`com.android.vending`, `null`, …). */
  installerPackage?: string
  /** True for a preinstalled/system package. */
  system?: boolean
  /** True when the package is currently running. */
  running?: boolean
  pid?: number
  /** Set when the package is NOT installed: what to run instead of guessing. */
  note?: string
}

/** The four debug tool definitions bound to one host controller. */
export interface AndroidDebugTools {
  androidProcesses: ToolDefinition
  androidBacktrace: ToolDefinition
  androidMeminfo: ToolDefinition
  androidAppInfo: ToolDefinition
  /** Abandon anything still in flight (mirrors the dsh-ios debug contract). */
  dispose(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** Package names accepted by the debug tools (an adb shell arg, not a path). */
const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/

function requirePackage(tool: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') {
    throw new Error(`${tool}: package_name is required, e.g. "com.android.settings" — ${APP_LIST_HINT}`)
  }
  if (!PACKAGE_PATTERN.test(trimmed)) {
    throw new Error(
      `${tool}: ${JSON.stringify(trimmed)} is not a valid Android package name (expected dotted segments `
      + `like "com.example.app") — ${APP_LIST_HINT}`,
    )
  }
  return trimmed
}


/** Create the four `android_*` debug tool definitions bound to one host. */
export function createAndroidDebugTools(
  host: AndroidHostController,
  options: AndroidDebugToolsOptions = {},
): AndroidDebugTools {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEBUG_TIMEOUT_MS)
  let disposed = false

  /** Resolve the device and its summary, or throw with the tool prefix. */
  const target = async (tool: string, serial: string | undefined): Promise<{ serial: string; device: AndroidDeviceInfo }> => {
    if (!host.available) {
      throw new Error(
        `${tool}: adb is unavailable — ${host.toolchain.binary.reason ?? 'adb was not found'}. Install the `
        + 'Android SDK platform-tools, put adb on PATH, or set the ADB environment variable, then retry.',
      )
    }
    if (disposed) throw new Error(`${tool}: the plugin is shutting down`)
    let device
    try {
      device = await host.resolveTarget(serial === undefined || serial.trim() === '' ? undefined : serial.trim())
    } catch (error) {
      throw new Error(`${tool}: ${errorMessage(error).replace(/^dsh-android: /, '')}`)
    }
    const details = await host.toolchain.deviceDetails(device).catch(() => undefined)
    return {
      serial: device.serial,
      device: {
        serial: device.serial,
        name: details?.model ?? device.model ?? device.serial,
        androidVersion: details?.androidVersion ?? '',
        state: device.state,
      },
    }
  }

  /** `pidof -s <pkg>`, or undefined when the package is not running. */
  const pidOf = async (serial: string, packageName: string): Promise<number | undefined> => {
    const output = await host.toolchain.shell(serial, ['pidof', '-s', packageName], { timeoutMs })
      .catch(() => '')
    const pid = Number(output.trim().split(/\s+/)[0])
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
  }

  const androidProcesses = defineTool({
    name: 'android_processes',
    description: 'List the processes running on a device (`ps -A`): pid and process name. App processes are '
      + 'named after their package (or `<package>:<process>` for a declared sub-process), so this is how you '
      + 'confirm an app is actually running and find the pid other tools want. Filter with a case-insensitive '
      + 'substring. A failed listing throws with the reason rather than returning an empty list.',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      filter: {
        type: 'string',
        description: 'Case-insensitive substring matched against the process name, e.g. "com.example" or '
          + '"systemui". Omit to list everything (a device runs several hundred processes).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          count: { type: 'integer', required: true },
          processes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pid: { type: 'integer', required: true },
                name: { type: 'string', required: true },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args: { device?: string; filter?: string }) {
      const { serial, device } = await target('android_processes', args.device)
      let stdout: string
      try {
        stdout = await host.toolchain.shell(serial, ['ps', '-A', '-o', 'PID,NAME'], { timeoutMs })
      } catch (error) {
        throw new Error(`android_processes: \`ps -A\` on ${serial} failed: ${errorMessage(error)}`)
      }
      let processes: AndroidProcess[]
      try {
        processes = parseProcessTable(stdout)
      } catch (error) {
        throw new Error(`android_processes: ${errorMessage(error)}`)
      }
      const filter = args.filter?.trim().toLowerCase() ?? ''
      const matched = filter === ''
        ? processes
        : processes.filter(entry => entry.name.toLowerCase().includes(filter))
      const hint = matched.length === 0 && filter !== ''
        ? `no process name contains "${args.filter?.trim()}" — the listing succeeded and reported `
          + `${processes.length} processes, so the app is NOT running (launch it with android_launch_app); `
          + 'note that an app process is named after its package, not its display name'
        : undefined
      return {
        device,
        count: matched.length,
        processes: matched,
        ...(hint === undefined ? {} : { hint }),
      } satisfies AndroidProcessesResult
    },
    presentCall: (args: { filter?: string }) => ({
      card: 'generic',
      title: args.filter === undefined || args.filter.trim() === ''
        ? 'List Android processes'
        : `List Android processes matching "${args.filter.trim()}"`,
      kind: 'execute',
    }),
  })

  const androidBacktrace = defineTool({
    name: 'android_backtrace',
    description: 'Capture stack traces for an app. Asks ART to dump every thread (`kill -3`, the same '
      + 'mechanism that produces an ANR trace) and reads the newest file from /data/anr/. On most PRODUCTION '
      + 'devices the adb shell user may neither signal another app nor read that directory, so the tool then '
      + 'degrades to the crash log buffer (`logcat -b crash`) and reports engine:"logcat-crash" — always read '
      + '`engine` and `note` before concluding anything: a logcat-crash result shows the LAST CRASH, not the '
      + 'current stacks, and an empty one means "no crash was recorded", never "the app has no stack". '
      + 'Emulators and rooted/debuggable builds usually get the real engine:"anr-trace".',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      package_name: {
        type: 'string',
        description: 'Android package to dump, e.g. "com.example.app". Its pid is resolved with `pidof -s`; '
          + 'when the app is not running only the crash buffer can answer.',
      },
      pid: {
        type: 'number',
        description: 'Explicit pid to signal (from android_processes), overriding package_name resolution.',
      },
      all_threads: {
        type: 'boolean',
        description: 'Keep every thread’s stack (default true). false keeps roughly the first thread block, '
          + 'which is usually the main thread.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          pid: { type: 'integer' },
          packageName: { type: 'string' },
          engine: { type: 'string', required: true, enum: ['anr-trace', 'logcat-crash'] },
          allThreads: { type: 'boolean', required: true },
          lineCount: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          lines: { type: 'array', required: true, items: { type: 'string' } },
          tracePath: { type: 'string' },
          note: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    async execute(args: { device?: string; package_name?: string; pid?: number; all_threads?: boolean }) {
      const { serial, device } = await target('android_backtrace', args.device)
      const allThreads = args.all_threads !== false
      const packageName = args.package_name?.trim() === '' || args.package_name === undefined
        ? undefined
        : requirePackage('android_backtrace', args.package_name)
      let pid: number | undefined
      if (typeof args.pid === 'number' && Number.isSafeInteger(args.pid) && args.pid > 0) pid = args.pid
      else if (packageName !== undefined) pid = await pidOf(serial, packageName)
      if (pid === undefined && packageName === undefined) {
        throw new Error(
          'android_backtrace: pass package_name (e.g. "com.example.app") or an explicit pid from '
          + 'android_processes — there is nothing to dump otherwise',
        )
      }

      const notes: string[] = []
      if (pid !== undefined) {
        // `kill -3` is a REQUEST: ART writes the trace asynchronously, and the
        // shell user may not be allowed to signal the target at all.
        const killed = await host.toolchain.shell(serial, ['kill', '-3', String(pid)], { timeoutMs })
          .then(output => (/not permitted|No such process|Permission denied/i.test(output) ? output.trim() : undefined))
          .catch(error => errorMessage(error))
        if (killed !== undefined) {
          notes.push(`\`kill -3 ${pid}\` was refused (${killed.split('\n')[0]}) — the adb shell user may only `
            + 'signal processes it owns, which on a production build excludes other apps')
        } else {
          // ART needs a moment to finish writing the trace.
          await new Promise(resolve => setTimeout(resolve, 1_200))
          const trace = await readNewestAnrTrace(host, serial, timeoutMs)
          if (trace !== undefined) {
            const relevant = allThreads ? trace.lines : firstThreadBlock(trace.lines)
            const { lines, truncated } = capBacktrace(relevant)
            const lineCount = lines.length
            if (truncated) lines.push(BACKTRACE_TRUNCATION_HINT)
            return {
              device,
              ...(pid === undefined ? {} : { pid }),
              ...(packageName === undefined ? {} : { packageName }),
              engine: 'anr-trace' as const,
              allThreads,
              lineCount,
              truncated,
              lines,
              tracePath: trace.path,
              ...(notes.length === 0 ? {} : { note: notes.join('; ') }),
            } satisfies AndroidBacktraceResult
          }
          notes.push('/data/anr is not readable by the adb shell user (it is system:system 0770 on a '
            + 'production build), so the dump ART just wrote cannot be fetched')
        }
      } else {
        notes.push(`no running process was found for ${packageName ?? 'the requested app'}, so no live stack `
          + 'could be dumped')
      }

      // Degrade honestly: the crash buffer is what remains.
      const crash = await host.toolchain.shell(serial, [
        'logcat', '-b', 'crash', '-d', '-v', 'time',
      ], { timeoutMs, maxBuffer: DEBUG_MAX_BUFFER }).catch(error => {
        throw new Error(
          `android_backtrace: neither an ANR trace nor the crash buffer could be read on ${serial}: `
          + `${errorMessage(error)} (${notes.join('; ')})`,
        )
      })
      const filtered = crash.split('\n')
        .filter(line => line.trim() !== '' && !/^-{5,}\s*beginning of /.test(line))
        .filter(line => packageName === undefined || line.includes(packageName) || /AndroidRuntime|DEBUG|libc/.test(line))
      // The newest crash is at the END of the buffer, so keep the tail here
      // (unlike a stack dump, where the head is the innermost frame).
      const tail = filtered.slice(-MAX_BACKTRACE_LINES)
      const truncated = filtered.length > tail.length
      const lines = [...tail]
      const lineCount = lines.length
      if (truncated) lines.push(BACKTRACE_TRUNCATION_HINT)
      notes.push('engine "logcat-crash" shows the LAST RECORDED CRASH from the crash buffer, not the app’s '
        + 'current stacks; an empty result means no crash was recorded, not that the app is healthy')
      return {
        device,
        ...(pid === undefined ? {} : { pid }),
        ...(packageName === undefined ? {} : { packageName }),
        engine: 'logcat-crash' as const,
        allThreads,
        lineCount,
        truncated,
        lines,
        note: notes.join('; '),
      } satisfies AndroidBacktraceResult
    },
    presentCall: (args: { package_name?: string; pid?: number }) => ({
      card: 'generic',
      title: `Backtrace ${args.package_name ?? (args.pid === undefined ? 'app' : `pid ${args.pid}`)}`,
      kind: 'execute',
    }),
  })

  const androidMeminfo = defineTool({
    name: 'android_meminfo',
    description: 'Read an app’s memory usage (`dumpsys meminfo <package>`): TOTAL PSS in kilobytes plus the '
      + 'App Summary breakdown (Java heap, native heap, code, stack, graphics) and the largest mapping '
      + 'categories. PSS is the number to watch across repeated calls — a steadily climbing TOTAL PSS while '
      + 'the app sits idle is the Android shape of a leak. The app must be RUNNING; when it is not, the tool '
      + 'says so instead of reporting zero.',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      package_name: {
        type: 'string',
        required: true,
        description: 'Android package to measure, e.g. "com.example.app".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          packageName: { type: 'string', required: true },
          pid: { type: 'integer' },
          totalPssKb: { type: 'integer', required: true },
          totalRssKb: { type: 'integer' },
          totalSwapPssKb: { type: 'integer' },
          javaHeapKb: { type: 'integer' },
          nativeHeapKb: { type: 'integer' },
          codeKb: { type: 'integer' },
          stackKb: { type: 'integer' },
          graphicsKb: { type: 'integer' },
          topCategories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                pssKb: { type: 'integer', required: true },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args: { device?: string; package_name: string }) {
      const { serial, device } = await target('android_meminfo', args.device)
      const packageName = requirePackage('android_meminfo', args.package_name)
      let stdout: string
      try {
        stdout = await host.toolchain.shell(serial, ['dumpsys', 'meminfo', packageName], {
          timeoutMs,
          maxBuffer: DEBUG_MAX_BUFFER,
        })
      } catch (error) {
        throw new Error(`android_meminfo: \`dumpsys meminfo ${packageName}\` on ${serial} failed: ${errorMessage(error)}`)
      }
      if (/No process found for/i.test(stdout)) {
        throw new Error(
          `android_meminfo: no running process for "${packageName}" on ${serial} — meminfo measures a LIVE `
          + `process, so launch the app first (android_launch_app), then retry. ${APP_LIST_HINT} if the `
          + 'package name itself may be wrong.',
        )
      }
      const parsed = parseMeminfo(stdout)
      if (parsed === undefined) {
        throw new Error(
          `android_meminfo: \`dumpsys meminfo ${packageName}\` produced output without a TOTAL PSS line — `
          + `the dump FAILED or its shape is unknown on Android ${device.androidVersion || '(unknown)'}; `
          + `first lines: ${JSON.stringify(stdout.trim().slice(0, 200))}`,
        )
      }
      return { device, packageName, ...parsed } satisfies AndroidMeminfoResult
    },
    presentCall: (args: { package_name: string }) => ({
      card: 'generic',
      title: `Memory of ${args.package_name}`,
      kind: 'execute',
    }),
  })

  const androidAppInfo = defineTool({
    name: 'android_app_info',
    description: 'Read the facts a device records about an installed package (`dumpsys package`): version '
      + 'name and code, min/target SDK, data directory, APK path, install and update times, the installer, '
      + 'and whether it is a system package — plus whether it is running right now. A package that is NOT '
      + 'installed is a normal answer (installed:false with a note), never an error, so this is the cheap way '
      + 'to check a package name before acting on it.',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      package_name: {
        type: 'string',
        required: true,
        description: 'Android package to inspect, e.g. "com.android.settings".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          packageName: { type: 'string', required: true },
          installed: { type: 'boolean', required: true },
          version: { type: 'string' },
          versionCode: { type: 'integer' },
          minSdk: { type: 'integer' },
          targetSdk: { type: 'integer' },
          dataDir: { type: 'string' },
          codePath: { type: 'string' },
          firstInstallTime: { type: 'string' },
          lastUpdateTime: { type: 'string' },
          installerPackage: { type: 'string' },
          system: { type: 'boolean' },
          running: { type: 'boolean' },
          pid: { type: 'integer' },
          note: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args: { device?: string; package_name: string }) {
      const { serial, device } = await target('android_app_info', args.device)
      const packageName = requirePackage('android_app_info', args.package_name)
      let stdout: string
      try {
        stdout = await host.toolchain.shell(serial, ['dumpsys', 'package', packageName], {
          timeoutMs,
          maxBuffer: DEBUG_MAX_BUFFER,
        })
      } catch (error) {
        throw new Error(`android_app_info: \`dumpsys package ${packageName}\` on ${serial} failed: ${errorMessage(error)}`)
      }
      const parsed = parsePackageInfo(stdout, packageName)
      if (parsed === undefined) {
        // NOT installed is a fact, not a failure — the caller asked a question.
        return {
          device,
          packageName,
          installed: false,
          note: `no package "${packageName}" is installed on ${serial} — ${APP_LIST_HINT} (a package name `
            + 'cannot be guessed from an app’s display name)',
        } satisfies AndroidAppInfoResult
      }
      const pid = await pidOf(serial, packageName)
      return {
        device,
        packageName,
        installed: true,
        ...parsed,
        running: pid !== undefined,
        ...(pid === undefined ? {} : { pid }),
      } satisfies AndroidAppInfoResult
    },
    presentCall: (args: { package_name: string }) => ({
      card: 'generic',
      title: `Package info for ${args.package_name}`,
      kind: 'execute',
    }),
  })

  return {
    androidProcesses,
    androidBacktrace,
    androidMeminfo,
    androidAppInfo,
    dispose(): void {
      // Every debug verb here is a bounded `adb shell` round trip owned by
      // AdbToolchain (execFile with its own timeout kills the child), so there
      // is no long-lived process to reap the way the dsh-ios twin reaps lldb.
      // The flag is what matters: it stops a NEW call from starting mid
      // teardown, while an in-flight execFile settles on its own timeout.
      disposed = true
    },
  }
}
