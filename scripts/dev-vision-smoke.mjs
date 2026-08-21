/**
 * Static suite for the native multimodal delivery path (src/vision.ts).
 *
 * Covers, without any device or DSH host:
 * - the route gate: image blocks only when the resolved model declares
 *   `image` input AND the attachment store is mounted; request-header config
 *   wins over agent options; a throwing resolver degrades to text-only;
 * - the attachment save: the PNG bytes reach `saveImage` with mediaType
 *   image/png and a name, and the plain ref lands as the result's `image`;
 * - degradation: admission failures, absent services, and text-only routes
 *   all keep the rc.1 result shape (no `image` field, no error);
 * - rendering: `renderJsonWithImage` emits text+image blocks for a value
 *   carrying a ref and exactly one text block otherwise;
 * - the end-to-end wire through a real tool: android_screenshot with an
 *   injected fake host + vision services returns the ref and survives the
 *   lossless-JSON boundary.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStepReporter, findJsonViolations, makeExec, TINY_PNG_B64 } from './_smoke-harness.mjs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const { step, finish } = createStepReporter()

let vision, tools
try {
  vision = await import(join(root, 'lib', 'vision.js'))
  tools = await import(join(root, 'lib', 'tools.js'))
} catch (error) {
  console.log(`SKIP lib/ is not built (${error.message.split('\n')[0]}); run pnpm run build first`)
  process.exit(0)
}

const TINY_PNG = Buffer.from(TINY_PNG_B64, 'base64')

/** Recording attachment store; behavior toggled through `state`. */
function makeFakeAttachments() {
  const state = { saves: [], failNext: false }
  return {
    state,
    async saveImage({ data, mediaType, name }) {
      if (state.failNext) throw new Error('IMAGE_TOO_LARGE (fake admission)')
      state.saves.push({ bytes: data.length, mediaType, name })
      return { attachmentId: `att-${state.saves.length}`, mediaType, bytes: data.length, width: 1, height: 1, name }
    },
  }
}

function makeFakeLlm(modalities) {
  const state = { calls: [] }
  return {
    state,
    async resolveModelInfo(provider, model) {
      state.calls.push({ provider, model })
      if (modalities === 'throw') throw new Error('resolver down')
      return { inputModalities: modalities }
    },
  }
}

const visionExec = (provider = 'deepseek', model = 'v4-vision') => ({
  signal: new AbortController().signal,
  agent: { session: { requestHeader: () => ({ config: { provider, model } }) }, options: {} },
})

// ── the route gate ───────────────────────────────────────────────────────────

{
  const services = { attachments: makeFakeAttachments(), llm: makeFakeLlm(['text', 'image']) }
  step('an image-declaring route activates image delivery',
    await vision.imageInputActive(services, visionExec()) === true)
  step('the resolver saw the request-header route',
    services.llm.state.calls[0]?.provider === 'deepseek' && services.llm.state.calls[0]?.model === 'v4-vision')
}
step('a text-only model stays text-only',
  await vision.imageInputActive({ attachments: makeFakeAttachments(), llm: makeFakeLlm(['text']) }, visionExec()) === false)
step('a missing llm service stays text-only',
  await vision.imageInputActive({ attachments: makeFakeAttachments() }, visionExec()) === false)
step('a missing attachment store stays text-only even on a vision route',
  await vision.imageInputActive({ llm: makeFakeLlm(['image']) }, visionExec()) === false)
step('a throwing resolver degrades instead of erroring',
  await vision.imageInputActive({ attachments: makeFakeAttachments(), llm: makeFakeLlm('throw') }, visionExec()) === false)
step('an unroutable exec (no agent) stays text-only',
  await vision.imageInputActive({ attachments: makeFakeAttachments(), llm: makeFakeLlm(['image']) }, { signal: undefined }) === false)
{
  const llm = makeFakeLlm(['image'])
  const exec = {
    agent: { session: { requestHeader: () => undefined }, options: { provider: 'p2', model: 'm2' } },
  }
  step('agent options are the fallback route when no request header exists',
    await vision.imageInputActive({ attachments: makeFakeAttachments(), llm }, exec) === true
    && llm.state.calls[0]?.model === 'm2')
}

