/**
 * Installed-app enumeration for dsh-android (`pm list packages` + a single
 * `dumpsys package packages` enrichment pass).
 *
 * Ported from dsh-ios app-list.ts, and it keeps that module's ONE hard
 * invariant: a FAILED listing THROWS. The measured failure it closes (WP57 on
 * the iOS side) was an agent that read an empty `xcrun devicectl` listing as
 * "the app is not installed", guessed a bundle id, and spent 377 s grepping
 * the user's source trees. `count: 0` must always be a fact about the DEVICE,
 * never about the plumbing, so an unparseable or non-zero-exit listing is an
 * error with the reason attached.
 *
 * What is different on Android:
 * - the identity is a PACKAGE NAME (`com.android.settings`), which `pm list
 *   packages` reports directly — there is no plist to decode;
 * - there is NO adb-visible display label. `aapt2` lives in the SDK, not on
 *   the device, and neither `pm` nor `dumpsys package` prints an app's
 *   `android:label`. So `label` mirrors the package name (the contract's
 *   "label 取不到就用包名") and every no-match hint says so out loud — a
 *   Chinese label read off the screen can never match a listing, and the model
 *   must be told the alternative instead of guessing a package name.
 * - versions come from ONE `dumpsys package packages` call (measured 0.15 s /
 *   790 KB on an Android 14 emulator), parsed host-side so the listing never
 *   depends on a device-side `grep`.
 * @module @zseven-w/dsh-android/app-list
 */

import type { AdbToolchain } from './adb.js'

/** One installed app, as the Android tools report it. */
export interface AndroidApp {
  /** The app's identity on Android — `com.android.settings`. */
  packageName: string
  /**
   * Human-facing label. Android exposes no label over adb, so this is the
   * package name; see `ANDROID_LABEL_HINT`.
   */
  label: string
  /** `versionName` from `dumpsys package`, when it reported one. */
  version?: string
  /** `versionCode` from `dumpsys package`, when it reported one. */
  versionCode?: number
  /** True for `pm list packages -s` (system/preinstalled) packages. */
  system: boolean
  /** APK path, from `pm list packages -f`. */
  apkPath?: string
}

/** How many candidate lines a no-match hint lists (same budget as dsh-ios). */
const NO_MATCH_CANDIDATE_LIMIT = 15

/** How many characters of a rejected listing are quoted back in the error. */
const UNPARSEABLE_SAMPLE_CHARS = 120

const PM_TIMEOUT_MS = 60_000
const DUMPSYS_TIMEOUT_MS = 90_000
/** `dumpsys package packages` is ~800 KB on a stock emulator; leave headroom. */
const DUMPSYS_MAX_BUFFER = 64 * 1024 * 1024

/**
 * The Android-specific addendum to every no-match. On iOS this hint explains
 * that a phone reports base (English) names; on Android there are no names at
 * all over adb, which is a stronger statement and easier to get wrong — an
 * agent that matched "设置" against nothing must not conclude Settings is
 * missing.
 */
export const ANDROID_LABEL_HINT
  = 'Android exposes no app label over adb (an app’s android:label lives in its compiled resources, '
  + 'which needs aapt2 from the SDK, not the device), so this listing matches PACKAGE NAMES only — '
  + 'a Chinese/Japanese label read off the screen will never match. Match a package-name fragment '
  + '(e.g. "settings", "chrome"), or open the app by tapping its icon (android_find_text + android_tap_text)'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Parse `pm list packages [-f]`: one `package:<name>` line per app, or
 * `package:<apk path>=<name>` with `-f`. The `=` split is done from the RIGHT
 * because an APK path can itself contain `=` (the install directory hash does:
 * `/data/app/~~rwUb…==/dev.rish.demo-Qx4…==/base.apk`).
 *
 * Output that is not a package listing at all — a `pm` diagnostic, an empty
 * capture, a permission refusal — THROWS: "the device has no apps" and "the
 * listing failed" must never look alike to the model.
 */
