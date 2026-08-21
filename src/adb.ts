/**
 * adb toolchain resolution and device-facing primitives for dsh-android.
 *
 * Design rule (see docs/architecture.zh.md, decision 0): the plugin is
 * adb-centric. A device's one and only identity is the SERIAL that
 * `adb devices -l` reports — emulators, USB phones and `ip:port` devices all
 * share the same code path. Nothing in this module assumes a particular
 * emulator product; the `emulator` binary is a best-effort optional discovery
 * used solely by the boot-an-AVD verb, and every other verb keeps working
 * without it.
 *
 * adb discovery order: `ADB` env var → PATH → the usual SDK locations
 * (`ANDROID_HOME` / `ANDROID_SDK_ROOT` / per-OS defaults). When nothing
 * resolves the plugin still loads and registers its tools; each call then
 * fails with an explanatory error (the same degradation style dsh-ios uses on
 * non-macOS hosts).
 * @module @zseven-w/dsh-android/adb
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

const EXEC_TIMEOUT_MS = 30_000
const MAX_EXEC_BUFFER = 32 * 1024 * 1024
const BOOT_POLL_INTERVAL_MS = 1_000
export const DEFAULT_BOOT_TIMEOUT_MS = 180_000

/** Failure of one adb (or emulator) invocation, with the args that ran. */
export class AdbError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr = '',
    readonly exitCode: number | null = null,
  ) {
    super(message)
    this.name = 'AdbError'
  }
}

export type AdbBinarySource = 'env' | 'path' | 'sdk' | 'unavailable'

/** How adb is launched: env override, PATH hit, SDK default, or not at all. */
export interface AdbBinary {
  available: boolean
  source: AdbBinarySource
  /** Absolute path of the adb executable when available. */
  command?: string
  /** Why adb is unavailable. */
  reason?: string
}

/** `adb devices -l` connection states this module distinguishes. */
export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | 'recovery' | 'sideload' | 'unknown'

/** One row of `adb devices -l`, plus what the serial itself reveals. */
export interface AndroidDevice {
  serial: string
  state: AdbDeviceState
  /** True for `emulator-<port>` serials (and goldfish/ranchu products). */
  emulator: boolean
  /** Trailing `key:value` fields of the listing row (model, product, …). */
  model?: string
  product?: string
  transportId?: string
}

/** getprop-backed details of one online device. */
export interface AndroidDeviceDetails {
  serial: string
  model?: string
  manufacturer?: string
  /** Human Android version (`ro.build.version.release`). */
  androidVersion?: string
  /** API level (`ro.build.version.sdk`). */
  sdk?: number
  /** The AVD name for an emulator, when the console answers. */
  avdName?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isExecutableFile(path: string): boolean {
  try {
    const info = statSync(path)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function findOnPath(command: string): string | undefined {
  const names = process.platform === 'win32' ? [`${command}.exe`, command] : [command]
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return undefined
}

/** SDK roots worth probing, most explicit first. */
function sdkRootCandidates(): string[] {
  const roots: string[] = []
  for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = process.env[env]?.trim()
    if (value !== undefined && value !== '') roots.push(value)
  }
  const home = homedir()
  if (process.platform === 'darwin') roots.push(join(home, 'Library', 'Android', 'sdk'))
  else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData !== undefined && localAppData !== '') roots.push(join(localAppData, 'Android', 'Sdk'))
  } else roots.push(join(home, 'Android', 'Sdk'))
  return roots
}

function executableName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

/**
 * Resolve how to launch adb:
 * 1. an explicit `ADB` env var pointing at the executable;
 * 2. `adb` on PATH;
 * 3. `<sdk-root>/platform-tools/adb` for the usual SDK roots.
 */
export function resolveAdbBinary(): AdbBinary {
  const env = process.env.ADB?.trim()
  if (env !== undefined && env !== '') {
    if (isExecutableFile(env)) return { available: true, source: 'env', command: env }
    return { available: false, source: 'unavailable', reason: `the ADB env var (${env}) is not an executable file` }
  }
  const onPath = findOnPath('adb')
  if (onPath !== undefined) return { available: true, source: 'path', command: onPath }
  for (const root of sdkRootCandidates()) {
    const candidate = join(root, 'platform-tools', executableName('adb'))
    if (isExecutableFile(candidate)) return { available: true, source: 'sdk', command: candidate }
  }
  return {
    available: false,
    source: 'unavailable',
    reason: 'adb was not found (set ADB, add it to PATH, or install the Android SDK platform-tools)',
  }
}

