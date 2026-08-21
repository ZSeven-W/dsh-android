/**
 * Gradle pipeline for `android_build_run`: detect the project, run
 * `assembleDebug`, locate the produced APK, resolve its applicationId,
 * install it with `adb install -r`, and launch it with `monkey`.
 *
 * The dsh-ios twin drives `xcodebuild`; the shape is deliberately the same
 * (detect → build → find artifact → read the id → install → launch, with the
 * FILTERED build tail attached to every failure) so the two plugins fail the
 * same way. What differs is Android-specific:
 *
 * - the wrapper wins. `./gradlew` pins the Gradle version a project was
 *   written against; a PATH `gradle` of the wrong major routinely fails with
 *   an unrelated plugin error, so the wrapper is preferred and the PATH
 *   binary is only the fallback.
 * - the applicationId is NOT the module name and NOT guessable. It is read
 *   from `build/outputs/apk/debug/output-metadata.json` (AGP writes it next to
 *   the APK), then from `applicationId "…"` in the module's build script, and
 *   only then from `package="…"` in a legacy `AndroidManifest.xml`. `aapt2
 *   dump badging` is deliberately not used: it lives in a versioned
 *   `build-tools/<version>/` directory that is not on PATH on most machines.
 * @module @zseven-w/dsh-android/build-run
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import type { AdbToolchain, AndroidDevice } from './adb.js'

/** Lines of raw build output retained while the build runs. */
const OUTPUT_TAIL_LINES = 400
/** Lines of FILTERED build output attached to a failure. */
const ERROR_TAIL_LINES = 80
/** How deep the APK search walks below the project root. */
const APK_SEARCH_MAX_DEPTH = 5
const INSTALL_TIMEOUT_MS = 300_000
const LAUNCH_TIMEOUT_MS = 60_000

/** Directories never worth walking when looking for a built APK. */
const SKIPPED_DIRECTORIES = new Set(['.git', '.gradle', '.idea', 'node_modules', 'src', '.kotlin', '.cxx'])

/** A detected, buildable Gradle project on disk. */
export interface AndroidProject {
  /** Directory the build runs in (the Gradle root). */
  root: string
  /** Absolute `gradlew` path, or the PATH command name. */
  gradleCommand: string
  /** Where `gradleCommand` came from — the wrapper is always preferred. */
  gradleSource: 'wrapper' | 'path'
  /** The settings/build script that identified the root. */
  buildFile: string
}

