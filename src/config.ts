/**
 * Configuration contracts and shared defaults for the dsh-image-plugins bundle.
 * @module dsh-image-plugins/src/config
 */

/** OpenAI-compatible vision endpoint configuration. */
export interface VisionConfig {
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
