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
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsSectionHooks } from '@deepseek-ai/dsh-settings'
import {
  Config,
  GENERATE_IMAGE_REF,
  UNDERSTAND_IMAGE_REF,
  type ImageConfig,
  type PluginConfig,
  type VisionConfig,
} from './config.js'
import { resolveApiKey, resolveConfig } from './config.js'
import { applyAutoUnderstand } from './pre-step.js'
import { applyGenerateImageTool } from './tools/generate-image.js'
import { applyUnderstandImageTool } from './tools/understand-image.js'

export { Config } from './config.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-image-plugins'

/** Settings namespace for this plugin's user configuration (settings.yaml section). */
export const SETTINGS_NAMESPACE = 'dsh-image-plugins'

/** Services this plugin needs: the tool registry, the fs seam, and the agent registry. */
export const inject = ['tools', 'fs', 'agents', 'connection', 'credentials']

/**
 * One `/api` shared-channel Fetch route carrying the classic client-request
 * envelope (`{type:'client-request', rpcId, method, payload}` → `{type:
 * 'server-response', rpcId, result:{ok,value}}`). dsh ≥ 0.1.5 moved plugin
 * RPC from `connection.rpc.handle` (a webServer prefix route) to exact
 * `/api/...` Fetch routes (`connection.fetch.register`); the envelope wire
 * protocol is unchanged, so clients keep parsing `result.ok / result.value`.
 *
 * Error branches mirror the official `rpcFetchHandler` (rpc-host.ts):
 * non-POST → 404, wrong content-type → 415, unparseable body → 400,
 * invalid envelope → 400, handler throw → 500.
 * @param endpoint - endpoint path below `/api`, e.g. `image-plugin-status/snapshot`.
 * @param handler - request handler with the classic `(endpoint, payload, signal)` signature.
 * @returns a Fetch route for {@link HostConnectionFetch.register}.
 */
export function rpcRoute(
  endpoint: string,
  handler: (endpoint: string, payload: unknown, signal: AbortSignal | undefined) => Promise<unknown>,
): {
  path: string
  methods: readonly string[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
} {
  const path = `/api/${endpoint}`
  return {
    path,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      if (request.method !== 'POST') return new Response('not found', { status: 404 })
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let message: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown } | null
      try {
        message = await request.json() as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown } | null
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      if (message === null || typeof message !== 'object'
        || message.type !== 'client-request'
        || typeof message.rpcId !== 'string'
        || message.method !== endpoint) {
        return new Response('invalid client-request message', { status: 400 })
      }
      try {
        const result = await handler(endpoint, message.payload, request.signal)
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

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

/** Live settings-managed configuration; re-resolved on every settings change. */
let live: PluginConfig = {}

/**
 * Register the configured capabilities for the lifetime of `ctx`.
 *
 * The apiKey value may still be a `cred:NAME` reference here — it is resolved
 * per request inside each tool's execute path (see resolveApiKeyRuntime), not
 * at load: the host credential service is not guaranteed to be started yet
 * while `apply` runs.
 *
 * Configuration is settings-managed when the host mounts a settings service:
 * edits made in the settings panel apply without a restart (tools re-read the
 * live config on every execution). Without a settings service (tests, minimal
 * hosts) the plugin falls back to the passed-in `config` directly.
 * @param ctx - plugin context; registrations are disposed with it.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: PluginConfig): void {
  let source = (): PluginConfig => config
  live = resolveConfig(config)
  // Settings-managed config (dsh ≥ 0.1.2): register the namespace through the
  // settings service when one is mounted; without one the plugin keeps using
  // the composition entry (config) directly. The scope's resolved value layers
  // schema defaults < composition base < user document section.
  const hooks: SettingsSectionHooks<PluginConfig> = {
    setSource: (get: () => PluginConfig) => { source = get },
    onChange: () => { live = resolveConfig(source()) },
  }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, hooks)
  })
  // Getters re-resolve the live config on every call, so settings edits reach
  // the next tool execution without a restart. resolveVision/resolveImage
  // return undefined for unconfigured blocks; tools then fail with a clear
  // "not configured" error instead of being absent (the panel may configure
  // them at any time).
  const getVision = (): VisionConfig | undefined => resolveVision(live)
  const getImage = (): ImageConfig | undefined => resolveImage(live)
  applyUnderstandImageTool(ctx, getVision)
  applyGenerateImageTool(ctx, getImage)
  if (live.autoUnderstand !== false) applyAutoUnderstand(ctx, getVision)

  const connection = ctx.get('connection')
  if (connection !== undefined && typeof connection?.fetch?.register === 'function') {
    connection.fetch.register(rpcRoute('image-plugin-status/snapshot', async (_endpoint, _payload, _signal) => {
      const credentials = ctx.get('credentials')
      const describe = async (ref: string): Promise<{ configured: boolean; writable: boolean; source: string | null }> => {
        if (credentials === undefined || typeof credentials.describe !== 'function') {
          return { configured: false, writable: false, source: null }
        }
        try {
          const view = await credentials.describe(credentialRef(ref))
          return {
            configured: view?.configured === true,
            writable: view?.writable === true,
            source: typeof view?.source === 'string' ? view.source : null,
          }
        } catch {
          return { configured: false, writable: false, source: null }
        }
      }
      const [understand, generate] = await Promise.all([
        describe(UNDERSTAND_IMAGE_REF),
        describe(GENERATE_IMAGE_REF),
      ])
      // A partially filled block throws from resolveVision/resolveImage; the
      // panel must still report status (and let the user finish configuring),
      // so read the blocks defensively here.
      let vision: VisionConfig | undefined
      let image: ImageConfig | undefined
      try { vision = resolveVision(live) } catch { vision = undefined }
      try { image = resolveImage(live) } catch { image = undefined }
      return {
        ok: true,
        value: {
          credentials: {
            [UNDERSTAND_IMAGE_REF]: understand,
            [GENERATE_IMAGE_REF]: generate,
          },
          vision: vision === undefined ? undefined : {
            baseUrl: vision.baseUrl,
            model: vision.model,
            apiKeyRef: vision.apiKey.startsWith('cred:') ? vision.apiKey : undefined,
          },
          image: image === undefined ? undefined : {
            provider: image.provider ?? 'openai',
            baseUrl: image.baseUrl,
            model: image.model,
            apiKeyRef: image.apiKey.startsWith('cred:') ? image.apiKey : undefined,
          },
          autoUnderstand: live.autoUnderstand ?? false,
          updatedAt: Date.now(),
        },
      }
    }))
  }
}