export function parsePmListPackages(stdout: string, serial?: string): { packageName: string; apkPath?: string }[] {
  const where = serial === undefined ? '' : ` for ${serial}`
  const entries: { packageName: string; apkPath?: string }[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    // Diagnostics mixed into a valid listing are tolerated: the packages that
    // DID parse are real, and dropping them would be the worse failure.
    if (!line.startsWith('package:')) continue
    const body = line.slice('package:'.length)
    const separator = body.lastIndexOf('=')
    if (separator > 0) {
      const apkPath = body.slice(0, separator)
      const packageName = body.slice(separator + 1)
      if (packageName === '') continue
      entries.push({ packageName, ...(apkPath === '' ? {} : { apkPath }) })
      continue
    }
    entries.push({ packageName: body })
  }
  if (entries.length === 0) {
    const sample = stdout.trim().slice(0, UNPARSEABLE_SAMPLE_CHARS)
    throw new Error(
      `could not parse the \`pm list packages\` output${where} — it carried no package lines (got `
      + `${JSON.stringify(sample)}); the listing FAILED, which is not the same as the device having no apps`,
    )
  }
  return entries
}

/**
 * Parse the `Packages:` section of `dumpsys package packages` into
 * `packageName → { version, versionCode }`. Never throws: version enrichment
 * is a nicety, and a device whose dumpsys shape drifts must still list.
 */
export function parseDumpsysPackageVersions(stdout: string): Map<string, { version?: string; versionCode?: number }> {
  const versions = new Map<string, { version?: string; versionCode?: number }>()
  let current: string | undefined
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd()
    const header = /^\s*Package \[([^\]]+)\]/.exec(line)
    if (header !== null) {
      current = header[1]
      if (!versions.has(current)) versions.set(current, {})
      continue
    }
    if (current === undefined) continue
    const trimmed = line.trim()
    const versionName = /^versionName=(.*)$/.exec(trimmed)
    if (versionName !== null) {
      const value = versionName[1]!.trim()
      if (value !== '' && value !== 'null') versions.get(current)!.version = value
      continue
    }
    const versionCode = /^versionCode=(\d+)\b/.exec(trimmed)
    if (versionCode !== null) {
      const value = Number(versionCode[1])
      if (Number.isSafeInteger(value)) versions.get(current)!.versionCode = value
    }
  }
  return versions
}

/**
 * Enumerate the apps installed on one device.
 *
 * Three adb calls, in this order: the full listing (`pm list packages -f`),
 * the system set (`pm list packages -s`, so the default "user apps only" view
 * is correct), then ONE `dumpsys package packages` enrichment pass for
 * versions. The first two THROW on failure; the third is best-effort, because
 * a missing `versionName` is not a reason to hide an installed app.
 */
export async function listAndroidApps(
  toolchain: AdbToolchain,
  serial: string,
  options: { timeoutMs?: number } = {},
): Promise<AndroidApp[]> {
  const timeoutMs = options.timeoutMs ?? PM_TIMEOUT_MS
  let listing: string
  try {
    listing = await toolchain.shell(serial, ['pm', 'list', 'packages', '-f'], { timeoutMs })
  } catch (error) {
    throw new Error(
      `could not list the packages installed on ${serial}: ${errorMessage(error)} — the device must be `
      + 'ONLINE (run android_devices) for `pm` to answer; a failed listing is not an empty one',
    )
  }
  const entries = parsePmListPackages(listing, serial)
  let systemListing: string
  try {
    systemListing = await toolchain.shell(serial, ['pm', 'list', 'packages', '-s'], { timeoutMs })
  } catch (error) {
    throw new Error(
      `could not list the SYSTEM packages on ${serial}: ${errorMessage(error)} — without that listing the `
      + '"user apps only" default cannot be honoured, and reporting every package as user-installed would '
      + 'be worse than failing',
    )
  }
  const systemSet = new Set(parsePmListPackages(systemListing, serial).map(entry => entry.packageName))
  // Best effort: one dumpsys pass for versionName/versionCode (~0.15 s).
  let versions = new Map<string, { version?: string; versionCode?: number }>()
  try {
    const dump = await toolchain.shell(serial, ['dumpsys', 'package', 'packages'], {
      timeoutMs: DUMPSYS_TIMEOUT_MS,
      maxBuffer: DUMPSYS_MAX_BUFFER,
    })
    versions = parseDumpsysPackageVersions(dump)
  } catch {
    // A device that refuses dumpsys still has a valid package listing.
  }
  return entries.map(entry => {
    const version = versions.get(entry.packageName)
    return {
      packageName: entry.packageName,
      // No adb-visible label exists; the package name IS the handle.
      label: entry.packageName,
      ...(version?.version === undefined ? {} : { version: version.version }),
      ...(version?.versionCode === undefined ? {} : { versionCode: version.versionCode }),
      system: systemSet.has(entry.packageName),
      ...(entry.apkPath === undefined ? {} : { apkPath: entry.apkPath }),
    }
  })
}

