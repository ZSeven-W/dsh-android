/**
 * Vision/Tesseract OCR resolution, compilation, execution, and coordinate
 * conversion — the backend of `android_find_text` / `android_tap_text` /
 * `android_wait_for`.
 *
 * The uiautomator view hierarchy stays the primary UI-inspection source; OCR
 * covers what it cannot see: screens with no view hierarchy at all (Unity/
 * Unreal/Flutter-impeller surfaces, game canvases, `SurfaceView` video),
 * WebView content that reports one opaque node, text rendered as graphics
 * (badge counts, prices baked into images), and independent verification of
 * what is actually on screen.
 *
 * The helper is a plugin-owned Swift source (`assets/ocr.swift`, Vision's
 * `VNRecognizeTextRequest`, accurate, zh-Hans + en-US) compiled ON FIRST
 * USE into the plugin cache:
 *
 *     ~/Library/Caches/dsh-android/bin/ocr/<sha256(source)[0..16]>/ocr
 *
 * The cache key is the source hash, so an edited helper recompiles into a
 * fresh slot; the compiled binary's digest is recorded next to it and
 * re-checked on every resolution, so a corrupted artifact is rebuilt.
 * The helper runs on the HOST, on a PNG the plugin already captured through
 * `adb exec-out screencap`, so it needs nothing from the device — but it does
 * need macOS for Vision. Other hosts use an optional installed Tesseract
 * executable and requested language data. Backend selection is explicit or
 * automatic; no binary or language data is installed by a tool invocation.
 *
 * COORDINATE SPACE: unlike the iOS twin this module has exactly ONE space.
 * The helper emits boxes in IMAGE PIXELS (origin top-left), the Android
 * screenshot IS the display in pixels, and `AndroidHostController.tap` takes
 * normalized 0..1 of that same frame — so the only conversion needed is a
 * division by the screenshot's own pixel size. There is no point/pixel scale
 * factor anywhere in the Android path (docs/architecture.zh.md, decision 2).
 * @module @zseven-w/dsh-android/ocr-backend
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginEnv } from './plugin-env.js'

/** Install hint appended to every helper-unavailable tool error. */
export const OCR_INSTALL_HINT = 'android_find_text / android_tap_text / android_wait_for use Vision on macOS '
  + '(Xcode or Command Line Tools) or an optional installed Tesseract executable. '
  + 'For Tesseract, install eng + chi_sim language data or configure DSHPLUGIN_ANDROID_TESSERACT_LANGUAGES. '
  + 'Use DSHPLUGIN_ANDROID_OCR_BACKEND=auto|vision|tesseract to select a backend'

/** Cache base dir; `DSHPLUGIN_ANDROID_OCR_DIR` overrides it (tests/CI). */
const OCR_CACHE_BASE = join(homedir(), 'Library', 'Caches', 'dsh-android', 'bin', 'ocr')
/** Well-known swiftc locations, probed even with a trimmed PATH. */
const SWIFTC_CANDIDATES = ['/usr/bin/swiftc', '/usr/local/bin/swiftc']
const OCR_COMPILE_TIMEOUT_MS = 5 * 60 * 1000
const OCR_EXEC_TIMEOUT_MS = 120_000
const OCR_MAX_BUFFER_BYTES = 8 * 1024 * 1024

/** Where the resolved OCR helper came from. */
export type OcrBinarySource = 'path' | 'cache' | 'unavailable'

/** One resolved OCR helper binary. */
export interface OcrBinary {
  available: boolean
  source: OcrBinarySource
  /** Absolute path of the executable (when available). */
  command?: string
  /** Why resolution failed (when unavailable). */
  reason?: string
  /** One-line install hint for the model (always set when unavailable). */
  installHint: string
  /** True when everything needed to compile the bundled helper exists. */
  compilable?: boolean
  backend?: 'vision' | 'tesseract'
  languages?: string
  dataDir?: string
}

/** One OCR box: image pixels, origin top-left. */
export interface OcrRect {
  x: number
  y: number
  w: number
  h: number
}

/** One recognized text item (box in image pixels). */
export interface OcrItem {
  text: string
  confidence: number
  rect: OcrRect
}

/** A size in image pixels. */
export interface PixelSize {
  width: number
  height: number
}

