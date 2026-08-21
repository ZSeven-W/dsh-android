/**
 * Static smoke for the signed web-route layer (`lib/stream-routes.js` +
 * `lib/stream-access.js`), with NO adb and NO device anywhere.
 *
 * The routes are mounted with `mountStreamRoutes` on the harness's
 * `createMiniWebServer` (the same (kind, path) registry the DSH webserver
 * exposes), and the host they talk to is a plain object faked to exactly the
 * dependency surface `StreamRoutes` uses: `streamedSerial`, `latestFrame`,
 * `subscribeFrames`, `acquire`, `ensureStreaming`, `status`, `screenshot`, the
 * control verbs, and `toolchain.listDevices` / `onlineDevices`. That keeps the
 * whole suite deterministic on any host — the live-device equivalent lives in
 * `scripts/dev-emulator-smoke.mjs`.
 *
 * Requests go through `node:http` rather than `fetch` so the suite controls
 * every header the transport fence inspects (`Host`, `Origin`,
 * `Sec-Fetch-Site`) — undici refuses to forge some of them.
 *
 * The capability key is injected (a fixed 32-byte buffer) so expired and
 * wrong-key tokens can be forged here, and so the suite never reads or writes
 * the developer's real `<DSH_HOME>/cache/dsh-android/stream-access.key`.
 */

import { unlinkSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  TINY_PNG_B64,
  createMiniWebServer,
  createStepReporter,
  signToken,
} from './_smoke-harness.mjs'

const { step, finish } = createStepReporter()
const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
const libDir = join(root, 'lib')
const TINY_PNG = Buffer.from(TINY_PNG_B64, 'base64')

let streamRoutes
let streamAccess
try {
  ;[streamRoutes, streamAccess] = await Promise.all([
    import(pathToFileURL(join(libDir, 'stream-routes.js')).href),
    import(pathToFileURL(join(libDir, 'stream-access.js')).href),
  ])
} catch (error) {
  step('lib/*.js is built', 'SKIP', `run \`pnpm run build\` first — ${error instanceof Error ? error.message : String(error)}`)
  finish()
  process.exit(0)
}

const { StreamRoutes, mountStreamRoutes, PLUGIN_ROUTE_PREFIX } = streamRoutes
const { StreamAccessController, screenshotDir } = streamAccess

const SIGNING_KEY = Buffer.alloc(32, 7)
const WRONG_KEY = Buffer.alloc(32, 9)

// ── the fake host (the exact surface stream-routes depends on) ──────────────

const DEVICES = [
  { serial: 'emulator-5554', state: 'device', emulator: true, model: 'sdk gphone64 arm64' },
  { serial: 'R5CT30ABCDE', state: 'device', emulator: false, model: 'SM A546U' },
  { serial: 'R5CT99OFFLN', state: 'unauthorized', emulator: false },
]