/** Filter + order one listing: user apps first, then by package name. */
export function filterAndroidApps(
  apps: readonly AndroidApp[],
  options: { query?: string; includeSystem?: boolean } = {},
): AndroidApp[] {
  const query = (options.query ?? '').trim().toLowerCase()
  const includeSystem = options.includeSystem === true
  const matched = apps.filter(app => (includeSystem || !app.system)
    && (query === ''
      || app.packageName.toLowerCase().includes(query)
      || app.label.toLowerCase().includes(query)))
  return matched.sort((a, b) => (a.system === b.system
    ? a.packageName.localeCompare(b.packageName)
    : a.system ? 1 : -1))
}

/** Up to `limit` package lines, user apps first, for a no-match hint. */
export function noMatchCandidateLines(apps: readonly AndroidApp[], limit = NO_MATCH_CANDIDATE_LIMIT): string[] {
  return [...apps]
    .sort((a, b) => (a.system === b.system
      ? a.packageName.localeCompare(b.packageName)
      : a.system ? 1 : -1))
    .slice(0, limit)
    .map(app => (app.version === undefined ? app.packageName : `${app.packageName} (${app.version})`))
}

/**
 * The `hint` a SUCCESSFUL listing attaches when a query matched nothing. A
 * bare `count: 0` gets read as "the app is not installed" (the exact misread
 * behind the iOS 377 s detour), so the result itself says WHICH empty shape
 * this is and carries the listed total as proof the listing worked.
 */
export function noMatchListingHint(listedTotal: number, includedSystem: boolean): string {
  const total = `${listedTotal} package${listedTotal === 1 ? '' : 's'}`
  return `${ANDROID_LABEL_HINT}; the listing succeeded and reported ${total} in total`
    + (includedSystem ? '' : ' — system packages were excluded, so retry with include_system:true if you '
      + 'expected a preinstalled app')
}

/**
 * Resolve a NAME to exactly one installed app: substring over package names
 * (and the label, which mirrors them), with an exact package match as the
 * tie-break — the same "exact first, then contains" rule android_tap_element
 * uses. Ambiguity and no-match both THROW, with the candidates or with the
 * verb to run, because guessing a package name is the failure this closes.
 */
export function resolveAppByName(
  tool: string,
  apps: readonly AndroidApp[],
  name: string,
  deviceName: string,
): AndroidApp {
  const wanted = name.trim()
  const needle = wanted.toLowerCase()
  if (needle === '') {
    throw new Error(`${tool}: name must be a non-empty package-name fragment, e.g. "settings" or "com.android.chrome"`)
  }
  const pool = apps.filter(app => app.packageName.toLowerCase().includes(needle)
    || app.label.toLowerCase().includes(needle))
  if (pool.length === 0) {
    const candidates = noMatchCandidateLines(apps)
    throw new Error(
      `${tool}: no installed package matches "${wanted}" on ${deviceName} — run android_list_apps to see `
      + 'what is installed (do not guess a package name, and do not look for the app outside the device). '
      + ANDROID_LABEL_HINT
      + (candidates.length === 0 ? '' : `\n${candidates.join('\n')}`),
    )
  }
  if (pool.length === 1) return pool[0]!
  const exact = pool.filter(app => app.packageName.toLowerCase() === needle)
  if (exact.length === 1) return exact[0]!
  const ambiguous = (exact.length > 1 ? exact : pool)
    .slice(0, NO_MATCH_CANDIDATE_LIMIT)
    .map(app => (app.version === undefined ? app.packageName : `${app.packageName} — ${app.version}`))
  throw new Error(
    `${tool}: ${pool.length} installed packages match "${wanted}" on ${deviceName} — pass packageName (or a `
    + `longer fragment) to pick one:\n${ambiguous.join('\n')}`,
  )
}
