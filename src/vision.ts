/**
 * Native multimodal delivery: hand the model the screenshot itself.
 *
 * DSH 0.1.1 carries images end to end — tool results may contain
 * `{type:'image', attachment}` blocks (the adapter walks tool-result content
 * recursively), bytes live in the durable attachment store (`ctx.get(
 * 'attachments')`), and `llm.resolveModelInfo(...).inputModalities` says
 * whether the routed model declares image input. `read_image` in dsh-tool-fs
 * is the canonical in-tree pattern this module mirrors.
 *
 * The dsh-android stance differs from `read_image` in one deliberate way:
 * where `read_image` REFUSES on a text-only route (the image is its entire
 * point), the capture tools here DEGRADE — their primary output is the JSON
 * summary, and the image block is an enhancement added only when (a) the
 * attachment store is mounted, (b) the calling route's resolved model
 * declares `image` input, and (c) admission succeeds. Any failure in that
 * chain silently keeps the rc.1 behavior, so text-only routes, headless
 * profiles, and older hosts never see a new error.
 *
 * Everything here is typed structurally: the plugin's compiled-against
 * typings (`0.1.5-rc.1`) still describe the attachment/vision surfaces
 * through structural shapes, so depending on their type exports would
 * break the independent-checkout build.
 * @module @zseven-w/dsh-android/vision
 */

/** The durable attachment reference an image block carries (plain JSON). */
export interface AndroidImageRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

/**
 * Structural face of the `attachments` service (AttachmentStore).
 *
 * BOTH entries are real and public. The mounted `LocalAttachmentStore`
 * implements `saveImage` (single) and inherits `saveImages` (an ordered batch
 * that loops over `saveImage`); the host's own `read_image` tool calls the
 * singular one. So either is a valid way to commit an image, and probing for
 * both is simply belt-and-braces — NOT a workaround for a method that is
 * missing.
 */
export interface AttachmentStoreLike {
  saveImages(inputs: Array<{ data: Uint8Array; mediaType: string; name?: string }>): Promise<AndroidImageRef[]>
  /** Present on the local backend too; accepted as an alternative entry. */
  saveImage?(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<AndroidImageRef>
}

/** Structural face of the `llm` service's model-info resolution. */
export interface LlmServiceLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
    inputModalities?: readonly string[]
  }>
}

/** Structural face of the exec context fields the route gate reads. */
export interface VisionExecLike {
  signal?: AbortSignal
  agent?: {
    session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined }
    options?: { provider?: string; model?: string }
  }
}

/** The services the capture tools need to emit image blocks. */
export interface AndroidVisionServices {
  attachments?: AttachmentStoreLike
  llm?: LlmServiceLike
}

/** Structural cordis context face (`ctx.get` never throws on absent services). */
interface ContextLike {
  get?(name: string): unknown
}

/**
 * Can this store commit an image? The mounted local backend carries BOTH
 * `saveImages` (documented batch entry) and `saveImage` (single-image), and
 * they live on a subclass of the kernel's AttachmentStore, so probing for
 * either one is correct — probing for exactly one is how the seam silently
 * switches itself off.
 */
function supportsImageCommit(store: AttachmentStoreLike): boolean {
  return typeof store.saveImages === 'function' || typeof store.saveImage === 'function'
}

/** True when this ctx can hand back a service (cordis' inject-free reader). */
function readerOf(ctx: unknown): ((name: string) => unknown) | undefined {
  return (ctx as ContextLike)?.get?.bind(ctx)
}

/**
 * Read the vision services NOW, tolerating late activation.
 *
 * cordis' `ctx.get(name)` defaults to `strict = true`, which returns
 * `undefined` unless the PROVIDING fiber is currently active (state 2). A
 * plugin's `apply()` can run before a bare dependency — `attachments` is an
 * OPTIONAL service here (see package.json dshHostRuntime.optionalServices), so
 * nothing orders it first — and anything captured at apply() time then stays
 * undefined for the life of the process, silently disabling image delivery
 * with no error anywhere.
 *
 * So each access re-reads instead of caching: by the time a tool actually
 * captures (minutes later, on a live session) the provider is active.
 */
