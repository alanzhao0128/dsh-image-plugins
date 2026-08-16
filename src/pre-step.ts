/**
 * EXPERIMENTAL — not documented in the README and not part of the supported
 * surface. Implemented and unit-tested, but never verified end-to-end in a
 * live session, and unreachable without the rejected "declared image input"
 * workaround (the host preflight refuses attachments for text-only models).
 * Kept dormant for a possible paste-to-chat iteration; do not build on it.
 *
 * V2 auto-understand: an `agent/pre-step` waterfall listener that rewrites
 * claimed user messages carrying image blocks into text carrying the vision
 * model's description. The rewritten messages are exactly what the loop
 * appends to the session log, so the request-reconstruction invariant holds
 * (model-visible content is log-derived) and the text-only main model never
 * receives an image block.
 *
 * The rewrite runs whenever `autoUnderstand` is on and a message carries
 * images. There is deliberately no "does the routed model accept images" gate:
 * a text-only endpoint whose model profile declares `input: [text, image]`
 * (the documented way to admit attachments past the host preflight) must still
 * have its images rewritten, or the provider rejects the request mid-turn.
 * Users whose main model genuinely accepts images should set
 * `autoUnderstand: false` instead.
 * @module dsh-image-plugins/src/pre-step
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { VisionConfig } from './config.js'
import { DEFAULT_AUTO_PROMPT, DEFAULT_TIMEOUT_MS } from './config.js'
import { callVision } from './vision.js'

/** Bound on the per-process description cache (attachment ids are immutable). */
const MAX_CACHE_ENTRIES = 64

/** Describe one attachment reference; throws with a reason the caller can surface. */
export type DescribeImage = (ref: ImageAttachmentRef, signal: AbortSignal) => Promise<string>

/** Deterministic placeholder used when describing an image fails. */
function failurePlaceholder(name: string, reason: string): string {
  return `[the attached image ${JSON.stringify(name)} could not be described (${reason}); call the understand_image tool for another attempt]`
}

/**
 * Rewrite user messages that carry image blocks into text carrying each
 * image's description, keeping every other block intact. Pure apart from the
 * injected describe function; exported for unit tests.
 * @param messages - the messages entering the step.
 * @param describe - resolves one attachment reference to its description.
 * @param signal - the step's cancellation signal.
 * @returns rewritten messages; messages without images pass through unchanged.
 */
export async function rewriteImageMessages(
  messages: readonly UserMessage[],
  describe: DescribeImage,
  signal: AbortSignal,
): Promise<UserMessage[]> {
  const rewritten: UserMessage[] = []
  for (const message of messages) {
    if (!message.content.some(block => block.type === 'image')) {
      rewritten.push(message)
      continue
    }
    const content: UserMessage['content'] = []
    for (const block of message.content) {
      if (block.type !== 'image') {
        content.push(block)
        continue
      }
      const name = block.attachment.name ?? String(block.attachment.attachmentId)
      let description: string
      try {
        description = await describe(block.attachment, signal)
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error)
        description = failurePlaceholder(name, reason)
      }
      content.push({ type: 'text', text: `[attached image ${JSON.stringify(name)} described for a text-only model: ${description}]` })
    }
    rewritten.push({ ...message, content })
  }
  return rewritten
}

/**
 * Register the auto-understand waterfall for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param vision - vision endpoint configuration; must be fully configured.
 */
export function applyAutoUnderstand(ctx: Context, vision: VisionConfig): void {
  const cache = new Map<string, string>()
  const describe: DescribeImage = async (ref, signal) => {
    const cacheKey = String(ref.attachmentId)
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('no attachment service is mounted')
    const stored = await attachments.readImage(ref, signal)
    const description = await callVision(
      {
        baseUrl: vision.baseUrl,
        apiKey: vision.apiKey,
        model: vision.model,
        timeoutMs: vision.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        systemPrompt: vision.systemPrompt,
        signal,
      },
      vision.defaultPrompt ?? DEFAULT_AUTO_PROMPT,
      { mediaType: stored.ref.mediaType, data: stored.data, name: stored.ref.name },
    )
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(cacheKey, description)
    return description
  }
  ctx.on('agent/pre-step', async (
    { signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (!decision.messages.some(message => message.content.some(block => block.type === 'image'))) {
      return decision
    }
    const messages = await rewriteImageMessages(decision.messages, describe, signal)
    return { kind: 'enter', messages }
  }, { prepend: true })
}
