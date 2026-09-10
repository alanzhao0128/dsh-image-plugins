/**
 * Configuration contracts and shared defaults for the dsh-image-plugins bundle.
 * @module dsh-image-plugins/src/config
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/**
 * Fixed credential-reference names backing the two capabilities. The settings
 * panel writes the actual secret values into the host credential store under
 * these names; plugin config only ever carries `cred:NAME` references.
 */
export const UNDERSTAND_IMAGE_REF = 'UNDERSTAND_IMAGE_KEY'
export const GENERATE_IMAGE_REF = 'GENERATE_IMAGE_KEY'

/** OpenAI-compatible vision endpoint configuration. */
export interface VisionConfig {
  /**
   * Capability switch: when false, understand_image is not registered (the
   * model never sees it) and the dormant auto-understand path is inert.
   * Defaults to true.
   */
  enabled?: boolean
  /** Endpoint base URL, e.g. https://api.example.com/v1. */
  baseUrl: string
  /** Bearer API key; a literal value or `env:NAME` for process.env.NAME. */
  apiKey: string
  /** Model id that accepts image input on the endpoint. */
  model: string
  /** Per-request timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number
  /** Maximum encoded image bytes accepted by understand_image. Defaults to 20 MiB. */
  maxImageBytes?: number
  /** Optional system prompt for every vision call. */
  systemPrompt?: string
  /** Default instruction used when understand_image is called without a prompt. */
  defaultPrompt?: string
}

/** Image-generation endpoint flavors the plugin can speak. */
export type ImageGenProvider = 'openai' | 'dashscope'

/** OpenAI-compatible image-generation endpoint configuration. */
export interface ImageConfig {
  /**
   * Capability switch: when false, generate_image is not registered (the
   * model never sees it). Defaults to true.
   */
  enabled?: boolean
  /** Endpoint base URL. For `openai`: e.g. https://api.example.com/v1; for `dashscope`: https://dashscope.aliyuncs.com (a /compatible-mode/v1 suffix is tolerated). */
  baseUrl: string
  /** Bearer API key; a literal value or `env:NAME` for process.env.NAME. */
  apiKey: string
  /** Model id that generates images on the endpoint. */
  model: string
  /**
   * Endpoint flavor. `openai` (default) speaks `POST {baseUrl}/images/generations`;
   * `dashscope` speaks the Alibaba Model Studio native multimodal-generation API
   * (the compatible-mode path does not serve image generation).
   */
  provider?: ImageGenProvider
  /** Per-request timeout in milliseconds. Defaults to 120_000. */
  timeoutMs?: number
  /** Default output size, e.g. 1024x1024. */
  defaultSize?: string
  /** Workspace-relative directory for generated images. Defaults to `generated`. */
  outputDir?: string
  /** Maximum encoded bytes accepted for one reference image (I2I). Defaults to 10 MiB (the DashScope limit). */
  maxReferenceBytes?: number
}

/** Plugin configuration; each capability is optional and independent. */
export interface PluginConfig {
  /** Enables understand_image and, unless disabled below, auto-understand. */
  vision?: VisionConfig
  /** Enables generate_image. */
  image?: ImageConfig
  /**
   * V2 switch: when true and vision is configured, images attached to a user
   * message are described by the vision model and the message is rewritten to
   * carry that text before the step enters the log. Defaults to true.
   */
  autoUnderstand?: boolean
}

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_IMAGE_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const DEFAULT_IMAGE_OUTPUT_DIR = 'generated'
export const DEFAULT_IMAGE_SIZE = '1024x1024'
export const DEFAULT_IMAGE_PROVIDER: ImageGenProvider = 'openai'
export const DEFAULT_MAX_REFERENCE_BYTES = 10 * 1024 * 1024

/** Default instruction for the understand_image tool when the model gives none. */
export const DEFAULT_VISION_PROMPT =
  'Describe this image in detail, including any visible text, numbers, charts, or UI elements. Answer in the language of the request that led here.'

/** Default instruction for the automatic pre-step description. */
export const DEFAULT_AUTO_PROMPT =
  'Describe this image concisely in a few sentences for a text-only assistant: what it shows, any visible text, and anything notable.'

/** Resolve an `env:NAME` apiKey value against the process environment. */
export function resolveApiKey(value: string): string {
  if (!value.startsWith('env:')) return value
  const name = value.slice('env:'.length)
  const resolved = process.env[name]
  if (resolved === undefined) {
    throw new Error(`dsh-image-plugins: environment variable ${JSON.stringify(name)} referenced by apiKey is not set`)
  }
  return resolved
}

/**
 * Resolve a `cred:NAME` apiKey value through the host credential seam
 * (`ctx.credentials`, e.g. `~/.dsh/.credentials.yaml`). Non-`cred:` values
 * pass through unchanged, so callers may chain this after {@link resolveApiKey}
 * to accept literal, `env:`, and `cred:` forms alike.
 *
 * Resolution is per call: the host service re-reads its durable store each
 * time, so a changed credential reaches the next request without a plugin
 * restart, and the secret never needs to live in this plugin's config.
 * @param ctx - plugin context carrying the optional credential service.
 * @param value - configured apiKey value.
 * @returns the resolved secret, or `value` when it is not a `cred:` reference.
 * @throws when `cred:` names a ref but no credentials service is mounted, or
 * the referenced credential is not configured.
 */