/**
 * Best-effort discovery of the `emulator` launcher, used ONLY by the
 * boot-an-AVD verb. Order: SDK roots → derived from the adb location
 * (`<sdk>/platform-tools/adb` → `<sdk>/emulator/emulator`) → PATH. Every
 * other verb works without it — machines differ in which emulator product
 * (if any) they have installed, and adb is the only contract.
 */
export function resolveEmulatorBinary(adb?: AdbBinary): { available: boolean; command?: string; reason?: string } {
  const name = executableName('emulator')
  for (const root of sdkRootCandidates()) {
    const candidate = join(root, 'emulator', name)
    if (isExecutableFile(candidate)) return { available: true, command: candidate }
  }
  const adbCommand = (adb ?? resolveAdbBinary()).command
  if (adbCommand !== undefined) {
    const candidate = join(dirname(dirname(adbCommand)), 'emulator', name)
    if (isExecutableFile(candidate)) return { available: true, command: candidate }
  }
  const onPath = findOnPath('emulator')
  if (onPath !== undefined) return { available: true, command: onPath }
  return {
    available: false,
    reason: 'the Android emulator launcher was not found next to adb, in the SDK, or on PATH — '
      + 'start your emulator or device by any means and it will appear in android_devices once adb sees it',
  }
}

export interface ExecOptions {
  /** Target device serial (`adb -s <serial> …`). */
  serial?: string
  timeoutMs?: number
  maxBuffer?: number
}

/** Name the actual cause of a dead child: timeout, signal, or exit status. */
function describeExecFailure(error: { killed?: boolean; signal?: NodeJS.Signals | string | null; code?: string | number | undefined }, timeoutMs: number): string {
  if (error.killed === true) return `timed out after ${timeoutMs} ms`
  if (error.signal !== undefined && error.signal !== null) return `killed by ${error.signal}`
  if (error.code === 'ENOENT') return 'the executable was not found'
  return `exit ${String(error.code)}`
}