function makeFakeHost({ streamed = 'emulator-5554', devices = DEVICES } = {}) {
  const calls = []
  const subscribers = new Set()
  const state = { streamed, running: streamed !== undefined, rotation: 0, consumers: 0, latestFrame: undefined, sequence: 0 }
  return {
    calls,
    state,
    get streamedSerial() {
      return state.running ? state.streamed : undefined
    },
    get latestFrame() {
      return state.latestFrame
    },
    subscribeFrames(subscriber) {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    acquire() {
      state.consumers += 1
      let released = false
      return () => {
        if (released) return
        released = true
        state.consumers -= 1
      }
    },
    async ensureStreaming({ serial }) {
      calls.push(`ensureStreaming ${serial}`)
      if (state.streamFails) throw new Error('the screencap loop refused to start')
      state.streamed = serial
      state.running = true
      return { serial, width: 1, height: 1 }
    },
    status() {
      return {
        available: true,
        running: state.running,
        ...(state.streamed === undefined ? {} : { serial: state.streamed }),
        restarts: 0,
        adbSource: 'env',
        consumers: state.consumers,
        stderr: [],
      }
    },
    toolchain: {
      async listDevices() {
        calls.push('listDevices')
        if (state.adbFails) throw new Error('adb server is not running')
        return devices.map(device => ({ ...device }))
      },
      async onlineDevices() {
        return devices.filter(device => device.state === 'device').map(device => ({ ...device }))
      },
    },
    async screenshot(serial) {
      calls.push(`screenshot ${serial}`)
      return { png: TINY_PNG, width: 1, height: 1 }
    },
    async tap(serial, x, y) {
      calls.push(`tap ${serial} ${x} ${y}`)
    },
    async drag(serial, drag) {
      calls.push(`drag ${serial} ${JSON.stringify(drag)}`)
    },
    async button(serial, name) {
      calls.push(`button ${serial} ${name}`)
    },
    async type(serial, text) {
      calls.push(`type ${serial} ${text}`)
    },
    async getRotation() {
      return state.rotation
    },
    async rotate(serial, rotation) {
      state.rotation = rotation
      calls.push(`rotate ${serial} ${rotation}`)
    },
    async deviceAction(serial, action) {
      calls.push(`deviceAction ${serial} ${action}`)
    },
    /** Push one frame at every live stream subscriber. */
    emitFrame() {
      state.sequence += 1
      const frame = { png: TINY_PNG, width: 1, height: 1, sequence: state.sequence, at: Date.now() }
      state.latestFrame = frame
      for (const subscriber of subscribers) subscriber(frame)
    },
  }
}

// ── mount ───────────────────────────────────────────────────────────────────

const host = makeFakeHost()
const access = new StreamAccessController(async () => SIGNING_KEY)
const routes = new StreamRoutes(host, access)
const mini = createMiniWebServer()
const disposeRoutes = mountStreamRoutes(mini, routes)
await new Promise(resolve => mini.server.listen(0, '127.0.0.1', resolve))
const port = mini.server.address().port
const ORIGIN = `http://127.0.0.1:${port}`

// ── http helpers (full header control) ──────────────────────────────────────

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const bytes = Buffer.concat(chunks)
        let json
        try {
          json = JSON.parse(bytes.toString('utf8'))
        } catch {
          json = undefined
        }
        resolve({ status: res.statusCode, headers: res.headers, bytes, json, text: bytes.toString('utf8') })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function postJson(path, value, extra = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value)
  return request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'content-length': String(Buffer.byteLength(body)),
      ...extra,
    },
    body,
  })
}

const route = name => `${PLUGIN_ROUTE_PREFIX}/${name}`
const created = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── 1. grant: relative capability URLs that leak nothing ────────────────────

const grant = await postJson(route('grant'), { kind: 'stream', device: 'emulator-5554' })
step(
  'grant mints a RELATIVE stream URL under the plugin prefix',
  grant.status === 200
    && grant.json?.ok === true
    && typeof grant.json.streamUrl === 'string'
    && grant.json.streamUrl.startsWith(`${PLUGIN_ROUTE_PREFIX}/stream/`),
  grant.json?.streamUrl?.slice(0, 60),
)
step(
  'the grant response leaks no absolute URL, port, or host path',
  !/https?:\/\//.test(grant.text) && !/\b\d{4,5}\b/.test(grant.json?.streamUrl ?? '') && !grant.text.includes('/adb'),
  grant.text.slice(0, 120),
)
{
  const ttl = (grant.json?.expiresAt ?? 0) - Date.now()
  step(
    'the capability expires within 10 minutes',
    ttl > 0 && ttl <= 10 * 60 * 1000,
    `${Math.round(ttl / 1000)} s`,
  )
}
step(
  'grant echoes the device it minted for',
  grant.json?.device === 'emulator-5554' && grant.json?.wsUrl === undefined,
  `device=${grant.json?.device}`,
)

// ── 2. token verification ───────────────────────────────────────────────────

