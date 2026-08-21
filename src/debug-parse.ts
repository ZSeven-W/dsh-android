/**
 * Pure parsers for the Android debug tools, plus the one ANR-trace read that
 * has to touch the device.
 *
 * Split out of tool-debug.ts for the 800-line file rule, and it earns the
 * split: `ps`, `dumpsys meminfo` and `dumpsys package` all have shapes that
 * drift between Android versions, so having them here — as pure functions over
 * a captured string — is what lets the smoke feed recorded output through them
 * without a device.
 * @module @zseven-w/dsh-android/debug-parse
 */

import type { AndroidHostController } from './android-host.js'

/** Backtrace output cap: ~200 stack lines. */
export const MAX_BACKTRACE_LINES = 200
/** Top memory categories kept in a meminfo summary. */
export const MAX_TOP_CATEGORIES = 12
/** `dumpsys meminfo`/`package` outputs are small; ANR traces are not. */
export const DEBUG_MAX_BUFFER = 32 * 1024 * 1024

/** One running process as `ps -A` reports it. */
export interface AndroidProcess {
  pid: number
  name: string
}

/** One line of the `dumpsys meminfo` detail table. */
export interface MemoryCategory {
  name: string
  /** Proportional set size in kilobytes. */
  pssKb: number
}

/** Everything `parseMeminfo` can recover from one dump. */
export interface MeminfoFacts {
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
}

/** Everything `parsePackageInfo` can recover from one `Package [...]` block. */
export interface PackageFacts {
  version?: string
  versionCode?: number
  minSdk?: number
  targetSdk?: number
  dataDir?: string
  codePath?: string
  firstInstallTime?: string
  lastUpdateTime?: string
  installerPackage?: string
  system?: boolean
}

/** `ps -A -o PID,NAME` → sorted processes. Throws on an unparseable dump. */
export function parseProcessTable(stdout: string): AndroidProcess[] {
  const processes: AndroidProcess[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = /^(\d+)\s+(.+?)\s*$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    processes.push({ pid, name: match[2]! })
  }
  if (processes.length === 0) {
    throw new Error(
      'could not parse the `ps -A` output — it carried no process rows; the listing FAILED, which is not '
      + 'the same as the device having no processes',
    )
  }
  return processes.sort((a, b) => a.pid - b.pid)
}

/**
 * Parse `dumpsys meminfo <pkg>`. Two tables matter: the detail table (one row
 * per mapping category, first numeric column = Pss Total) and the App Summary
 * block, which is the one worth reporting because it is already grouped the
 * way a developer thinks about memory.
 */
export function parseMeminfo(stdout: string): MeminfoFacts | undefined {
  const pidMatch = /\*\* MEMINFO in pid (\d+)/.exec(stdout)
  const totals = /TOTAL PSS:\s*(\d+)(?:\s+TOTAL RSS:\s*(\d+))?(?:\s+TOTAL SWAP PSS:\s*(\d+))?/.exec(stdout)
  const detail: MemoryCategory[] = []
  const summary: Record<string, number> = {}
  let inDetail = false
  let inSummary = false
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd()
    if (/^\s*-{3,}/.test(line)) {
      // The App Summary block has a `------` rule of its own. Without this
      // guard it would flip the walk back into detail mode and every summary
      // row would then be dropped (verified against a real Android 14 dump:
      // javaHeapKb/nativeHeapKb came back undefined).
      if (!inSummary) inDetail = true
      continue
    }
    if (/^\s*App Summary\s*$/.test(line)) {
      inDetail = false
      inSummary = true
      continue
    }
    if (/^\s*Objects\s*$/.test(line) || /^\s*SQL\s*$/.test(line)) {
      inSummary = false
      continue
    }
    if (inDetail) {
      // `  Native Heap    15407    13880 …` — the label is everything before
      // the first number, and that first number is Pss Total.
      const row = /^\s{2,}([A-Za-z][A-Za-z0-9 ._-]*?)\s{2,}(\d+)\b/.exec(line)
      if (row !== null) {
        const name = row[1]!.trim()
        const pssKb = Number(row[2])
        if (name !== 'TOTAL' && Number.isSafeInteger(pssKb)) detail.push({ name, pssKb })
      }
      continue
    }
    if (inSummary) {
      const row = /^\s*([A-Za-z][A-Za-z ]*?):\s*(\d+)/.exec(line)
      if (row !== null) summary[row[1]!.trim()] = Number(row[2])
    }
  }
  const totalPssKb = totals === null ? undefined : Number(totals[1])
  if (totalPssKb === undefined || !Number.isSafeInteger(totalPssKb)) return undefined
  detail.sort((a, b) => b.pssKb - a.pssKb)
  return {
    ...(pidMatch === null ? {} : { pid: Number(pidMatch[1]) }),
    totalPssKb,
    ...(totals?.[2] === undefined ? {} : { totalRssKb: Number(totals[2]) }),
    ...(totals?.[3] === undefined ? {} : { totalSwapPssKb: Number(totals[3]) }),
    ...(summary['Java Heap'] === undefined ? {} : { javaHeapKb: summary['Java Heap'] }),
    ...(summary['Native Heap'] === undefined ? {} : { nativeHeapKb: summary['Native Heap'] }),
    ...(summary.Code === undefined ? {} : { codeKb: summary.Code }),
    ...(summary.Stack === undefined ? {} : { stackKb: summary.Stack }),
    ...(summary.Graphics === undefined ? {} : { graphicsKb: summary.Graphics }),
    topCategories: detail.slice(0, MAX_TOP_CATEGORIES),
  }
}