function readNow(ctx: unknown): AndroidVisionServices {
  const get = readerOf(ctx)
  if (get === undefined) return {}
  const attachments = get('attachments') as AttachmentStoreLike | undefined
  const llm = get('llm') as LlmServiceLike | undefined
  return {
    ...(attachments !== undefined && supportsImageCommit(attachments) ? { attachments } : {}),
    ...(llm !== undefined && typeof llm.resolveModelInfo === 'function' ? { llm } : {}),
  }
}

/**
 * Resolve the optional vision services from the plugin context.
 *
 * Returns a LIVE view: `attachments` and `llm` are getters that re-resolve on
 * every access, so a provider that activates after this plugin still becomes
 * visible. Callers keep the same shape and the same "undefined means stay
 * text-only" contract — they simply stop sampling once, at the worst moment,
 * and freezing the answer.
 */
export function resolveVisionServices(ctx: unknown): AndroidVisionServices {
  if (readerOf(ctx) === undefined) return {}
  const services = {
    get attachments(): AttachmentStoreLike | undefined {
      return readNow(ctx).attachments
    },
    get llm(): LlmServiceLike | undefined {
      return readNow(ctx).llm
    },
  }
  return services
}

/**
 * True when the calling route's resolved model declares `image` input.
 * Mirrors `read_image`'s gate (request-header config first, then the agent
 * options) but answers false instead of throwing: a tool result that enters
 * durable history must not carry an image its route cannot replay, and for
 * our capture tools the safe degradation is "no image block".
 */
export async function imageInputActive(services: AndroidVisionServices, exec: VisionExecLike): Promise<boolean> {
  const llm = services.llm
  if (llm === undefined || services.attachments === undefined) return false
  try {
    const routed = exec.agent?.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? exec.agent?.options?.provider
    const model = routed?.model ?? exec.agent?.options?.model
    if (provider === undefined || model === undefined) return false
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return info.inputModalities?.includes('image') === true
  } catch {
    return false
  }
}

/**
 * Durably commit one screenshot PNG and return the plain reference for the
 * result value, or undefined when the store is absent or admission fails
 * (oversized, malformed) — never an error, per the degrade-not-refuse rule.
 */
export async function saveScreenshotAttachment(
  services: AndroidVisionServices,
  png: Uint8Array,
  name: string,
): Promise<AndroidImageRef | undefined> {
  const attachments = services.attachments
  if (attachments === undefined) return undefined
  try {
    const input = { data: png, mediaType: 'image/png', name }
    // Prefer the documented batch entry; fall back to the single-image one,
    // which the local backend also exposes.
    const ref = typeof attachments.saveImages === 'function'
      ? (await attachments.saveImages([input]))?.[0]
      : await attachments.saveImage?.(input)
    if (typeof ref?.attachmentId !== 'string' || ref.attachmentId === '') return undefined
    return {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
    }
  } catch {
    return undefined
  }
}

/** Output-schema fragment for the optional `image` result field. */
export const IMAGE_REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Durable attachment reference for the screenshot delivered to the model as an image block '
    + '(present only when the routed model declares image input).',
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'number', required: true },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
    name: { type: 'string' },
  },
} as const

/**
 * Render one JSON summary plus, when the value carries an `image` ref, the
 * image block itself — so an image-capable model SEES the screen instead of
 * reading a path. The cast is deliberate: the compiled-against 0.1.5-rc.1
 * typings expose the `image` content-block entry structurally only, so the
 * renderer keeps its own block shape for the independent-checkout build.
 */
export function renderJsonWithImage(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  const blocks: unknown[] = [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  const image = (value as { image?: AndroidImageRef } | undefined)?.image
  if (image !== undefined && typeof image.attachmentId === 'string') {
    blocks.push({ type: 'image', attachment: image })
  }
  return blocks as Array<{ type: 'text'; text: string }>
}