function execBinary(
  command: string,
  args: readonly string[],
  label: string,
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      timeout: timeoutMs,
      maxBuffer: options.maxBuffer ?? MAX_EXEC_BUFFER,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error !== null) {
        const cause = describeExecFailure(error, timeoutMs)
        const detail = stderr.trim()
        const exitCode = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null
        reject(new AdbError(
          `${label} ${args.join(' ')} failed (${cause})${detail === '' ? '' : `: ${detail}`}`,
          args,
          stderr,
          exitCode,
        ))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

/** One resolved adb toolchain with exec/spawn helpers bound to it. */
export class AdbToolchain {
  readonly binary: AdbBinary

  constructor(binary?: AdbBinary) {
    this.binary = binary ?? resolveAdbBinary()
  }

  get available(): boolean {
    return this.binary.available
  }

  /** Throw the explanatory unavailable error tools surface verbatim. */
  requireAdb(): string {
    if (!this.binary.available || this.binary.command === undefined) {
      throw new AdbError(`dsh-android: adb is unavailable — ${this.binary.reason ?? 'unknown reason'}`, [])
    }
    return this.binary.command
  }

  /** Run `adb [-s serial] <args…>` and collect text output. */
  exec(args: readonly string[], options: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
    const command = this.requireAdb()
    const full = options.serial === undefined ? args : ['-s', options.serial, ...args]
    return execBinary(command, full, 'adb', options)
  }

  /**
   * Run `adb -s <serial> exec-out <command…>` and collect BINARY stdout.
   * exec-out skips the pty so PNG bytes (screencap) survive unmangled.
   */
  execOut(serial: string, command: readonly string[], options: { timeoutMs?: number; maxBuffer?: number } = {}): Promise<Buffer> {
    const adb = this.requireAdb()
    const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      execFile(adb, ['-s', serial, 'exec-out', ...command], {
        timeout: timeoutMs,
        maxBuffer: options.maxBuffer ?? MAX_EXEC_BUFFER,
        encoding: 'buffer',
      }, (error, stdout, stderr) => {
        if (error !== null) {
          const cause = describeExecFailure(error, timeoutMs)
          const detail = stderr.toString('utf8').trim()
          reject(new AdbError(
            `adb exec-out ${command.join(' ')} failed (${cause})${detail === '' ? '' : `: ${detail}`}`,
            command,
            stderr.toString('utf8'),
            typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null,
          ))
          return
        }
        resolve(stdout)
      })
    })
  }

  /** Run `adb -s <serial> shell <command…>` and return trimmed stdout. */
  async shell(serial: string, command: readonly string[], options: { timeoutMs?: number; maxBuffer?: number } = {}): Promise<string> {
    const { stdout } = await this.exec(['shell', ...command], { serial, ...options })
    return stdout.replace(/\r\n/g, '\n')
  }

  /** Spawn a long-lived `adb -s <serial> exec-out <command…>` child. */
  spawnExecOut(serial: string, command: readonly string[]): ChildProcess {
    const adb = this.requireAdb()
    return spawn(adb, ['-s', serial, 'exec-out', ...command], { stdio: ['ignore', 'pipe', 'pipe'] })
  }

  /** Parse `adb devices -l` (skips the header and daemon-start noise). */
  async listDevices(): Promise<AndroidDevice[]> {
    const { stdout } = await this.exec(['devices', '-l'])
    const devices: AndroidDevice[] = []
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('List of devices') || trimmed.startsWith('*')) continue
      const match = /^(\S+)\s+(\S+)(.*)$/.exec(trimmed)
      if (match === null) continue
      const [, serial, rawState, rest] = match
      const state: AdbDeviceState = (
        ['device', 'offline', 'unauthorized', 'recovery', 'sideload'] as const
      ).find(known => known === rawState) ?? 'unknown'
      const fields = new Map<string, string>()
      for (const pair of (rest ?? '').trim().split(/\s+/)) {
        const colon = pair.indexOf(':')
        if (colon > 0) fields.set(pair.slice(0, colon), pair.slice(colon + 1))
      }
      const product = fields.get('product')
      devices.push({
        serial: serial!,
        state,
        emulator: serial!.startsWith('emulator-')
          || (product !== undefined && /goldfish|ranchu|sdk_gphone|emulator/i.test(product)),
        ...(fields.has('model') ? { model: fields.get('model')!.replace(/_/g, ' ') } : {}),
        ...(product === undefined ? {} : { product }),
        ...(fields.has('transport_id') ? { transportId: fields.get('transport_id')! } : {}),
      })
    }
    return devices
  }

  /** Devices in the `device` (fully online) state. */
  async onlineDevices(): Promise<AndroidDevice[]> {
    return (await this.listDevices()).filter(device => device.state === 'device')
  }

  /** getprop-backed details; every field is best-effort. */
  async deviceDetails(device: AndroidDevice): Promise<AndroidDeviceDetails> {
    const details: AndroidDeviceDetails = { serial: device.serial }
    try {
      const output = await this.shell(device.serial, [
        'getprop ro.product.model; getprop ro.product.manufacturer; getprop ro.build.version.release; getprop ro.build.version.sdk',
      ])
      const [model, manufacturer, release, sdk] = output.split('\n').map(line => line.trim())
      if (model !== undefined && model !== '') details.model = model
      if (manufacturer !== undefined && manufacturer !== '') details.manufacturer = manufacturer
      if (release !== undefined && release !== '') details.androidVersion = release
      const sdkNumber = Number(sdk)
      if (Number.isSafeInteger(sdkNumber) && sdkNumber > 0) details.sdk = sdkNumber
    } catch {
      // A flaky/offline device still lists; details just stay sparse.
    }
    if (device.emulator) {
      try {
        // `adb emu avd name` answers `<name>\nOK`; adb injects the console
        // auth token itself, so this works without touching the console port.
        const { stdout } = await this.exec(['emu', 'avd', 'name'], { serial: device.serial, timeoutMs: 5_000 })
        const name = stdout.split('\n').map(line => line.trim()).find(line => line !== '' && line !== 'OK')
        if (name !== undefined) details.avdName = name
      } catch {
        // Console not answering is fine; the serial remains the identity.
      }
    }
    return details
  }

  /**
   * The device screen size in pixels, from `wm size`. An override (what apps
   * actually render at) wins over the physical panel size.
   */
  async screenSize(serial: string): Promise<{ width: number; height: number }> {
    const output = await this.shell(serial, ['wm', 'size'])
    let physical: { width: number; height: number } | undefined
    let override: { width: number; height: number } | undefined
    for (const line of output.split('\n')) {
      const match = /(Physical|Override) size:\s*(\d+)x(\d+)/.exec(line)
      if (match === null) continue
      const size = { width: Number(match[2]), height: Number(match[3]) }
      if (match[1] === 'Override') override = size
      else physical = size
    }
    const size = override ?? physical
    if (size === undefined) throw new AdbError(`dsh-android: \`wm size\` returned no size for ${serial}: ${output.trim()}`, ['wm', 'size'])
    return size
  }

  /** Poll `sys.boot_completed` until the device finishes booting. */
  async waitForBoot(serial: string, timeoutMs = DEFAULT_BOOT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const value = await this.shell(serial, ['getprop', 'sys.boot_completed'], { timeoutMs: 5_000 })
        if (value.trim() === '1') return
      } catch {
        // adb itself may flap while the emulator restarts its transport.
      }
      if (Date.now() >= deadline) {
        throw new AdbError(`dsh-android: ${serial} did not finish booting within ${timeoutMs} ms`, [])
      }
      await new Promise(resolve => setTimeout(resolve, BOOT_POLL_INTERVAL_MS))
    }
  }
}

