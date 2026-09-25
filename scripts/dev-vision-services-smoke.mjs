/**
 * Regression smoke for the vision seam's service resolution.
 *
 * Reproduces the real failure: cordis' ctx.get(name) returns undefined while the
 * PROVIDING fiber is inactive, so a resolver that samples once at plugin
 * apply() time captures "no attachments" and disables image delivery for the
 * whole process. The lazy resolver must pick the service up once it appears.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createStepReporter, findJsonViolations } from './_smoke-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const { step, finish } = createStepReporter()

let vision
try {
  vision = await import(pathToFileURL(join(root, 'lib', 'vision.js')).href)
} catch (error) {
  // Same SKIP guard its siblings carry: lib/ is produced by the build, and a
  // missing one is "not built yet", never a test failure.
  step('import lib/vision.js', 'SKIP', `build not available yet: ${error instanceof Error ? error.message : String(error)}`)
  console.log('\nSKIPPED — run the build and try again.')
  process.exit(0)
}
const { resolveVisionServices, saveScreenshotAttachment } = vision

/**
 * A cordis-like ctx whose 'attachments' appears only AFTER the first read.
 *
 * `entries` decides which commit methods the store carries, so a test can say
 * exactly what it means: 'both' (the real LocalAttachmentStore), 'batch' (a
 * store with saveImages only), or 'single' (saveImage only).
 */
function lateCtx({ entries = 'both' } = {}) {
  const calls = []
  const store = {}
  if (entries === 'both' || entries === 'batch') {
    store.saveImages = async (inputs) => {
      calls.push(['saveImages', inputs])
      return inputs.map(() => ({ attachmentId: 'sha256:batch', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }))
    }
  }
  if (entries === 'both' || entries === 'single') {
    store.saveImage = async (input) => {
      calls.push(['saveImage', input])
      return { attachmentId: 'sha256:single', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
    }
  }
  let active = false
  return {
    calls,
    store,
    activate() { active = true },
    get(name) {
      if (name === 'llm') return { async resolveModelInfo() { return { inputModalities: ['text', 'image'] } } }
      if (name === 'attachments') return active ? store : undefined
      return undefined
    },
  }
}

// 1. the core regression: sampling early must NOT freeze the answer
{
  const ctx = lateCtx()
  const vision = resolveVisionServices(ctx)
  const before = vision.attachments
  ctx.activate()
  const after = vision.attachments
  step('attachments is undefined before the provider activates', before === undefined)
  step('attachments becomes visible after activation (lazy re-read)', after !== undefined)
}

// 2. EACH entry is accepted on its own. The name now matches the fixture: the
//    old version said "only saveImage" while building a store with BOTH.
{
  const both = lateCtx({ entries: 'both' })
  both.activate()
  step('a store carrying both entries is accepted', resolveVisionServices(both).attachments !== undefined)

  const single = lateCtx({ entries: 'single' })
  single.activate()
  step('a store carrying ONLY saveImage is accepted', resolveVisionServices(single).attachments !== undefined)

  const batch = lateCtx({ entries: 'batch' })
  batch.activate()
  step('a store carrying ONLY saveImages is accepted', resolveVisionServices(batch).attachments !== undefined)
}

// 2b. The BATCH path must actually work. Nothing exercised saveImages before,
//     so mutating the call to `saveImages(input)?.[1]` (wrong argument shape,
//     wrong index) left every suite green while a real host would have lost the
//     image on EVERY capture.
{
  const ctx = lateCtx({ entries: 'batch' })
  ctx.activate()
  const vision = resolveVisionServices(ctx)
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  const ref = await vision.attachments.saveImages([
    { data: png, mediaType: 'image/png', name: 'shot.png' },
  ])
  const [call] = ctx.calls
  step(
    'saveImages receives an ORDERED ARRAY of {data, mediaType, name}',
    ctx.calls.length === 1
      && call[0] === 'saveImages'
      && Array.isArray(call[1])
      && call[1].length === 1
      && call[1][0].mediaType === 'image/png'
      && call[1][0].name === 'shot.png'
      && call[1][0].data instanceof Uint8Array,
    `${call?.[0]}(${Array.isArray(call?.[1]) ? call[1].length + ' item(s)' : typeof call?.[1]})`,
  )
  step(
    'saveImages returns the committed ref, not the raw array',
    Array.isArray(ref) && ref[0]?.attachmentId === 'sha256:batch',
    JSON.stringify(ref?.[0] ?? null),
  )
  step('the resolved ref is lossless JSON', findJsonViolations(ref).length === 0, findJsonViolations(ref).join(', '))
}

// 2c. The REAL call path. saveScreenshotAttachment is what every capture tool
//     goes through, and it is the function the batch entry actually belongs to;
//     testing resolveVisionServices alone left the call itself unverified, so
//     mutating the index (`?.[0]` -> `?.[1]`) kept this suite green while a real
//     host would have silently lost the image on every single capture.
{
  const ctx = lateCtx({ entries: 'batch' })
  ctx.activate()
  const services = resolveVisionServices(ctx)
  const ref = await saveScreenshotAttachment(services, new Uint8Array([1, 2, 3]), 'shot.png')
  const [call] = ctx.calls
  step(
    'saveScreenshotAttachment commits through saveImages with ONE ordered item',
    ctx.calls.length === 1
      && call[0] === 'saveImages'
      && Array.isArray(call[1])
      && call[1].length === 1
      && call[1][0].name === 'shot.png'
      && call[1][0].mediaType === 'image/png'
      && call[1][0].data instanceof Uint8Array,
    `${call?.[0]}(${Array.isArray(call?.[1]) ? call[1].length + ' item(s)' : typeof call?.[1]})`,
  )
  step(
    'and it returns THAT ref (a wrong index yields undefined, not the ref)',
    ref?.attachmentId === 'sha256:batch',
    JSON.stringify(ref ?? null),
  )
}

// 2d. The single-image fallback must be taken when the batch entry is absent.
{
  const ctx = lateCtx({ entries: 'single' })
  ctx.activate()
  const services = resolveVisionServices(ctx)
  const ref = await saveScreenshotAttachment(services, new Uint8Array([9]), 'fallback.png')
  const [call] = ctx.calls
  step(
    'a store without saveImages is served through saveImage',
    call?.[0] === 'saveImage' && call[1]?.name === 'fallback.png' && ref?.attachmentId === 'sha256:single',
    `${call?.[0]} -> ${ref?.attachmentId}`,
  )
}

// 3. a ctx with no get() at all stays text-only instead of throwing
{
  const vision = resolveVisionServices({})
  step('ctx without get() yields no services (no throw)', vision.attachments === undefined && vision.llm === undefined)
}

// 4. a store with neither entry is rejected
{
  const ctx = { get: (n) => n === 'attachments' ? {} : undefined }
  const vision = resolveVisionServices(ctx)
  step('a store with no image entry is rejected', vision.attachments === undefined)
}

finish()
