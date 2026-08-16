/**
 * dsh-image-plugins: multimodal capability for DeepSeek Harness behind a
 * text-only main model. Understands image files and generates images through
 * configurable OpenAI-compatible endpoints.
 *
 * - `understand_image` (tool): describe a workspace image via the configured
 *   vision endpoint; the description enters the session log as the tool result.
 * - `generate_image` (tool): generate an image via the configured endpoint and
 *   save it into the workspace.
 * - auto-understand (`agent/pre-step` waterfall): images attached to a user
 *   message are described by the vision model and the message is rewritten to
 *   carry that text, so a text-only main model never receives an image block.
 *
 * Everything is optional: a capability registers only when its config block is
 * present. See README.md for installation and configuration.
 * @module dsh-image-plugins
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type { ImageConfig, PluginConfig, VisionConfig } from './config.js'
import { resolveApiKey } from './config.js'
import { applyAutoUnderstand } from './pre-step.js'
import { applyGenerateImageTool } from './tools/generate-image.js'
import { applyUnderstandImageTool } from './tools/understand-image.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-image-plugins'

/** Services this plugin needs: the tool registry, the fs seam, and the agent registry. */
export const inject = ['tools', 'fs', 'agents']

/** Schemastery validation for {@link PluginConfig}; every field is optional so an unconfigured install stays inert. */
export const Config: z<PluginConfig> = z.object({
  vision: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
    timeoutMs: z.number(),
    maxImageBytes: z.number(),
    systemPrompt: z.string(),
    defaultPrompt: z.string(),
  }),
  image: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
    provider: z.union(['openai', 'dashscope']),
    timeoutMs: z.number(),
    defaultSize: z.string(),
    outputDir: z.string(),
    maxReferenceBytes: z.number(),
  }),
  autoUnderstand: z.boolean(),
})

/**
 * Normalize an optional capability block: absent or fully empty disables it;
 * a partially filled block fails loud at load. Exported for unit tests.
 */
export function resolveVision(config: PluginConfig): VisionConfig | undefined {
  const raw = config.vision
  if (raw === undefined) return undefined
  const baseUrl = raw.baseUrl ?? ''
  const apiKey = raw.apiKey ?? ''
  const model = raw.model ?? ''
  if (baseUrl === '' && apiKey === '' && model === '') return undefined
  if (baseUrl === '' || apiKey === '' || model === '') {
    throw new Error('dsh-image-plugins: vision requires baseUrl, apiKey, and model together')
  }
  return { ...raw, baseUrl, apiKey: resolveApiKey(apiKey), model }
}

/** Normalize the image block; see {@link resolveVision}. Exported for unit tests. */
export function resolveImage(config: PluginConfig): ImageConfig | undefined {
  const raw = config.image
  if (raw === undefined) return undefined
  const baseUrl = raw.baseUrl ?? ''
  const apiKey = raw.apiKey ?? ''
  const model = raw.model ?? ''
  if (baseUrl === '' && apiKey === '' && model === '') return undefined
  if (baseUrl === '' || apiKey === '' || model === '') {
    throw new Error('dsh-image-plugins: image requires baseUrl, apiKey, and model together')
  }
  const provider = raw.provider ?? 'openai'
  if (provider !== 'openai' && provider !== 'dashscope') {
    throw new Error(`dsh-image-plugins: image.provider must be "openai" or "dashscope", got ${JSON.stringify(provider)}`)
  }
  return { ...raw, baseUrl, apiKey: resolveApiKey(apiKey), model, provider }
}

/**
 * Register the configured capabilities for the lifetime of `ctx`.
 * @param ctx - plugin context; registrations are disposed with it.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: PluginConfig): void {
  const vision = resolveVision(config)
  const image = resolveImage(config)
  if (vision !== undefined) {
    applyUnderstandImageTool(ctx, vision)
    if (config.autoUnderstand !== false) applyAutoUnderstand(ctx, vision)
    ctx.logger.info(`dsh-image-plugins: vision enabled (${vision.model}); auto-understand ${config.autoUnderstand === false ? 'off' : 'on'}`)
  }
  if (image !== undefined) {
    applyGenerateImageTool(ctx, image)
    ctx.logger.info(`dsh-image-plugins: image generation enabled (${image.model})`)
  }
  if (vision === undefined && image === undefined) {
    ctx.logger.warn('dsh-image-plugins: neither vision nor image is configured; nothing is enabled')
  }
}