/** Successful outcome of build + install + launch. */
export interface AndroidBuildRunResult {
  device: {
    serial: string
    name: string
    androidVersion: string
    state: string
  }
  state: 'launched'
  packageName: string
  apkPath: string
  projectPath: string
  /** Gradle task that ran, e.g. `assembleDebug` or `:app:assembleDebug`. */
  task: string
  variant: string
  /** Where the applicationId came from — never a guess. */
  packageSource: 'output-metadata' | 'build-script' | 'manifest'
  /** True when a running instance was force-stopped before the launch. */
  relaunched?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The settings script names that mark a Gradle ROOT (Groovy or Kotlin DSL). */
const SETTINGS_FILES = ['settings.gradle.kts', 'settings.gradle'] as const
/** The build script names that mark a Gradle project directory. */
const BUILD_FILES = ['build.gradle.kts', 'build.gradle'] as const

function firstExisting(root: string, names: readonly string[]): string | undefined {
  for (const name of names) {
    const candidate = join(root, name)
    if (isFile(candidate)) return candidate
  }
  return undefined
}

/**
 * Detect the Gradle project at `projectPath` and how to build it.
 *
 * `projectPath` may be the Gradle root, or a module directory inside one (the
 * usual `…/app`): a module's own `build.gradle` cannot be built on its own, so
 * the walk climbs to the nearest ancestor carrying `settings.gradle[.kts]`.
 * The wrapper found at that root wins over any PATH `gradle`.
 */
export function detectProject(projectPath: string): AndroidProject {
  const absolute = resolve(projectPath)
  if (!isDirectory(absolute)) {
    throw new Error(
      `android_build_run: projectPath is not a directory: ${projectPath} — pass the Android project root `
      + '(the directory containing settings.gradle or settings.gradle.kts)',
    )
  }
  // Climb to the Gradle root: `settings.gradle[.kts]` is what defines one.
  let current = absolute
  for (;;) {
    const settings = firstExisting(current, SETTINGS_FILES)
    if (settings !== undefined) return { ...gradleCommandFor(current), root: current, buildFile: settings }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  // A single-module project without a settings script still builds when it has
  // a build script of its own; Gradle treats that directory as the root.
  const build = firstExisting(absolute, BUILD_FILES)
  if (build !== undefined) return { ...gradleCommandFor(absolute), root: absolute, buildFile: build }
  throw new Error(
    `android_build_run: ${projectPath} is not a Gradle project — no settings.gradle[.kts] in it or in any `
    + 'parent directory, and no build.gradle[.kts] of its own. Pass the Android project root (the directory '
    + 'Android Studio opens), not a source folder.',
  )
}

/** Wrapper first, PATH `gradle` second — see the module comment. */
function gradleCommandFor(root: string): { gradleCommand: string; gradleSource: 'wrapper' | 'path' } {
  const wrapper = join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (isFile(wrapper)) return { gradleCommand: wrapper, gradleSource: 'wrapper' }
  return { gradleCommand: process.platform === 'win32' ? 'gradle.bat' : 'gradle', gradleSource: 'path' }
}

/**
 * The Gradle task for one variant, optionally scoped to a module:
 * `assembleDebug` or `:app:assembleDebug`. `variant` is capitalized because
 * Gradle's task names are `assemble<Variant>`.
 */
export function assembleTask(variant: string, module?: string): string {
  const normalized = variant.trim() === '' ? 'debug' : variant.trim()
  const task = `assemble${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  if (module === undefined || module.trim() === '') return task
  const path = module.trim().replace(/^:+|:+$/g, '')
  return `:${path}:${task}`
}

/** The argument vector handed to Gradle. Exported for dry-run verification. */
export function assembleGradleArgs(task: string, extraArgs: readonly string[] = []): string[] {
  // `--console=plain` keeps the captured tail free of the progress-bar control
  // sequences a TTY-less spawn would otherwise still receive from Gradle's
  // rich console, and `--stacktrace` makes a plugin failure actionable.
  return [task, '--console=plain', '--stacktrace', ...extraArgs]
}

type GradleChild = ChildProcessByStdio<null, Readable, Readable>

/** Run one Gradle invocation, keeping the last OUTPUT_TAIL_LINES lines. */
export async function runGradleBuild(
  project: AndroidProject,
  args: readonly string[],
  signal: AbortSignal,
): Promise<{ exitCode: number | null; lines: string[] }> {
  const child: GradleChild = spawn(project.gradleCommand, [...args], {
    cwd: project.root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines: string[] = []
  const collect = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split('\n')) {
      lines.push(line.trimEnd())
      if (lines.length > OUTPUT_TAIL_LINES) lines.shift()
    }
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const onAbort = (): void => { child.kill('SIGKILL') }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await new Promise<{ exitCode: number | null; lines: string[] }>((resolveRun, rejectRun) => {
      child.once('error', error => rejectRun(new Error(
        `android_build_run: could not run ${project.gradleCommand}: ${errorMessage(error)}`
        + (project.gradleSource === 'path'
          ? ' — this project has no ./gradlew wrapper and no `gradle` was found on PATH; install Gradle or '
            + 'add the wrapper (gradle wrapper)'
          : ''),
      )))
      child.once('close', code => resolveRun({ exitCode: code, lines }))
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Gradle progress/boilerplate lines; not actionable on a failure. The twin of
 * dsh-ios's BUILD_NOISE, tuned to what AGP actually prints.
 */
const BUILD_NOISE = /^(> Task |Download |Downloading |Starting a Gradle Daemon|Daemon will be stopped|Welcome to Gradle|To honour the JVM settings|Configuration on demand|Calculating task graph|<[-=]+>|\d+ actionable task|BUILD SUCCESSFUL|Deprecated Gradle features|You can use|See https:\/\/docs\.gradle\.org|The Kotlin Gradle plugin was loaded|w: file:)/u

/**
 * Reduce Gradle output to the last ~80 informative lines: drop blanks and the
 * progress boilerplate above, keep `e: file.kt:12:3: …` compiler diagnostics,
 * `FAILURE:` blocks and `* What went wrong:` sections.
 */
export function filterBuildOutput(lines: readonly string[], limit = ERROR_TAIL_LINES): string[] {
  return lines.filter(line => line !== '' && !BUILD_NOISE.test(line)).slice(-limit)
}

/** Tail of build output embedded in the thrown failure message. */
export function buildFailureDetail(lines: readonly string[]): string {
  const tail = filterBuildOutput(lines)
  return tail.length === 0 ? '(no output captured)' : tail.join('\n')
}

/** One APK found under a `build/outputs/apk/<variant>` directory. */
export interface BuiltApk {
  path: string
  /** The `build/outputs/apk/<variant>` directory it was found in. */
  outputDir: string
  mtimeMs: number
}

/**
 * Locate the freshly built APK: every `build/outputs/apk/<variant>/*.apk`
 * below the project root, newest mtime first.
 *
 * The walk is bounded (depth 5, skipping `.git`/`.gradle`/`src`/…) because a
 * monorepo root can hold thousands of directories, and a full walk of one was
 * never the point — AGP always writes to that exact path.
 */
export function findBuiltApk(root: string, variant = 'debug'): BuiltApk | undefined {
  const found: BuiltApk[] = []
  const walk = (directory: string, depth: number): void => {
    if (depth > APK_SEARCH_MAX_DEPTH) return
    let entries: string[]
    try {
      entries = readdirSync(directory)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.startsWith('.') && entry !== '.') continue
      const child = join(directory, entry)
      if (!isDirectory(child)) continue
      if (entry === 'build') {
        collectApks(join(child, 'outputs', 'apk', variant), found)
        // AGP also nests per-flavour output dirs one level deeper
        // (`outputs/apk/<flavour>/<buildType>`); scan those too.
        const apkRoot = join(child, 'outputs', 'apk')
        if (isDirectory(apkRoot)) {
          for (const flavour of readdirSync(apkRoot)) {
            collectApks(join(apkRoot, flavour, variant), found)
          }
        }
        continue
      }
      if (SKIPPED_DIRECTORIES.has(entry)) continue
      walk(child, depth + 1)
    }
  }
  collectApks(join(root, 'build', 'outputs', 'apk', variant), found)
  walk(root, 0)
  if (found.length === 0) return undefined
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found[0]
}

function collectApks(directory: string, into: BuiltApk[]): void {
  if (!isDirectory(directory)) return
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.apk')) continue
    const path = join(directory, entry)
    try {
      const info = statSync(path)
      if (!info.isFile()) continue
      if (into.some(existing => existing.path === path)) continue
      into.push({ path, outputDir: directory, mtimeMs: info.mtimeMs })
    } catch {
      // A file that vanished mid-scan is simply not a candidate.
    }
  }
}

/** The applicationId plus where it was read from — never a guess. */
export interface ResolvedApplicationId {
  packageName: string
  source: AndroidBuildRunResult['packageSource']
}

/**
 * Read the applicationId AGP recorded next to the APK
 * (`output-metadata.json`). This is the authoritative source: it is written by
 * the same build that produced the APK, so flavour/suffix rules are already
 * applied (`dev.rish.demo.debug`, not `dev.rish.demo`).
 */
export function applicationIdFromOutputMetadata(outputDir: string): string | undefined {
  const metadata = join(outputDir, 'output-metadata.json')
  if (!isFile(metadata)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(metadata, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const value = (parsed as Record<string, unknown>).applicationId
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Fallback: `applicationId "…"` / `applicationId = "…"` from a module's build
 * script, or `package="…"` from a legacy `AndroidManifest.xml`. Both are
 * searched from the APK's module directory upward, so the right module wins in
 * a multi-module project.
 */
export function applicationIdFromSources(moduleDir: string, root: string): ResolvedApplicationId | undefined {
  let current = moduleDir
  for (;;) {
    for (const name of BUILD_FILES) {
      const script = join(current, name)
      if (!isFile(script)) continue
      try {
        const text = readFileSync(script, 'utf8')
        // Both DSLs, and both `applicationId` (AGP) and the newer `namespace`.
        const match = /\bapplicationId\s*(?:=\s*)?["']([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)["']/u.exec(text)
          ?? /\bnamespace\s*(?:=\s*)?["']([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)["']/u.exec(text)
        if (match !== null) return { packageName: match[1]!, source: 'build-script' }
      } catch {
        // An unreadable script is simply not a source.
      }
    }
    const manifest = join(current, 'src', 'main', 'AndroidManifest.xml')
    if (isFile(manifest)) {
      try {
        const text = readFileSync(manifest, 'utf8')
        const match = /<manifest[^>]*\bpackage\s*=\s*"([^"]+)"/u.exec(text)
        if (match !== null) return { packageName: match[1]!, source: 'manifest' }
      } catch {
        // Same: unreadable is not a source.
      }
    }
    if (current === root) break
    const parent = dirname(current)
    if (parent === current || !parent.startsWith(root + sep) && parent !== root) break
    current = parent
  }
  return undefined
}

/**
 * The module directory an APK belongs to: `<module>/build/outputs/apk/…` walks
 * back up to `<module>`.
 */
export function moduleDirectoryOf(apkPath: string): string {
  let current = dirname(apkPath)
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = dirname(current)
    if (basename(current) === 'build') return parent
    if (parent === current) break
    current = parent
  }
  return dirname(apkPath)
}

/** Resolve the applicationId of a built APK, or throw with what to do next. */
export function resolveApplicationId(apk: BuiltApk, root: string): ResolvedApplicationId {
  const fromMetadata = applicationIdFromOutputMetadata(apk.outputDir)
  if (fromMetadata !== undefined) return { packageName: fromMetadata, source: 'output-metadata' }
  const fromSources = applicationIdFromSources(moduleDirectoryOf(apk.path), root)
  if (fromSources !== undefined) return fromSources
  throw new Error(
    `android_build_run: the build produced ${apk.path} but its applicationId could not be determined — `
    + `no output-metadata.json next to the APK, and no applicationId/namespace in the module's build script `
    + 'or AndroidManifest.xml. The APK is installed by path, but the package to launch cannot be guessed: '
    + 'declare applicationId in the module build script, then retry.',
  )
}

export interface BuildRunOptions {
  project: AndroidProject
  toolchain: AdbToolchain
  device: AndroidDevice
  /** Device summary carried into the result (model/version already resolved). */
  deviceSummary: AndroidBuildRunResult['device']
  /** Gradle module path, e.g. `app` or `:app` (omit to build every module). */
  module?: string
  /** Build variant; `debug` unless the caller asks otherwise. */
  variant?: string
  /** Force-stop a running instance before launching. */
  relaunch?: boolean
  signal: AbortSignal
}

/**
 * Full pipeline: gradle assemble → find the APK → read the applicationId →
 * `adb install -r` → `monkey` launch. Every failure carries the filtered
 * Gradle tail (build) or the adb stderr (install/launch), because "it failed"
 * with no output is what turns one tool call into a shell session.
 */
export async function buildRun(options: BuildRunOptions): Promise<AndroidBuildRunResult> {
  const { project, toolchain, device, deviceSummary, signal } = options
  const variant = options.variant === undefined || options.variant.trim() === '' ? 'debug' : options.variant.trim()
  const task = assembleTask(variant, options.module)
  const { exitCode, lines } = await runGradleBuild(project, assembleGradleArgs(task), signal)
  if (exitCode !== 0) {
    throw new Error(
      `android_build_run: ${basename(project.gradleCommand)} ${task} failed (exit ${String(exitCode)}) in `
      + `${project.root}:\n${buildFailureDetail(lines)}`,
    )
  }
  const apk = findBuiltApk(project.root, variant)
  if (apk === undefined) {
    throw new Error(
      `android_build_run: ${task} succeeded but no APK was found under ${project.root}`
      + `/**/build/outputs/apk/${variant}/ — check that the module applies the com.android.application `
      + `plugin (a library module produces an .aar, which cannot be installed) and that the variant name `
      + `"${variant}" exists.`,
    )
  }
  const { packageName, source } = resolveApplicationId(apk, project.root)
  try {
    const install = await toolchain.exec(['install', '-r', apk.path], {
      serial: device.serial,
      timeoutMs: INSTALL_TIMEOUT_MS,
    })
    const combined = `${install.stdout}\n${install.stderr}`
    // `adb install` exits 0 even when the device refuses the package, printing
    // `Failure [INSTALL_FAILED_…]` — treat that as the failure it is.
    const failure = /Failure \[([^\]]+)\]/u.exec(combined)
    if (failure !== null) {
      throw new Error(
        `the device refused the package (${failure[1]}) — an INSTALL_FAILED_UPDATE_INCOMPATIBLE or `
        + `SIGNATURE mismatch means an app with the same id is already installed from a different build; `
        + `uninstall it on the device first (adb -s ${device.serial} uninstall ${packageName})`,
      )
    }
  } catch (error) {
    throw new Error(`android_build_run: installing ${apk.path} on ${device.serial} failed: ${errorMessage(error)}`)
  }
  const relaunch = options.relaunch === true
  if (relaunch) {
    await toolchain.shell(device.serial, ['am', 'force-stop', packageName], { timeoutMs: LAUNCH_TIMEOUT_MS })
      .catch(() => undefined)
  }
  await launchPackage(toolchain, device.serial, packageName)
  return {
    device: deviceSummary,
    state: 'launched',
    packageName,
    apkPath: apk.path,
    projectPath: project.root,
    task,
    variant,
    packageSource: source,
    ...(relaunch ? { relaunched: true as boolean } : {}),
  }
}

/**
 * Launch a package's launcher activity. `monkey -p <pkg> 1` is used rather
 * than `am start -n <pkg>/<activity>` because the launcher activity's class
 * name is not knowable without reading the manifest off the device; monkey
 * resolves the LAUNCHER intent itself. Its "no activities found" answer is
 * printed on stdout with exit code 0, so the output is inspected.
 */
export async function launchPackage(toolchain: AdbToolchain, serial: string, packageName: string): Promise<void> {
  const output = await toolchain.shell(serial, [
    'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1',
  ], { timeoutMs: LAUNCH_TIMEOUT_MS })
  if (/No activities found|Error:|monkey aborted/u.test(output)) {
    // Some packages (services, or apps whose entry point is not a LAUNCHER
    // activity) have nothing monkey can start — say which case this is.
    throw new Error(
      `could not launch ${packageName} on ${serial}: ${output.trim().split('\n').slice(0, 4).join(' ')} — `
      + 'the package may have no launcher activity (a service-only or library package), or it may not be '
      + 'installed; run android_list_apps to check',
    )
  }
}

/** True when `path` looks like an installable APK on disk. */
export function isApkFile(path: string): boolean {
  return path.toLowerCase().endsWith('.apk') && isFile(path)
}

/** Re-exported for the smoke: the directories the APK search refuses to walk. */
export const APK_SEARCH_SKIPPED_DIRECTORIES: readonly string[] = [...SKIPPED_DIRECTORIES]