function isExecutableFile(path: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const info = statSync(path)
    return info.isFile() && (platform === 'win32' || (info.mode & 0o111) !== 0)
  } catch {
    return false
  }
}

function findOnPath(command: string, platform: NodeJS.Platform = process.platform): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, command)
    if (isExecutableFile(candidate, platform)) return candidate
  }
  return undefined
}

function sha256File(path: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

/** Plugin cache base dir for the compiled helper. */
export function ocrCacheBase(): string {
  const override = pluginEnv('ANDROID_OCR_DIR')
  return override !== undefined && override.trim() !== '' ? override.trim() : OCR_CACHE_BASE
}

/** Cache dir for one source revision (keyed by the source hash). */
function ocrCacheInstallDir(sourceSha256: string): string {
  return join(ocrCacheBase(), sourceSha256.slice(0, 16))
}

/**
 * Resolve the bundled Swift source (`assets/ocr.swift`): an explicit
 * `DSHPLUGIN_ANDROID_OCR_SWIFT` override wins — and a bad override FAILS instead of
 * silently falling through — then the path relative to this compiled module
 * (works from `lib/` in the repo and inside the installed package), then a
 * cwd-relative fallback for development working copies.
 */
export function resolveOcrSwiftSource(): { path?: string; reason?: string } {
  const explicit = pluginEnv('ANDROID_OCR_SWIFT')
  if (explicit !== undefined && explicit.trim() !== '') {
    const candidate = explicit.trim()
    try {
      if (statSync(candidate).isFile()) return { path: candidate }
    } catch {
      // Missing override → hard failure below.
    }
    return { reason: `DSHPLUGIN_ANDROID_OCR_SWIFT points at a missing or unreadable file: ${candidate}` }
  }
  const candidates: string[] = []
  candidates.push(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'ocr.swift'))
  candidates.push(join(process.cwd(), 'assets', 'ocr.swift'))
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return { path: candidate }
    } catch {
      // Try the next candidate.
    }
  }
  return { reason: `the bundled OCR Swift source was not found (tried ${candidates.join(', ')})` }
}

/** The swiftc compiler to use (explicit override → PATH → well-known). */
function resolveSwiftc(): { command?: string; reason?: string } {
  const explicit = pluginEnv('ANDROID_SWIFTC')
  if (explicit !== undefined && explicit.trim() !== '') {
    if (isExecutableFile(explicit.trim())) return { command: explicit.trim() }
    return { reason: `DSHPLUGIN_ANDROID_SWIFTC points at a missing or non-executable file: ${explicit.trim()}` }
  }
  const onPath = findOnPath('swiftc')
  if (onPath !== undefined) return { command: onPath }
  const known = SWIFTC_CANDIDATES.find(path => isExecutableFile(path))
  if (known !== undefined) return { command: known }
  return { reason: 'swiftc (the Swift compiler) was not found on PATH — install Xcode or the Command Line Tools' }
}

/**
 * Validate a cached compile: executable binary + recorded digest matches the
 * BINARY's own bytes (the cache slot is keyed by the source hash; the digest
 * pins the compiled artifact against corruption).
 */