// ── the attachment save ──────────────────────────────────────────────────────

{
  const attachments = makeFakeAttachments()
  const ref = await vision.saveScreenshotAttachment({ attachments }, TINY_PNG, 'shot-1.png')
  step('the PNG bytes reach saveImage as image/png with the capture name',
    attachments.state.saves.length === 1
    && attachments.state.saves[0].mediaType === 'image/png'
    && attachments.state.saves[0].bytes === TINY_PNG.length
    && attachments.state.saves[0].name === 'shot-1.png')
  step('the plain ref round-trips', ref?.attachmentId === 'att-1' && ref.width === 1 && ref.height === 1)
  attachments.state.failNext = true
  step('an admission failure degrades to undefined, never an error',
    await vision.saveScreenshotAttachment({ attachments }, TINY_PNG, 'x.png') === undefined)
}

// ── rendering ────────────────────────────────────────────────────────────────

{
  const withRef = { path: '/tmp/x.png', bytes: 1, image: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }
  const blocks = vision.renderJsonWithImage({}, withRef)
  step('a value carrying a ref renders text + image blocks',
    blocks.length === 2 && blocks[0].type === 'text' && blocks[1].type === 'image'
    && blocks[1].attachment.attachmentId === 'a')
  const plain = vision.renderJsonWithImage({}, { path: '/tmp/x.png', bytes: 1 })
  step('a plain value renders exactly one text block', plain.length === 1 && plain[0].type === 'text')
}

// ── end to end through android_screenshot ────────────────────────────────────

const fakeHost = {
  toolchain: {
    binary: { available: true, source: 'path', command: '/fake/adb' },
    available: true,
    async listDevices() {
      return [{ serial: 'emulator-5554', state: 'device', emulator: true, model: 'sdk gphone64 arm64' }]
    },
    async onlineDevices() { return this.listDevices() },
    async deviceDetails(device) { return { serial: device.serial, model: 'sdk gphone64 arm64', androidVersion: '14', sdk: 34 } },
    async shell() { return '' },
    async execOut() { return TINY_PNG },
  },
  available: true,
  streamedSerial: undefined,
  async resolveTarget() {
    return { serial: 'emulator-5554', state: 'device', emulator: true, model: 'sdk gphone64 arm64' }
  },
  async screenshot() { return { png: TINY_PNG, width: 1, height: 1 } },
}

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

{
  const attachments = makeFakeAttachments()
  const factory = tools.createAndroidTools(fakeHost, {
    cacheDir: mkdtempSync(join(tmpdir(), 'dsh-android-vision-smoke-')),
    vision: { attachments, llm: makeFakeLlm(['image']) },
  })
  const exec = { ...makeExec('android_screenshot', {}), ...visionExec() }
  const result = await factory.androidScreenshot.execute({}, exec)
  step('android_screenshot on a vision route carries the image ref',
    result.image?.attachmentId === 'att-1' && result.image.mediaType === 'image/png')
  step('the result stays inside the lossless-JSON boundary',
    findJsonViolations(result).length === 0, findJsonViolations(result).join('; '))
  const blocks = vision.renderJsonWithImage({}, result)
  step('the rendered content delivers the screenshot as an image block',
    blocks.some(block => block.type === 'image' && block.attachment.attachmentId === 'att-1'))
}
{
  const factory = tools.createAndroidTools(fakeHost, {
    cacheDir: mkdtempSync(join(tmpdir(), 'dsh-android-vision-smoke-')),
    vision: { attachments: makeFakeAttachments(), llm: makeFakeLlm(['text']) },
  })
  const result = await factory.androidScreenshot.execute({}, { ...makeExec('android_screenshot', {}), ...visionExec() })
  step('a text-only route keeps the rc.1 result shape', result.image === undefined && typeof result.path === 'string')
}
{
  const factory = tools.createAndroidTools(fakeHost, {
    cacheDir: mkdtempSync(join(tmpdir(), 'dsh-android-vision-smoke-')),
  })
  const result = await factory.androidScreenshot.execute({}, makeExec('android_screenshot', {}))
  step('no vision services keeps the rc.1 result shape', result.image === undefined && typeof result.path === 'string')
}

finish()
