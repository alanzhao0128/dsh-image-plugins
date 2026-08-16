/**
 * Image-generation clients. Two endpoint flavors behind one call:
 *
 * - `openai`: OpenAI-compatible `POST {baseUrl}/images/generations`, accepting
 *   `b64_json` or `url` response items.
 * - `dashscope`: Alibaba Model Studio native multimodal-generation API
 *   (`qwen-image` family). DashScope's compatible-mode path does not serve
 *   image generation, so this flavor builds the native endpoint and maps the
 *   `output.choices[0].message.content[0].image` response.
 * @module dsh-image-plugins/src/image-gen
 */

import type { ImageGenProvider } from './config.js'
import { normalizeBaseUrl, truncate } from './vision.js'

/** One reference image for image editing (I2I); dashscope flavor only. */
export interface ReferenceImage {
  /** MIME type such as image/png. */
  mediaType: string
  /** Encoded image bytes. */
  data: Uint8Array
  /** Optional display name used in diagnostics. */
  name?: string
}

/** Options for one image-generation call. */
export interface ImageGenOptions {
  /** Endpoint base URL; flavor-dependent semantics. */
  baseUrl: string
  /** Bearer API key. */
  apiKey: string
  /** Model id. */
  model: string
  /** Overall request timeout in milliseconds. */
  timeoutMs: number
  /** Caller cancellation signal. */
  signal?: AbortSignal
  /** Optional output size, e.g. 1024x1024. */
  size?: string
  /** Endpoint flavor; defaults to openai. */
  provider?: ImageGenProvider
  /** Reference images for image editing (I2I); requires the dashscope flavor. */
  referenceImages?: readonly ReferenceImage[]
}

/** The decoded result of one image-generation call. */
export interface ImageGenResult {
  /** Decoded image bytes. */
  data: Uint8Array
  /** Best-effort format label such as png or webp. */
  format: string
}

/** Derive a format label from a download URL's extension. */
export function formatFromUrl(url: string): string {
  const match = /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.exec(url)
  if (match === null) return 'png'
  const ext = match[1]!.toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

/** Build a combined abort signal from the caller signal and a timeout. */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return AbortSignal.any([
    signal,
    AbortSignal.timeout(timeoutMs),
  ].filter((s): s is AbortSignal => s !== undefined))
}

/** Download the generated image, preferring an authorized request. */
async function download(
  url: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const authorized = await fetch(url, { signal, headers: { authorization: `Bearer ${apiKey}` } })
  if (authorized.ok) return new Uint8Array(await authorized.arrayBuffer())
  if (authorized.status === 401 || authorized.status === 403) {
    const plain = await fetch(url, { signal })
    if (plain.ok) return new Uint8Array(await plain.arrayBuffer())
  }
  throw new Error(`image-gen: failed to download the generated image (HTTP ${authorized.status})`)
}

/**
 * Normalize a DashScope base URL to the native API root: strips a trailing
 * `/compatible-mode/v1` or `/v1`, so both `https://dashscope.aliyuncs.com` and
 * the compatible-mode form the console shows work.
 */
export function dashscopeRoot(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl)
    .replace(/\/compatible-mode\/v1$/, '')
    .replace(/\/v1$/, '')
}

/** Convert an OpenAI-style size (`1024x1024`) to the DashScope `1024*1024` form. */
export function dashscopeSize(size: string | undefined): string | undefined {
  if (size === undefined || size === '') return undefined
  return size.includes('*') ? size : size.replace('x', '*')
}

/** Build the DashScope content array: reference images first, then the text. */
function dashscopeContent(prompt: string, referenceImages: readonly ReferenceImage[] | undefined): unknown[] {
  const content: unknown[] = []
  if (referenceImages !== undefined) {
    for (const image of referenceImages) {
      content.push({ image: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}` })
    }
  }
  content.push({ text: prompt })
  return content
}

/** Generate one image through the Alibaba Model Studio native API. */
async function callDashscopeImageGen(
  options: ImageGenOptions,
  prompt: string,
): Promise<ImageGenResult> {
  const url = `${dashscopeRoot(options.baseUrl)}/api/v1/services/aigc/multimodal-generation/generation`
  const size = dashscopeSize(options.size)
  const body: Record<string, unknown> = {
    model: options.model,
    input: {
      messages: [{ role: 'user', content: dashscopeContent(prompt, options.referenceImages) }],
    },
    parameters: {
      n: 1,
      prompt_extend: true,
      ...(size === undefined ? {} : { size }),
    },
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: combineSignals(options.signal, options.timeoutMs),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = (payload as { code?: unknown } | null)?.code
    const message = (payload as { message?: unknown } | null)?.message
    const detail = typeof message === 'string' ? message : truncate(JSON.stringify(payload), 300)
    throw new Error(`image-gen: DashScope HTTP ${response.status}${typeof code === 'string' ? ` ${code}` : ''} from ${url} (model ${options.model}): ${detail}`)
  }
  const choices = (payload as { output?: { choices?: unknown } } | null)?.output?.choices
  const imageUrl = Array.isArray(choices)
    ? (choices[0] as { message?: { content?: Array<{ image?: unknown }> } } | null)?.message?.content?.[0]?.image
    : undefined
  if (typeof imageUrl !== 'string' || imageUrl === '') {
    throw new Error('image-gen: DashScope returned no image url')
  }
  return {
    data: await download(imageUrl, options.apiKey, combineSignals(options.signal, options.timeoutMs)),
    format: formatFromUrl(imageUrl),
  }
}

/**
 * Generate one image from a text prompt through the configured flavor.
 * @param options - endpoint, credentials, size, flavor, and timing.
 * @param prompt - the image description.
 * @returns decoded bytes plus a best-effort format label.
 */
export async function callImageGen(
  options: ImageGenOptions,
  prompt: string,
): Promise<ImageGenResult> {
  if (options.apiKey === '') throw new Error('image-gen: apiKey is not configured')
  if (options.model === '') throw new Error('image-gen: model is not configured')
  if (prompt.trim() === '') throw new Error('image-gen: prompt must be a non-empty string')
  if (options.provider === 'dashscope') return callDashscopeImageGen(options, prompt)
  if (options.referenceImages !== undefined && options.referenceImages.length > 0) {
    throw new Error('image-gen: reference images require provider "dashscope"; the openai flavor has no image input')
  }
  const url = `${normalizeBaseUrl(options.baseUrl)}/images/generations`
  const body: Record<string, unknown> = { model: options.model, prompt, n: 1 }
  if (options.size !== undefined && options.size !== '') body.size = options.size
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: combineSignals(options.signal, options.timeoutMs),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`image-gen: HTTP ${response.status} from ${url} (model ${options.model}): ${truncate(text, 300)}`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const items = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('image-gen: the endpoint returned no data items')
  }
  const item = items[0] as { b64_json?: unknown; url?: unknown } | null
  if (item !== null && typeof item === 'object' && typeof item.b64_json === 'string' && item.b64_json !== '') {
    return { data: new Uint8Array(Buffer.from(item.b64_json, 'base64')), format: 'png' }
  }
  if (item !== null && typeof item === 'object' && typeof item.url === 'string' && item.url !== '') {
    return {
      data: await download(item.url, options.apiKey, combineSignals(options.signal, options.timeoutMs)),
      format: formatFromUrl(item.url),
    }
  }
  throw new Error('image-gen: the response item carries neither b64_json nor url')
}