function validCachedBinary(sourceSha256: string): string | undefined {
  const binary = join(ocrCacheInstallDir(sourceSha256), 'ocr')
  if (!isExecutableFile(binary)) return undefined
  const digestFile = join(ocrCacheInstallDir(sourceSha256), '.dsh-android-ocr-source.sha256')
  try {
    const recorded = readFileSync(digestFile, 'utf8').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(recorded)) return undefined
    return recorded === sha256File(binary) ? binary : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the OCR helper synchronously: host platform + source file + swiftc
 * probe + cache digest validation. Never compiles; `ensureOcrBinary()` adds
 * the compile-on-first-use step.
 */
function resolveVisionBinary(platform: NodeJS.Platform): OcrBinary {
  if (platform !== 'darwin') {
    return {
      available: false,
      source: 'unavailable',
      reason: `the Vision OCR backend needs a macOS host; this host runs ${platform}. Select Tesseract for this host`,
      installHint: OCR_INSTALL_HINT,
    }
  }
  const source = resolveOcrSwiftSource()
  if (source.path === undefined) {
    return {
      available: false,
      source: 'unavailable',
      reason: source.reason,
      installHint: OCR_INSTALL_HINT,
    }
  }
  const swiftc = resolveSwiftc()
  if (swiftc.command === undefined) {
    return {
      available: false,
      source: 'unavailable',
      reason: swiftc.reason,
      installHint: OCR_INSTALL_HINT,
    }
  }
  const sourceSha256 = sha256File(source.path)
  const cached = validCachedBinary(sourceSha256)
  if (cached !== undefined) {
    return { available: true, source: 'cache', command: cached, installHint: OCR_INSTALL_HINT }
  }
  return {
    available: false,
    source: 'unavailable',
    reason: 'the OCR helper has not been compiled into the plugin cache yet (compiled on first use)',
    installHint: OCR_INSTALL_HINT,
    compilable: true,
  }
}

function hasVisionOverride(): boolean {
  return ['ANDROID_OCR_SWIFT', 'ANDROID_SWIFTC'].some(name => (pluginEnv(name) ?? '').trim() !== '')
}

function resolveTesseractBinary(platform: NodeJS.Platform): OcrBinary {
  const unavailable = (reason: string): OcrBinary => ({ available: false, source: 'unavailable', backend: 'tesseract', reason, installHint: OCR_INSTALL_HINT })
  const languages = (pluginEnv('ANDROID_TESSERACT_LANGUAGES') ?? '').trim() || 'eng+chi_sim'
  if (!/^[A-Za-z0-9_-]+(?:\+[A-Za-z0-9_-]+)*$/.test(languages)) {
    return unavailable('DSHPLUGIN_ANDROID_TESSERACT_LANGUAGES must contain language identifiers joined by + (for example eng+chi_sim)')
  }
  const explicit = (pluginEnv('ANDROID_TESSERACT_BINARY') ?? '').trim()
  const name = platform === 'win32' ? 'tesseract.exe' : 'tesseract'
  const known = platform === 'win32'
    ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tesseract-OCR', name)]
    : ['/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/usr/bin/tesseract']
  const command = explicit !== '' ? explicit : findOnPath(name, platform) ?? known.find(path => isExecutableFile(path, platform))
  if (command === undefined || !isExecutableFile(command, platform)) {
    return unavailable(explicit !== ''
      ? `DSHPLUGIN_ANDROID_TESSERACT_BINARY points at a missing or non-executable file: ${explicit}`
      : 'Tesseract was not found on PATH or in a standard install location; install it to enable OCR on this host')
  }
  const dataDir = (pluginEnv('ANDROID_TESSERACT_DATA_DIR') ?? '').trim()
  return { available: true, source: 'path', backend: 'tesseract', command, languages,
    ...(dataDir === '' ? {} : { dataDir }), installHint: OCR_INSTALL_HINT }
}

/** Prefer Vision on macOS; otherwise use optional host-installed Tesseract. */
export function resolveOcrBinary(options: { platform?: NodeJS.Platform } = {}): OcrBinary {
  const platform = options.platform ?? process.platform
  const backend = (pluginEnv('ANDROID_OCR_BACKEND') ?? '').trim().toLowerCase() || 'auto'
  if (!['auto', 'vision', 'tesseract'].includes(backend)) {
    return { available: false, source: 'unavailable', reason: 'DSHPLUGIN_ANDROID_OCR_BACKEND must be auto, vision or tesseract', installHint: OCR_INSTALL_HINT }
  }
  if (backend === 'tesseract' || (backend === 'auto' && platform !== 'darwin')) return resolveTesseractBinary(platform)
  const vision: OcrBinary = { ...resolveVisionBinary(platform), backend: 'vision' }
  if (backend === 'vision' || vision.available || vision.compilable || hasVisionOverride()) return vision
  const tesseract = resolveTesseractBinary(platform)
  return tesseract.available ? tesseract : { ...vision, reason: [vision.reason, tesseract.reason].filter(Boolean).join('; ') }
}

/** Run the compiled helper. Non-zero exits raise with its stderr/stdout. */
export function execOcr(
  binary: OcrBinary,
  imagePath: string,
  signal?: AbortSignal,
  timeoutMs = OCR_EXEC_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  if (!binary.available || binary.command === undefined) {
    return Promise.reject(new Error(`the OCR helper is unavailable${binary.reason === undefined ? '' : ` (${binary.reason})`}; ${binary.installHint}`))
  }
  return new Promise((resolve, reject) => {
    const args = binary.backend === 'tesseract'
      ? [imagePath, 'stdout', '-l', binary.languages ?? 'eng+chi_sim', '--psm', '11',
          ...(binary.dataDir === undefined ? [] : ['--tessdata-dir', binary.dataDir]), '-c', 'tessedit_create_tsv=1']
      : [imagePath]
    execFile(binary.command!, args, {
      timeout: timeoutMs,
      maxBuffer: OCR_MAX_BUFFER_BYTES,
      signal,
    }, (error, stdout, stderr) => {
      if (error !== null) {
        const detail = stderr.trim() || stdout.trim()
        reject(new Error(`OCR helper failed${detail === '' ? '' : `: ${detail}`}`))
        return
      }
      // Tesseract can exit 0 after failing one requested language and then
      // recognize with the remaining models. Do not silently turn a Chinese
      // request into English-only OCR.
      if (binary.backend === 'tesseract' && /Failed loading language|couldn't load any languages/i.test(stderr)) {
        reject(new Error(`Tesseract language data is unavailable: ${stderr.trim()}; ${binary.installHint}`))
        return
      }
      if (binary.backend === 'tesseract') {
        try {
          const items = parseTesseractTsv(stdout).map(({ text, confidence, rect }) => ({ text, confidence, ...rect }))
          resolve({ stdout: JSON.stringify({ items }), stderr })
        } catch (parseError) { reject(parseError) }
      } else resolve({ stdout, stderr })
    })
  })
}

/**
 * Compile the bundled Swift source into the plugin cache
 * (`~/Library/Caches/dsh-android/bin/ocr/<hash>/ocr`), then record the
 * compiled binary's digest next to it for later integrity checks. The fresh
 * binary is sanity-launched (its no-argument usage path) before it replaces
 * any previous artifact.
 */
async function compileOcrHelper(): Promise<string> {
  const source = resolveOcrSwiftSource()
  const swiftc = resolveSwiftc()
  if (source.path === undefined || swiftc.command === undefined) {
    const reason = source.reason ?? swiftc.reason
    throw new Error(`cannot compile the OCR helper${reason === undefined ? '' : ` (${reason})`}; ${OCR_INSTALL_HINT}`)
  }
  const base = ocrCacheBase()
  const sourceSha256 = sha256File(source.path)
  const installDir = ocrCacheInstallDir(sourceSha256)
  const binary = join(installDir, 'ocr')
  const digestFile = join(installDir, '.dsh-android-ocr-source.sha256')
  const cached = validCachedBinary(sourceSha256)
  if (cached !== undefined) return cached
  mkdirSync(base, { recursive: true })
  mkdirSync(installDir, { recursive: true })
  const tmp = join(base, `.ocr-${sourceSha256.slice(0, 16)}-${process.pid}-${Date.now()}.tmp`)
  try {
    await new Promise<void>((resolveCompile, rejectCompile) => {
      execFile(swiftc.command!, ['-O', source.path!, '-o', tmp], { timeout: OCR_COMPILE_TIMEOUT_MS, maxBuffer: OCR_MAX_BUFFER_BYTES }, error => {
        if (error !== null) {
          rejectCompile(new Error(`swiftc -O ${source.path} failed: ${error.message}`))
        } else {
          resolveCompile()
        }
      })
    })
    // Sanity launch: with no arguments the helper prints its usage and exits
    // 2 — that proves the binary runs (its dylibs load) without touching a
    // screenshot.
    await new Promise<void>((resolveRun, rejectRun) => {
      execFile(tmp, [], { timeout: 60_000, maxBuffer: 1024 * 1024 }, error => {
        if (error === null || (typeof error.code === 'number' && error.code === 2)) resolveRun()
        else rejectRun(new Error(`compiled OCR helper failed its sanity launch: ${error.message}`))
      })
    })
    renameSync(tmp, binary)
    // Pin the COMPILED binary's digest (the directory is already keyed by
    // the source hash): a corrupted artifact fails validation on the next
    // resolution and gets recompiled.
    writeFileSync(digestFile, `${sha256File(binary)}\n`, 'utf8')
    return binary
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Shared in-flight compile so concurrent tool calls wait on one build. */
let compilePromise: Promise<string> | undefined

const checkedTesseractLanguages = new Map<string, number>()
async function ensureTesseractLanguages(binary: OcrBinary): Promise<OcrBinary> {
  const languages = binary.languages ?? 'eng+chi_sim'
  const key = JSON.stringify([binary.command, languages, binary.dataDir, process.env.TESSDATA_PREFIX])
  const checkedAt = checkedTesseractLanguages.get(key)
  if (checkedAt !== undefined && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < 300_000) return binary
  const result = await new Promise<{ stdout: string; error?: string }>(resolve => {
    execFile(binary.command!, ['--list-langs', ...(binary.dataDir === undefined ? [] : ['--tessdata-dir', binary.dataDir])],
      { timeout: 5_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => resolve({ stdout,
        ...(error === null ? {} : { error: stderr.trim() || error.message }) }))
  })
  const installed = new Set(result.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]+$/.test(s)))
  const missing = languages.split('+').filter(language => !installed.has(language))
  if (result.error !== undefined || missing.length > 0) return { ...binary, available: false, source: 'unavailable',
    reason: result.error ?? `Tesseract language data is missing: ${missing.join(', ')}` }
  checkedTesseractLanguages.set(key, Date.now())
  return binary
}

/**
 * Resolve the helper, compiling the bundled source into the plugin cache
 * when it is absent (macOS with swiftc only). Resolution-only failure is
 * never fatal here: the returned object carries the reason and the install
 * hint for the tool to throw.
 */
export async function ensureOcrBinary(): Promise<OcrBinary> {
  const resolved = resolveOcrBinary()
  if (resolved.available && resolved.backend === 'tesseract') return ensureTesseractLanguages(resolved)
  if (resolved.available || resolved.compilable !== true) return resolved
  if (compilePromise === undefined) {
    compilePromise = compileOcrHelper().catch(error => {
      throw new Error(`OCR helper compilation failed (${error instanceof Error ? error.message : String(error)}); ${OCR_INSTALL_HINT}`)
    }).finally(() => {
      compilePromise = undefined
    })
  }
  try { await compilePromise } catch (error) {
    if (((pluginEnv('ANDROID_OCR_BACKEND') ?? '').trim().toLowerCase() || 'auto') === 'auto' && !hasVisionOverride()) {
      const tesseract = resolveTesseractBinary(process.platform)
      if (tesseract.available) return ensureTesseractLanguages(tesseract)
    }
    throw error
  }
  return resolveOcrBinary()
}

/** TSV word rows are regrouped by page/block/paragraph/line into UI labels. */
export function parseTesseractTsv(stdout: string): OcrItem[] {
  const rows = stdout.replace(/^\uFEFF/, '').split(/\r?\n/)
  const header = rows.shift()?.split('\t')
  const expected = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text']
  if (header === undefined || expected.some((name, i) => header[i] !== name)) throw new Error('Tesseract returned an invalid TSV header')
  type Word = { text: string; confidence: number; x: number; y: number; w: number; h: number; order: number }
  const lines = new Map<string, Word[]>()
  const seen = new Set<string>()
  for (const row of rows) {
    const fields = row.split('\t')
    if (fields.length < 12 || fields[0] !== '5') continue
    if (fields.slice(1, 6).some(value => !/^[1-9]\d*$/.test(value))) continue
    const ids = fields.slice(1, 6).map(Number)
    const numeric = fields.slice(6, 11)
    if (numeric.some(value => value.trim() === '' || !/^-?\d+(?:\.\d+)?$/.test(value))) continue
    const [x, y, w, h, conf] = numeric.map(Number)
    const text = fields.slice(11).join('\t').trim()
    if (text === '' || ids.some(n => !Number.isSafeInteger(n) || n < 1)
      || [x, y, w, h, conf].some(n => n === undefined || !Number.isFinite(n))
      || x! < 0 || y! < 0 || w! <= 0 || h! <= 0 || conf! < 0 || conf! > 100) continue
    const key = ids.slice(0, 4).join(':')
    const duplicate = key + ':' + fields.slice(5).join('\t')
    if (seen.has(duplicate)) continue
    seen.add(duplicate)
    const words = lines.get(key) ?? []
    words.push({ text, confidence: conf! / 100, x: x!, y: y!, w: w!, h: h!, order: ids[4]! })
    lines.set(key, words)
  }
  const cjkEnd = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u
  const cjkStart = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
  const items: OcrItem[] = []
  for (const words of lines.values()) {
    words.sort((a, b) => a.order - b.order)
    let text = ''
    for (const word of words) {
      const attach = (cjkEnd.test(text) && cjkStart.test(word.text))
        || /^[.,!?;:，。！？、；：）\]】》」』]/u.test(word.text)
        || /[(（\[【《「『]$/u.test(text)
      text += (text === '' || attach ? '' : ' ') + word.text
    }
    let x = Infinity, y = Infinity, right = 0, bottom = 0, confidence = 0
    for (const word of words) {
      x = Math.min(x, word.x); y = Math.min(y, word.y)
      right = Math.max(right, word.x + word.w); bottom = Math.max(bottom, word.y + word.h)
      confidence += word.confidence
    }
    items.push({ text, confidence: confidence / words.length, rect: { x, y, w: right - x, h: bottom - y } })
  }
  return items.sort((a, b) => b.confidence - a.confidence)
}

/** Parse the helper's JSON payload into sanitized items (confidence-sorted). */
export function parseOcrOutput(stdout: string): OcrItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`the OCR helper returned non-JSON output: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('the OCR helper returned an unexpected payload (expected an object with an items array)')
  }
  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record.items)) {
    throw new Error('the OCR helper returned an unexpected payload (missing items array)')
  }
  const seen = new Set<string>()
  const items: OcrItem[] = []
  for (const entry of record.items) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : undefined
    const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : undefined
    const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : undefined
    const w = typeof raw.w === 'number' && Number.isFinite(raw.w) ? raw.w : undefined
    const h = typeof raw.h === 'number' && Number.isFinite(raw.h) ? raw.h : undefined
    if (text === '' || confidence === undefined || x === undefined || y === undefined || w === undefined || h === undefined) continue
    if (confidence < 0 || confidence > 1 || x < 0 || y < 0 || w < 0 || h < 0) continue
    // Exact-duplicate observations (same text at the same box) collapse.
    const key = `${text} ${x} ${y} ${w} ${h}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ text, confidence, rect: { x, y, w, h } })
  }
  // Highest confidence first (stable: equal confidence keeps Vision order).
  items.sort((a, b) => b.confidence - a.confidence)
  return items
}