{
  const garbage = await request(`${PLUGIN_ROUTE_PREFIX}/stream/AAAA.BBBB`)
  step(
    'a garbage stream token is refused with a coded 403',
    garbage.status === 403 && garbage.json?.ok === false && garbage.json?.code === 'forbidden',
    `${garbage.status} ${garbage.json?.code}`,
  )
}
{
  const expired = signToken(SIGNING_KEY, { v: 1, kind: 'android-stream', serial: 'emulator-5554', exp: Date.now() - 1_000 })
  const res = await request(`${PLUGIN_ROUTE_PREFIX}/stream/${expired}`)
  step(
    'a correctly signed but EXPIRED token is refused',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const forged = signToken(WRONG_KEY, { v: 1, kind: 'android-stream', serial: 'emulator-5554', exp: Date.now() + 60_000 })
  const res = await request(`${PLUGIN_ROUTE_PREFIX}/stream/${forged}`)
  step(
    'a token signed with the wrong key is refused',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}
{
  // A payload whose TTL exceeds the hard cap must not buy a longer life.
  const stretched = signToken(SIGNING_KEY, { v: 1, kind: 'android-stream', serial: 'emulator-5554', exp: Date.now() + 24 * 60 * 60 * 1000 })
  const res = await request(`${PLUGIN_ROUTE_PREFIX}/stream/${stretched}`)
  step(
    'a token claiming a TTL beyond the 10-minute cap is refused',
    res.status === 403,
    String(res.status),
  )
}
{
  // A screenshot capability must not open the stream route.
  const crossKind = signToken(SIGNING_KEY, { v: 1, kind: 'android-screenshot', path: '/tmp/x.png', exp: Date.now() + 60_000 })
  const res = await request(`${PLUGIN_ROUTE_PREFIX}/stream/${crossKind}`)
  step(
    'a screenshot capability cannot be replayed against the stream route',
    res.status === 403,
    String(res.status),
  )
}

// ── 3. the transport fence ──────────────────────────────────────────────────

{
  const body = '{}'
  const res = await request(route('status'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
    body,
  })
  step(
    'a POST with NO Origin is refused (403)',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('status'), {}, { origin: 'http://evil.example' })
  step(
    'a cross-origin POST is refused (403)',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('status'), {}, { 'sec-fetch-site': 'cross-site' })
  step(
    'Sec-Fetch-Site: cross-site is refused (403)',
    res.status === 403,
    String(res.status),
  )
}
{
  // DNS rebinding: a non-loopback Host header must not be trusted even from a
  // loopback peer.
  const res = await postJson(route('status'), {}, { host: 'evil.example', origin: 'http://evil.example' })
  step(
    'a non-loopback Host header is refused (DNS rebinding)',
    res.status === 403,
    String(res.status),
  )
}

// ── 4. method / content-type / body envelope ────────────────────────────────

{
  const res = await request(route('control'), { method: 'GET', headers: { origin: ORIGIN } })
  step(
    'GET on a POST-only route answers 405 with an Allow header',
    res.status === 405 && res.headers.allow === 'POST',
    `${res.status} allow=${res.headers.allow}`,
  )
}
{
  const body = '{}'
  const res = await request(route('status'), {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: ORIGIN, 'content-length': String(body.length) },
    body,
  })
  step(
    'a non-JSON content-type answers 415 bad_content_type',
    res.status === 415 && res.json?.code === 'bad_content_type',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('status'), 'not json at all')
  step(
    'a malformed JSON body answers 400 bad_request',
    res.status === 400 && res.json?.code === 'bad_request',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('status'), '[]')
  step(
    'a non-object JSON body answers 400 bad_request',
    res.status === 400 && res.json?.code === 'bad_request',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('grant'), { kind: 'nonsense' })
  step(
    'an unknown grant kind answers 400 naming the accepted kinds',
    res.status === 400 && res.json?.code === 'bad_request' && /stream.*screenshot/s.test(res.json?.error ?? ''),
    res.json?.error,
  )
}

// ── 5. device-state refusals (coded 409) ────────────────────────────────────

{
  const res = await postJson(route('switch-device'), { device: 'ghost-9999' })
  step(
    'switching to a device adb never saw answers 409 device_unknown',
    res.status === 409 && res.json?.code === 'device_unknown',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('switch-device'), { device: 'R5CT99OFFLN' })
  step(
    'switching to an unauthorized device answers 409 device_unauthorized with the prompt hint',
    res.status === 409 && res.json?.code === 'device_unauthorized' && /USB debugging prompt/.test(res.json?.error ?? ''),
    res.json?.error,
  )
}
{
  const res = await postJson(route('switch-device'), { device: 'not a serial!' })
  step(
    'a malformed serial answers 400, never 409',
    res.status === 400 && res.json?.code === 'bad_request',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('switch-device'), { device: 'R5CT30ABCDE' })
  step(
    'switching to an online device mints a fresh grant plus a display name',
    res.status === 200 && res.json?.ok === true && res.json?.device === 'R5CT30ABCDE' && res.json?.deviceName === 'SM A546U',
    JSON.stringify(res.json).slice(0, 120),
  )
  // Put the emulator back so the remaining steps read the original stream.
  await postJson(route('switch-device'), { device: 'emulator-5554' })
}

// ── 6. /control parameter validation and the rotate shape ───────────────────

const controlCases = [
  ['a missing device', { action: { kind: 'tap', x: 0.5, y: 0.5 } }],
  ['an action that is not an object', { device: 'emulator-5554', action: 'tap' }],
  ['an unknown action kind', { device: 'emulator-5554', action: { kind: 'levitate' } }],
  ['a tap outside 0..1', { device: 'emulator-5554', action: { kind: 'tap', x: 1.4, y: 0.5 } }],
  ['a tap with a non-numeric coordinate', { device: 'emulator-5554', action: { kind: 'tap', x: '0.5', y: 0.5 } }],
  ['a drag with a negative duration', { device: 'emulator-5554', action: { kind: 'drag', fromX: 0.1, fromY: 0.1, toX: 0.9, toY: 0.9, durationMs: -5 } }],
  ['a button with no name', { device: 'emulator-5554', action: { kind: 'button', name: '' } }],
  ['type with empty text', { device: 'emulator-5554', action: { kind: 'type', text: '' } }],
]
for (const [label, body] of controlCases) {
  const res = await postJson(route('control'), body)
  step(
    `/control refuses ${label} with a coded 400`,
    res.status === 400 && res.json?.code === 'bad_request',
    `${res.status} ${res.json?.code} — ${res.json?.error}`,
  )
}
{
  // Shape validation must run BEFORE any liveness check: a malformed action
  // against an unknown device is still a 400, never a 409.
  const res = await postJson(route('control'), { device: 'ghost-9999', action: { kind: 'levitate' } })
  step(
    '/control validates the action shape before the device liveness check',
    res.status === 400 && res.json?.code === 'bad_request',
    `${res.status} ${res.json?.code}`,
  )
}
{
  host.calls.length = 0
  const res = await postJson(route('control'), { device: 'emulator-5554', action: { kind: 'tap', x: 0.25, y: 0.75 } })
  step(
    '/control forwards a normalized tap and answers {ok:true}',
    res.status === 200 && res.json?.ok === true && host.calls.includes('tap emulator-5554 0.25 0.75'),
    host.calls.join(' | '),
  )
}
{
  host.state.rotation = 0
  const first = await postJson(route('control'), { device: 'emulator-5554', action: { kind: 'rotate' } })
  const second = await postJson(route('control'), { device: 'emulator-5554', action: { kind: 'rotate' } })
  step(
    '/control rotate answers {ok, rotation} and advances the 0..3 cycle',
    first.status === 200 && first.json?.rotation === 1 && second.json?.rotation === 2,
    `${first.json?.rotation} → ${second.json?.rotation}`,
  )
}
{
  const res = await postJson(route('device-action'), { device: 'emulator-5554', action: 'orbit' })
  step(
    '/device-action refuses an unknown action naming the accepted set',
    res.status === 400 && /notifications, quick-settings, lock, wake, assistant/.test(res.json?.error ?? ''),
    res.json?.error,
  )
}
{
  host.calls.length = 0
  const res = await postJson(route('device-action'), { device: 'emulator-5554', action: 'quick-settings' })
  step(
    '/device-action runs a known action and echoes it back',
    res.status === 200 && res.json?.action === 'quick-settings' && host.calls.includes('deviceAction emulator-5554 quick-settings'),
    JSON.stringify(res.json),
  )
}

// ── 7. /devices and /status shapes ──────────────────────────────────────────

{
  const res = await postJson(route('devices'), {})
  const listed = res.json?.devices ?? []
  const streaming = listed.filter(device => device.streaming === true)
  step(
    '/devices answers ONE array with a kind per row (no emulator/physical split)',
    res.status === 200
      && Array.isArray(listed)
      && listed.length === 3
      && listed.every(device => device.kind === 'emulator' || device.kind === 'physical')
      && listed.find(device => device.serial === 'emulator-5554')?.kind === 'emulator'
      && listed.find(device => device.serial === 'R5CT30ABCDE')?.kind === 'physical',
    JSON.stringify(listed),
  )
  step(
    '/devices sorts online devices first and flags the streamed one',
    listed[listed.length - 1]?.state === 'unauthorized'
      && streaming.length === 1
      && streaming[0].serial === 'emulator-5554',
    listed.map(device => `${device.serial}:${device.state}`).join(' '),
  )
  step(
    '/devices carries the AVD names as a separate array',
    Array.isArray(res.json?.avds),
    `${res.json?.avds?.length ?? '?'} avds`,
  )
}
{
  const res = await postJson(route('status'), {})
  step(
    '/status reports the live stream',
    res.status === 200 && res.json?.ok === true && res.json?.running === true && res.json?.serial === 'emulator-5554',
    JSON.stringify(res.json),
  )
}
{
  const res = await postJson(route('status'), { device: 'R5CT30ABCDE' })
  step(
    '/status filtered to a different device reports running:false (never another device)',
    res.status === 200 && res.json?.running === false && res.json?.serial === undefined,
    JSON.stringify(res.json),
  )
}
{
  const res = await postJson(route('status'), { device: 42 })
  step(
    '/status refuses a non-string device filter',
    res.status === 400 && res.json?.code === 'bad_request',
    `${res.status} ${res.json?.code}`,
  )
}

// ── 8. capture + the screenshot capability round trip ───────────────────────

let capturedPath
{
  const res = await postJson(route('capture'), { device: 'emulator-5554' })
  capturedPath = res.json?.path
  if (typeof capturedPath === 'string') created.push(capturedPath)
  step(
    '/capture writes a fresh PNG into the plugin cache and mints a relative URL',
    res.status === 200
      && res.json?.ok === true
      && typeof capturedPath === 'string'
      && capturedPath.startsWith(screenshotDir())
      && res.json.bytes === TINY_PNG.length
      && res.json.screenshotUrl.startsWith(`${PLUGIN_ROUTE_PREFIX}/screenshot/`),
    `${res.json?.bytes} bytes → ${capturedPath}`,
  )
  const shot = await request(res.json?.screenshotUrl ?? '/nope')
  step(
    'the signed screenshot URL serves the PNG back with hardened headers',
    shot.status === 200
      && shot.headers['content-type'] === 'image/png'
      && shot.bytes.equals(TINY_PNG)
      && shot.headers['x-content-type-options'] === 'nosniff'
      && shot.headers['cache-control'] === 'no-store',
    `${shot.status} ${shot.bytes.length} bytes`,
  )
}
{
  const res = await postJson(route('grant'), { kind: 'screenshot', path: capturedPath })
  step(
    'grant re-mints a capability for a path already inside the cache',
    res.status === 200 && res.json?.screenshotUrl?.startsWith(`${PLUGIN_ROUTE_PREFIX}/screenshot/`),
    `${res.status}`,
  )
}
{
  const res = await postJson(route('grant'), { kind: 'screenshot', path: '/etc/passwd' })
  step(
    'a path outside the screenshot cache is refused 403 (never 404)',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const escape = join(screenshotDir(), '..', '..', 'etc', 'passwd')
  const res = await postJson(route('grant'), { kind: 'screenshot', path: escape })
  step(
    'a traversal path out of the cache is refused 403',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('grant'), { kind: 'screenshot', path: join(screenshotDir(), 'never-written.png') })
  step(
    'a missing file INSIDE the cache is 404 screenshot_missing, not 403',
    res.status === 404 && res.json?.code === 'screenshot_missing',
    `${res.status} ${res.json?.code}`,
  )
}
{
  const res = await postJson(route('grant'), { kind: 'screenshot', path: 'relative/path.png' })
  step(
    'a relative screenshot path is refused',
    res.status === 403 || res.status === 400,
    `${res.status} ${res.json?.code}`,
  )
}
{
  const forged = signToken(SIGNING_KEY, { v: 1, kind: 'android-screenshot', path: '/etc/passwd', exp: Date.now() + 60_000 })
  const res = await request(`${PLUGIN_ROUTE_PREFIX}/screenshot/${forged}`)
  step(
    'even a VALIDLY signed capability for an outside path is refused at fetch time',
    res.status === 403 && res.json?.code === 'forbidden',
    `${res.status} ${res.json?.code}`,
  )
}

// ── 9. the live multipart stream ────────────────────────────────────────────

{
  // No buffered frame: the response headers therefore stay unflushed until
  // the first PART is written, which is exactly the live-stream behaviour
  // the panel sees (and why this block never awaits the `response` event
  // before pushing frames).
  host.state.latestFrame = undefined
  const fresh = await postJson(route('grant'), { kind: 'stream', device: 'emulator-5554' })
  const chunks = []
  let response
  const req = http.request({ host: '127.0.0.1', port, path: fresh.json?.streamUrl, method: 'GET' }, res => {
    response = res
    res.on('data', chunk => chunks.push(chunk))
  })
  req.on('error', () => {})
  req.end()

  // The handler subscribes only after its own await; the consumer count is
  // the observable signal that it did.
  for (let attempt = 0; attempt < 100 && host.state.consumers === 0; attempt += 1) {
    await sleep(20)
  }
  step(
    'opening the stream holds one consumer of the host',
    host.state.consumers === 1,
    `consumers=${host.state.consumers}`,
  )
  host.emitFrame()
  host.emitFrame()
  for (let attempt = 0; attempt < 100 && chunks.length < 2; attempt += 1) {
    await sleep(20)
  }
  step(
    'the stream route answers multipart/x-mixed-replace with a PNG boundary',
    response?.statusCode === 200
      && /multipart\/x-mixed-replace; boundary=dsh-android-frame/.test(response?.headers['content-type'] ?? ''),
    response?.headers['content-type'],
  )
  step(
    'the stream response carries the hardened headers',
    response?.headers['x-content-type-options'] === 'nosniff'
      && response?.headers['cross-origin-resource-policy'] === 'same-origin'
      && (response?.headers['cache-control'] ?? '').includes('no-store'),
    JSON.stringify({ corp: response?.headers['cross-origin-resource-policy'], cc: response?.headers['cache-control'] }),
  )
  const body = Buffer.concat(chunks)
  const parts = (body.toString('latin1').match(/--dsh-android-frame/g) ?? []).length
  step(
    'two emitted frames arrive as two multipart parts carrying the PNG bytes',
    parts === 2 && body.includes(TINY_PNG) && /Content-Type: image\/png/.test(body.toString('latin1')),
    `${parts} parts, ${body.length} bytes`,
  )
  response?.destroy()
  req.destroy()
  for (let attempt = 0; attempt < 100 && host.state.consumers > 0; attempt += 1) {
    await sleep(20)
  }
  step(
    'closing the client socket releases the consumer',
    host.state.consumers === 0,
    `consumers=${host.state.consumers}`,
  )
}
{
  // A capability for a device that is no longer the streamed one must not
  // silently show the new device's screen.
  const stale = await postJson(route('grant'), { kind: 'stream', device: 'emulator-5554' })
  host.state.streamed = 'R5CT30ABCDE'
  const res = await request(stale.json?.streamUrl ?? '/nope')
  step(
    'a capability for a no-longer-streamed device answers 503 stream_not_running',
    res.status === 503 && res.json?.code === 'stream_not_running',
    `${res.status} ${res.json?.code}`,
  )
  host.state.streamed = 'emulator-5554'
}
{
  // Grant must never yank the stream away from another device.
  host.state.streamed = 'R5CT30ABCDE'
  const res = await postJson(route('grant'), { kind: 'stream', device: 'emulator-5554' })
  step(
    'grant refuses to steal the stream slot from another device (409 device_busy)',
    res.status === 409 && res.json?.code === 'device_busy',
    `${res.status} ${res.json?.code}`,
  )
  host.state.streamed = 'emulator-5554'
}
{
  host.state.streamFails = true
  const res = await postJson(route('grant'), { kind: 'stream', device: 'emulator-5554' })
  step(
    'a stream that fails to start answers 502 stream_failed with the reason',
    res.status === 502 && res.json?.code === 'stream_failed' && /refused to start/.test(res.json?.error ?? ''),
    res.json?.error,
  )
  host.state.streamFails = false
}
{
  host.state.adbFails = true
  const res = await postJson(route('devices'), {})
  step(
    'an unreadable device list answers 503 adb_unavailable',
    res.status === 503 && res.json?.code === 'adb_unavailable',
    `${res.status} ${res.json?.code}`,
  )
  host.state.adbFails = false
}

// ── 10. teardown ────────────────────────────────────────────────────────────

disposeRoutes()
{
  const res = await postJson(route('status'), {})
  step('disposal unregisters every route (404 afterwards)', res.status === 404, String(res.status))
}
mini.server.close()
for (const path of created) {
  try {
    unlinkSync(path)
  } catch {
    // Best effort: the cache directory is disposable.
  }
}

finish()
