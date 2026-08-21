/**
 * In-process MJPEG-style frame pipeline for one Android device.
 *
 * dsh-ios leans on an external stream helper (serve-sim); Android needs none:
 * ONE persistent `adb exec-out` child runs a `screencap -p` loop on the
 * device, this module splits the concatenated PNG output into frames, and the
 * web routes serve the latest frame straight from memory as a
 * `multipart/x-mixed-replace` body (PNG parts — Chromium and Firefox render
 * those exactly like JPEG parts). No inner loopback port exists at all, so
 * there is nothing to proxy and nothing to fence beyond the DSH webserver
 * routes themselves.
 *
 * The persistent child is the measured heart of the design: spawning adb per
 * frame costs ~200 ms per screenshot (~5 fps ceiling at 100% churn), while a
 * single `while :; do screencap -p; done` child streams ~8 fps on an
 * emulator with zero per-frame process cost. Frame pacing is pull-less:
 * whatever cadence the device sustains is what consumers see.
 *
 * The child is intentionally dumb — it exits, this module reports it, and the
 * host controller (android-host.ts) owns restart/keep-alive policy, exactly
 * like the sim-host/serve-sim split in dsh-ios.
 * @module @zseven-w/dsh-android/frame-source
 */

import type { ChildProcess } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import type { AdbToolchain } from './adb.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IEND_TYPE = 0x49454e44 // 'IEND'
/** A screencap frame larger than this means we lost sync; rescan. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024
/** Bytes kept while hunting for a signature in garbage (stderr noise, …). */
const MAX_UNSYNCED_BYTES = 1024 * 1024
const STDERR_RING_LINES = 20
const STDERR_LINE_MAX_CHARS = 240
export const STREAM_BOUNDARY = 'dsh-android-frame'

/** One decoded frame: the full PNG plus its IHDR pixel size. */
export interface DeviceFrame {
  png: Buffer
  width: number
  height: number
  /** Monotonic frame index since the loop started. */
  sequence: number
  at: number
}

/** Pixel size of a PNG from its IHDR chunk, without decoding the image. */
export function pngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (buffer.readUInt32BE(12) !== 0x49484452) return undefined // 'IHDR'
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * Incremental splitter over a byte stream of back-to-back PNG images.
 *
 * PNG framing is self-describing (8-byte signature, then length-prefixed
 * chunks until IEND), so frames are cut by walking chunk headers — no
 * scanning of image data for markers, no false positives. When the stream
 * derails (device hiccup, interleaved noise) the splitter drops bytes until
 * the next signature instead of stalling.
 */
export class PngFrameSplitter {
  #buffer: Buffer = Buffer.alloc(0)