/**
 * Parse the `Package [<pkg>]` block of `dumpsys package <pkg>`. Returns
 * undefined when no such block exists, which is exactly the "not installed"
 * answer android_app_info reports as a fact rather than an error.
 */
export function parsePackageInfo(stdout: string, packageName: string): PackageFacts | undefined {
  const marker = `Package [${packageName}]`
  const index = stdout.indexOf(marker)
  if (index === -1) return undefined
  // The block runs until the next `Package [` header (or the end of the dump).
  const rest = stdout.slice(index + marker.length)
  const next = rest.indexOf('\n  Package [')
  const block = next === -1 ? rest : rest.slice(0, next)
  const scalar = (pattern: RegExp): string | undefined => {
    const match = pattern.exec(block)
    return match === null ? undefined : match[1]!.trim()
  }
  const integer = (pattern: RegExp): number | undefined => {
    const value = scalar(pattern)
    if (value === undefined) return undefined
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  const version = scalar(/^\s*versionName=(.*)$/m)
  const versionCode = integer(/^\s*versionCode=(\d+)/m)
  const minSdk = integer(/\bminSdk=(\d+)/)
  const targetSdk = integer(/\btargetSdk=(\d+)/)
  const dataDir = scalar(/^\s*dataDir=(.*)$/m)
  const codePath = scalar(/^\s*codePath=(.*)$/m)
  const firstInstallTime = scalar(/^\s*firstInstallTime=(.*)$/m)
  const lastUpdateTime = scalar(/^\s*lastUpdateTime=(.*)$/m)
  const installerPackage = scalar(/^\s*installerPackageName=(.*)$/m)
  const flags = scalar(/^\s*(?:pkg)?[Ff]lags=\[(.*)\]$/m) ?? ''
  return {
    ...(version === undefined || version === 'null' ? {} : { version }),
    ...(versionCode === undefined ? {} : { versionCode }),
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(targetSdk === undefined ? {} : { targetSdk }),
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(codePath === undefined ? {} : { codePath }),
    ...(firstInstallTime === undefined ? {} : { firstInstallTime }),
    ...(lastUpdateTime === undefined ? {} : { lastUpdateTime }),
    ...(installerPackage === undefined || installerPackage === 'null' ? {} : { installerPackage }),
    system: /\bSYSTEM\b/.test(flags),
  }
}

/**
 * Cap a stack dump. The interesting frames are at the TOP (the innermost
 * call), unlike a log tail — so this keeps the HEAD, not the tail.
 */
export function capBacktrace(
  lines: readonly string[],
  limit = MAX_BACKTRACE_LINES,
): { lines: string[]; truncated: boolean } {
  const cleaned = lines.map(line => line.replace(/\r$/, '').trimEnd()).filter(line => line !== '')
  if (cleaned.length <= limit) return { lines: cleaned, truncated: false }
  return { lines: cleaned.slice(0, limit), truncated: true }
}

/** The first thread block of an ANR trace (usually "main"). */
export function firstThreadBlock(lines: readonly string[]): string[] {
  const start = lines.findIndex(line => /^"/.test(line))
  if (start === -1) return [...lines]
  const end = lines.findIndex((line, index) => index > start && /^"/.test(line))
  return end === -1 ? lines.slice(start) : lines.slice(start, end)
}

/**
 * Read the newest `/data/anr/` trace, when the shell user may. Returns
 * undefined for the (common) permission refusal so the caller can degrade to
 * the crash buffer and SAY that it did.
 */
export async function readNewestAnrTrace(
  host: AndroidHostController,
  serial: string,
  timeoutMs: number,
): Promise<{ path: string; lines: string[] } | undefined> {
  const listing = await host.toolchain.shell(serial, ['ls', '-t', '/data/anr/'], { timeoutMs }).catch(() => '')
  const newest = listing.split('\n')
    .map(line => line.trim())
    .find(line => line !== '' && !/Permission denied|No such file|^total /i.test(line))
  if (newest === undefined) return undefined
  const path = `/data/anr/${newest}`
  const content = await host.toolchain.shell(serial, ['cat', path], {
    timeoutMs,
    maxBuffer: DEBUG_MAX_BUFFER,
  }).catch(() => '')
  if (content.trim() === '' || /Permission denied/i.test(content)) return undefined
  return { path, lines: content.split('\n') }
}