/**
 * Filter OCR items: case-insensitive substring on the query and a
 * minimum-confidence floor. Empty/absent query keeps everything.
 */
export function filterOcrItems(
  items: readonly OcrItem[],
  query?: string,
  minConfidence = 0,
): OcrItem[] {
  const needle = query !== undefined && query.trim() !== '' ? query.trim().toLowerCase() : undefined
  return items.filter(item =>
    (needle === undefined || item.text.toLowerCase().includes(needle))
    && item.confidence >= minConfidence,
  )
}

function requireSize(size: PixelSize, what: string): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new RangeError(`dsh-android: ${what} must be a finite positive size, got ${size.width}x${size.height}`)
  }
}

/**
 * Pixel box → normalized 0..1 box. Only the screenshot's own pixel size
 * matters: `AndroidHostController.tap` multiplies by the live frame size
 * itself, and the frame IS the display.
 */
export function pixelRectToNormalized(rect: OcrRect, pixelSize: PixelSize): OcrRect {
  requireSize(pixelSize, 'pixelSize')
  return {
    x: rect.x / pixelSize.width,
    y: rect.y / pixelSize.height,
    w: rect.w / pixelSize.width,
    h: rect.h / pixelSize.height,
  }
}

/** Inverse of `pixelRectToNormalized` (normalized 0..1 → image pixels). */
export function normalizedRectToPixels(rect: OcrRect, pixelSize: PixelSize): OcrRect {
  requireSize(pixelSize, 'pixelSize')
  return {
    x: rect.x * pixelSize.width,
    y: rect.y * pixelSize.height,
    w: rect.w * pixelSize.width,
    h: rect.h * pixelSize.height,
  }
}

/** Center of a box (any space; the unit carries through). */
export function rectCenter(rect: OcrRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

/** Pixel box center → normalized 0..1 tap coordinates. */
export function pixelRectToNormalizedCenter(rect: OcrRect, pixelSize: PixelSize): { x: number; y: number } {
  requireSize(pixelSize, 'pixelSize')
  const center = rectCenter(rect)
  return { x: center.x / pixelSize.width, y: center.y / pixelSize.height }
}