  /** Feed bytes; returns every complete PNG that ended inside them. */
  push(chunk: Buffer): Buffer[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    const frames: Buffer[] = []
    for (;;) {
      const start = this.#buffer.indexOf(PNG_SIGNATURE)
      if (start < 0) {
        // Pure garbage: keep a tail long enough to hold a split signature.
        if (this.#buffer.length > MAX_UNSYNCED_BYTES) {
          this.#buffer = this.#buffer.subarray(this.#buffer.length - PNG_SIGNATURE.length)
        }
        return frames
      }
      if (start > 0) this.#buffer = this.#buffer.subarray(start)
      const end = this.#frameEnd()
      if (end === undefined) {
        if (this.#buffer.length > MAX_FRAME_BYTES) {
          // Lost sync inside an impossibly large "frame": drop the signature
          // and rescan from the next byte.
          this.#buffer = this.#buffer.subarray(1)
          continue
        }
        return frames
      }
      frames.push(this.#buffer.subarray(0, end))
      this.#buffer = this.#buffer.subarray(end)
    }
  }

  /** Byte length of the complete PNG at the buffer start, if fully buffered. */
  #frameEnd(): number | undefined {
    let offset = PNG_SIGNATURE.length
    for (;;) {
      if (offset + 8 > this.#buffer.length) return undefined
      const dataLength = this.#buffer.readUInt32BE(offset)
      const type = this.#buffer.readUInt32BE(offset + 4)
      if (dataLength > MAX_FRAME_BYTES) return undefined // corrupt header; caller rescans
      const next = offset + 8 + dataLength + 4
      if (next > this.#buffer.length) return undefined
      if (type === IEND_TYPE) return next
      offset = next
    }
  }
}

export interface FrameLoopEvents {
  onFrame?: (frame: DeviceFrame) => void
  /** The child exited (code/signal) — restart policy belongs to the caller. */
  onExit?: (detail: string) => void
}

/**
 * Owns the one persistent screencap child for one device serial and the
 * latest-frame buffer every consumer reads from.
 */
export class AdbFrameLoop {
  #child: ChildProcess | undefined
  #splitter = new PngFrameSplitter()
  #latest: DeviceFrame | undefined
  #sequence = 0
  #stderrRing: string[] = []
  #stderrPartial = ''
  #frameWaiters: Array<(frame: DeviceFrame) => void> = []
  #stopped = false

  constructor(
    readonly serial: string,
    private readonly toolchain: AdbToolchain,
    private readonly events: FrameLoopEvents = {},
  ) {}

  get running(): boolean {
    const child = this.#child
    return child !== undefined && child.exitCode === null && child.signalCode === null
  }

  get latestFrame(): DeviceFrame | undefined {
    return this.#latest
  }

  get stderrLines(): string[] {
    return [...this.#stderrRing]
  }

  /** Spawn the screencap loop child (idempotent while running). */
  start(): void {
    if (this.running || this.#stopped) return
    // `exec-out` skips the pty (binary-safe); the single-string command runs
    // through the device shell, so one child produces frames forever.
    const child = this.toolchain.spawnExecOut(this.serial, ['while :; do screencap -p; done'])
    this.#child = child
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const png of this.#splitter.push(chunk)) this.#acceptFrame(png)
    })
    child.stderr?.on('data', (chunk: Buffer) => this.#recordStderr(chunk))
    child.once('error', error => {
      this.#recordStderr(Buffer.from(`spawn error: ${error.message}\n`))
    })
    child.once('close', (code, signal) => {
      if (this.#child !== child) return
      this.#child = undefined
      const detail = signal !== null ? `killed by ${signal}` : `exit ${String(code)}`
      if (!this.#stopped) this.events.onExit?.(detail)
    })
  }

  /** Kill the child; the loop object can be started again later. */
  stop(): void {
    this.#stopped = true
    const child = this.#child
    this.#child = undefined
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const hardKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2_000)
      hardKill.unref?.()
    }
    const waiters = this.#frameWaiters
    this.#frameWaiters = []
    // Settle pending waiters with the last frame if any; otherwise they will
    // time out on their own schedule.
    if (this.#latest !== undefined) for (const waiter of waiters) waiter(this.#latest)
  }

  /** Allow a stopped loop to be started again (host restart path). */
  reset(): void {
    this.#stopped = false
    this.#splitter = new PngFrameSplitter()
  }

  /** The next frame (or the latest one already buffered), bounded in time. */
  waitForFrame(timeoutMs: number): Promise<DeviceFrame | undefined> {
    const latest = this.#latest
    if (latest !== undefined) return Promise.resolve(latest)
    return new Promise(resolve => {
      let settled = false
      const waiter = (frame: DeviceFrame): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(frame)
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        const index = this.#frameWaiters.indexOf(waiter)
        if (index >= 0) this.#frameWaiters.splice(index, 1)
        resolve(undefined)
      }, timeoutMs)
      timer.unref?.()
      this.#frameWaiters.push(waiter)
    })
  }

  #acceptFrame(png: Buffer): void {
    const size = pngDimensions(png)
    if (size === undefined) return
    this.#sequence += 1
    const frame: DeviceFrame = {
      png,
      width: size.width,
      height: size.height,
      sequence: this.#sequence,
      at: Date.now(),
    }
    this.#latest = frame
    const waiters = this.#frameWaiters
    this.#frameWaiters = []
    for (const waiter of waiters) waiter(frame)
    this.events.onFrame?.(frame)
  }

  #recordStderr(chunk: Buffer): void {
    const text = this.#stderrPartial + chunk.toString('utf8')
    const lines = text.split('\n')
    this.#stderrPartial = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trimEnd()
      if (trimmed === '') continue
      this.#stderrRing.push(trimmed.length > STDERR_LINE_MAX_CHARS ? `${trimmed.slice(0, STDERR_LINE_MAX_CHARS)}…` : trimmed)
      if (this.#stderrRing.length > STDERR_RING_LINES) this.#stderrRing.shift()
    }
  }
}

/**
 * Write one live multipart/x-mixed-replace response from a frame feed.
 * Backpressure is latest-wins: when the client socket is saturated the
 * writer skips frames instead of queueing them, so a slow tab never builds
 * an unbounded buffer or watches a growing delay.
 *
 * Returns an `attach` pair the caller wires to its frame events, and relies
 * on the caller to invoke `close()` on client disconnect/disposal.
 */
export class MultipartFrameWriter {
  #closed = false
  #congested = false

  constructor(private readonly res: ServerResponse) {
    res.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
      'cache-control': 'no-cache, no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
    })
    res.on('drain', () => {
      this.#congested = false
    })
  }

  get closed(): boolean {
    return this.#closed
  }

  /** Write one frame part; silently skipped while the socket is congested. */
  writeFrame(frame: DeviceFrame): void {
    if (this.#closed || this.#congested) return
    const header = `--${STREAM_BOUNDARY}\r\n`
      + 'Content-Type: image/png\r\n'
      + `Content-Length: ${frame.png.length}\r\n\r\n`
    try {
      this.res.write(header)
      const flushed = this.res.write(frame.png)
      this.res.write('\r\n')
      if (!flushed) this.#congested = true
    } catch {
      this.close()
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.res.end()
    } catch {
      // The socket may already be gone.
    }
  }
}