export async function resolveApiKeyFromCredentials(ctx: Context, value: string): Promise<string> {
  if (!value.startsWith('cred:')) return value
  const name = value.slice('cred:'.length)
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new Error(
      `dsh-image-plugins: apiKey references credential ${JSON.stringify(name)} but no credentials service is mounted`,
    )
  }
  const hit = await credentials.resolve(credentialRef(name))
  if (hit === undefined) {
    throw new Error(
      `dsh-image-plugins: credential ${JSON.stringify(name)} referenced by apiKey is not configured; `
      + 'store it through the credentials service (e.g. the web Models page) or use a literal apiKey',
    )
  }
  return hit.value
}

/**
 * Resolve a configured apiKey at request time: literal values pass through,
 * `env:NAME` reads the process environment, and `cred:NAME` resolves through
 * the host credential seam. Call this inside the actual request path (tool
 * execute, pre-step describe) rather than at plugin load: the credential
 * service may not be started yet while `apply` runs, and per-operation
 * resolution is exactly what the host seam expects.
 * @param ctx - plugin context carrying the optional credential service.
 * @param value - configured apiKey value.
 * @returns the resolved secret.
 */
export async function resolveApiKeyRuntime(ctx: Context, value: string): Promise<string> {
  return resolveApiKeyFromCredentials(ctx, resolveApiKey(value))
}

/**
 * Schemastery validation for the settings-managed configuration. Every field
 * is optional so an unconfigured install stays inert; `resolveConfig` applies
 * explicit defaults (the only place defaults live).
 */
export const Config: z<PluginConfig> = z.object({
  vision: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
    timeoutMs: z.number(),
    maxImageBytes: z.number(),
    systemPrompt: z.string(),
    defaultPrompt: z.string(),
  }),
  image: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
    provider: z.union(['openai', 'dashscope']),
    timeoutMs: z.number(),
    defaultSize: z.string(),
    outputDir: z.string(),
    maxReferenceBytes: z.number(),
  }),
  // EXPERIMENTAL, undocumented: enables the dormant pre-step auto-understand
  // rewrite (src/pre-step.ts). Keep false; the supported surface is the two
  // model tools.
  autoUnderstand: z.boolean(),
})

/** Defaults mirroring the historical hardcoded constants; upgrades are no-ops. */
export const DEFAULTS: PluginConfig = {
  vision: {
    enabled: true,
    baseUrl: '',
    apiKey: `cred:${UNDERSTAND_IMAGE_REF}`,
    model: '',
  },
  image: {
    enabled: true,
    baseUrl: '',
    apiKey: `cred:${GENERATE_IMAGE_REF}`,
    model: '',
    provider: DEFAULT_IMAGE_PROVIDER,
  },
  autoUnderstand: false,
}

/**
 * Normalize and default a raw configuration. Missing capability blocks are
 * left absent (a capability registers only when fully configured); present
 * blocks receive defaults for every omitted field.
 */
export function resolveConfig(config: PluginConfig = {}): PluginConfig {
  const vision = config.vision === undefined
    ? undefined
    : {
        enabled: config.vision.enabled ?? true,
        baseUrl: config.vision.baseUrl ?? '',
        apiKey: config.vision.apiKey ?? `cred:${UNDERSTAND_IMAGE_REF}`,
        model: config.vision.model ?? '',
        ...(config.vision.timeoutMs === undefined ? {} : { timeoutMs: config.vision.timeoutMs }),
        ...(config.vision.maxImageBytes === undefined ? {} : { maxImageBytes: config.vision.maxImageBytes }),
        ...(config.vision.systemPrompt === undefined ? {} : { systemPrompt: config.vision.systemPrompt }),
        ...(config.vision.defaultPrompt === undefined ? {} : { defaultPrompt: config.vision.defaultPrompt }),
      }
  const image = config.image === undefined
    ? undefined
    : {
        enabled: config.image.enabled ?? true,
        baseUrl: config.image.baseUrl ?? '',
        apiKey: config.image.apiKey ?? `cred:${GENERATE_IMAGE_REF}`,
        model: config.image.model ?? '',
        provider: config.image.provider ?? DEFAULT_IMAGE_PROVIDER,
        ...(config.image.timeoutMs === undefined ? {} : { timeoutMs: config.image.timeoutMs }),
        ...(config.image.defaultSize === undefined ? {} : { defaultSize: config.image.defaultSize }),
        ...(config.image.outputDir === undefined ? {} : { outputDir: config.image.outputDir }),
        ...(config.image.maxReferenceBytes === undefined ? {} : { maxReferenceBytes: config.image.maxReferenceBytes }),
      }
  return {
    ...vision === undefined ? {} : { vision },
    ...image === undefined ? {} : { image },
    autoUnderstand: config.autoUnderstand ?? false,
  }
}
