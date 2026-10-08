import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { AndroidHostController } from '../lib/android-host.js'
import { TINY_PNG_B64 } from './_smoke-harness.mjs'

const A = 'emulator-5554'
const B = 'phone-2'

function fixture(delay = 0) {
  const state = { queries: 0, children: [], devices: [
    { serial: A, state: 'device', emulator: true, model: 'stream-model' },
    { serial: B, state: 'device', emulator: false },
  ] }
  const toolchain = {
    available: true,
    binary: { source: 'path', command: process.execPath },
    async onlineDevices() { state.queries++; return state.devices.filter(d => d.state === 'device').map(d => ({ ...d })) },
    async listDevices() { state.queries++; return state.devices.map(d => ({ ...d })) },
    spawnExecOut() {
      const program = 'const png=Buffer.from(' + JSON.stringify(TINY_PNG_B64)
        + ',"base64");setTimeout(()=>{process.stdout.write(png);setInterval(()=>process.stdout.write(png),25)},'
        + delay + ')'
      const child = spawn(process.execPath, ['-e', program], { stdio: ['ignore', 'pipe', 'pipe'] })
      state.children.push(child)
      return child
    },
  }
  const host = new AndroidHostController(toolchain, { firstFrameTimeoutMs: 2000 })
  return { host, state }
}

async function withHost(task, delay = 0) {
  const f = fixture(delay)
  try { await task(f) } finally { await f.host.dispose() }
}

test('a named device with a fresh live stream avoids all enumeration calls', async () => {
  await withHost(async ({ host, state }) => {
    await host.ensureStreaming({ serial: A })
    const before = state.queries
    for (let i = 0; i < 20; i++) {
      const device = await host.resolveTarget(A)
      assert.equal(device.serial, A)
      assert.equal(device.model, 'stream-model')
      device.state = 'offline'
    }
    assert.equal(state.queries, before)
    assert.equal((await host.resolveTarget(A)).state, 'device')
  })
})

test('omitted serial and a different serial still enumerate', async () => {
  await withHost(async ({ host, state }) => {
    await host.ensureStreaming({ serial: A })
    const before = state.queries
    assert.equal((await host.resolveTarget()).serial, A)
    assert.equal((await host.resolveTarget(B)).serial, B)
    assert.equal(state.queries, before + 2)
  })
})

test('a process without its first frame cannot stand in for a device query', async () => {
  await withHost(async ({ host, state }) => {
    const starting = host.ensureStreaming({ serial: A })
    for (let i = 0; host.streamedSerial !== A && i < 100; i++) await new Promise(r => setTimeout(r, 2))
    assert.equal(host.streamedSerial, A)
    assert.equal(host.latestFrame, undefined)
    const before = state.queries
    await host.resolveTarget(A)
    assert.equal(state.queries, before + 1)
    await starting
  }, 300)
})

test('stale or future-dated frames fall back to enumeration', async () => {
  await withHost(async ({ host, state }) => {
    await host.ensureStreaming({ serial: A })
    let before = state.queries
    host.latestFrame.at = 0
    await host.resolveTarget(A)
    assert.equal(state.queries, before + 1)
    before = state.queries
    host.latestFrame.at = Date.now() + 60000
    await host.resolveTarget(A)
    assert.equal(state.queries, before + 1)
  })
})

test('a dropped stream does not retain an online proof for an unauthorized device', async () => {
  await withHost(async ({ host, state }) => {
    await host.ensureStreaming({ serial: A })
    state.devices[0].state = 'unauthorized'
    const child = state.children.at(-1)
    const closed = once(child, 'close')
    child.kill('SIGTERM')
    await closed
    assert.equal(host.running, false)
    await assert.rejects(host.resolveTarget(A), /unauthorized/)
  })
})

test('a stopped stream and a replaced stream cannot reuse the old proof', async () => {
  await withHost(async ({ host, state }) => {
    await host.ensureStreaming({ serial: A })
    await host.stop()
    let before = state.queries
    await host.resolveTarget(A)
    assert.equal(state.queries, before + 1)
    await host.ensureStreaming({ serial: B })
    before = state.queries
    await host.resolveTarget(A)
    assert.equal(state.queries, before + 1)
    before = state.queries
    await host.resolveTarget(B)
    assert.equal(state.queries, before)
  })
})
