/**
 * OpenAI-compatible vision client: sends one image to a chat-completions
 * endpoint as an `image_url` data URL and returns the model's text answer.
 * @module dsh-image-plugins/src/vision
 */

/** A validated raster image ready for a vision call. */
export interface VisionImage {
  /** MIME type such as image/png. */
  mediaType: string
  /** Encoded image bytes. */
  data: Uint8Array
  /** Optional display name used in diagnostics. */
  name?: string
}

/** Options for one vision call. */
export interface VisionCallOptions {
  /** Endpoint base URL; a trailing slash is tolerated. */
  baseUrl: string
  /** Bearer API key. */
  apiKey: string
  /** Model id. */
  model: string
  /** Optional system prompt sent before the image. */
  systemPrompt?: string
  /** Overall request timeout in milliseconds. */
  timeoutMs: number
  /** Caller cancellation signal. */
  signal?: AbortSignal
}

/** Normalize an endpoint base URL: strip trailing slashes. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** Truncate a diagnostic string to a bounded length. */
export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** Extract the text answer from an OpenAI-compatible chat response payload. */
function extractAnswer(payload: unknown): string | undefined {
  const choices = (payload as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const message = (choices[0] as { message?: unknown } | null)?.message
  if (message === null || typeof message !== 'object') return undefined
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null
        && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string')
      .map(part => part.text)
      .join('')
      .trim()
    return text === '' ? undefined : text
  }
  return undefined
}

/**
 * Ask the configured vision model to describe one image.
 * @param options - endpoint, credentials, and timing.
 * @param prompt - the instruction or question about the image.
 * @param image - the encoded image to send.
 * @returns the model's text answer, trimmed.
 */
export async function callVision(
  options: VisionCallOptions,
  prompt: string,
  image: VisionImage,
): Promise<string> {
  if (options.apiKey === '') throw new Error('vision: apiKey is not configured')
  if (options.model === '') throw new Error('vision: model is not configured')
  if (prompt.trim() === '') throw new Error('vision: prompt must be a non-empty string')
  const dataUrl = `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
  const messages: unknown[] = []
  if (options.systemPrompt !== undefined && options.systemPrompt.trim() !== '') {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  })
  const url = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({ model: options.model, messages, temperature: 0.2 }),
    signal: AbortSignal.any([
      options.signal,
      AbortSignal.timeout(options.timeoutMs),
    ].filter((signal): signal is AbortSignal => signal !== undefined)),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`vision: HTTP ${response.status} from ${url} (model ${options.model}): ${truncate(body, 300)}`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const answer = extractAnswer(payload)
  if (answer === undefined) {
    throw new Error('vision: the endpoint returned no text content')
  }
  return answer
}