/** Serial pattern accepted by routes/tools (`emulator-5554`, USB, ip:port). */
export const SERIAL_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._:-]{0,127}$/

function execEmulator(command: string, args: readonly string[], options: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return execBinary(command, args, 'emulator', options)
}

/** List the machine's AVD names, when an emulator launcher is discoverable. */
export async function listAvds(): Promise<string[]> {
  const emulator = resolveEmulatorBinary()
  if (!emulator.available || emulator.command === undefined) return []
  try {
    const { stdout } = await execEmulator(emulator.command, ['-list-avds'], { timeoutMs: 15_000 })
    return stdout
      .split('\n')
      .map(line => line.trim())
      // Newer launchers print INFO chatter around the names; keep bare names.
      .filter(line => line !== '' && !line.includes(' ') && !line.startsWith('INFO'))
  } catch {
    return []
  }
}

/**
 * Launch one AVD detached and resolve the serial adb assigns it. The
 * launcher process is deliberately NOT owned or reaped by the plugin: an
 * emulator the user boots through us should outlive the conversation, the
 * same way a hand-booted one would (adb, not the launcher, is the contract).
 */
export async function bootAvd(
  toolchain: AdbToolchain,
  avdName: string,
  options: { timeoutMs?: number; extraArgs?: readonly string[] } = {},
): Promise<{ serial: string }> {
  const emulator = resolveEmulatorBinary(toolchain.binary)
  if (!emulator.available || emulator.command === undefined) {
    throw new AdbError(`dsh-android: cannot boot the AVD — ${emulator.reason ?? 'no emulator launcher'}`, [])
  }
  const before = new Set((await toolchain.listDevices()).filter(device => device.emulator).map(device => device.serial))
  const child = spawn(emulator.command, [
    '-avd', avdName,
    '-no-snapshot-save',
    '-no-boot-anim',
    '-no-audio',
    ...(options.extraArgs ?? []),
  ], { stdio: 'ignore', detached: true })
  child.unref()
  const spawnError = await new Promise<Error | undefined>(resolve => {
    child.once('error', error => resolve(error))
    child.once('spawn', () => resolve(undefined))
  })
  if (spawnError !== undefined) {
    throw new AdbError(`dsh-android: the emulator launcher failed to start: ${errorMessage(spawnError)}`, ['-avd', avdName])
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let serial: string | undefined
  while (serial === undefined) {
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new AdbError(`dsh-android: the emulator launcher for ${avdName} exited with code ${child.exitCode} before the device appeared`, ['-avd', avdName])
    }
    const emulators = (await toolchain.listDevices().catch(() => [] as AndroidDevice[])).filter(device => device.emulator)
    // Prefer a serial that did not exist before this launch; fall back to an
    // existing emulator that answers to the requested AVD name (the launcher
    // deduplicates a second boot of the same AVD into the running instance).
    serial = emulators.find(device => !before.has(device.serial))?.serial
    if (serial === undefined) {
      for (const device of emulators) {
        const details = await toolchain.deviceDetails(device)
        if (details.avdName === avdName) {
          serial = device.serial
          break
        }
      }
    }
    if (serial === undefined) {
      if (Date.now() >= deadline) {
        throw new AdbError(`dsh-android: no emulator serial appeared for ${avdName} within ${timeoutMs} ms`, ['-avd', avdName])
      }
      await new Promise(resolve => setTimeout(resolve, BOOT_POLL_INTERVAL_MS))
    }
  }
  await toolchain.waitForBoot(serial, Math.max(1_000, deadline - Date.now()))
  return { serial }
}
