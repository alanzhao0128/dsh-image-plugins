/**
 * Settings wiring tests: the plugin's config is settings-managed when a
 * settings service is mounted (panel edits apply without a restart), and the
 * /image-plugin-status RPC reports capability + credential state without ever
 * leaking secret values.
 * @module dsh-image-plugins/tests/settings
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as plugin from '../src/index.ts'
import { SETTINGS_NAMESPACE } from '../src/index.ts'
import { GENERATE_IMAGE_REF, UNDERSTAND_IMAGE_REF } from '../src/config.ts'

/** In-memory settings provider implementing the abstract storage seam. */
class MemorySettings extends SettingsProvider {
  data: Record<string, unknown>
  constructor(ctx: Context, initial: Record<string, unknown> = {}) {
    super(ctx)
    this.data = structuredClone(initial)
  }

  get writable(): boolean {
    return true
  }

  protected async load(): Promise<Record<string, unknown>> {
    return structuredClone(this.data)
  }

  protected async persist(ns: string, section: Record<string, unknown>): Promise<void> {
    this.data[ns] = structuredClone(section)
  }
}

interface RpcResult {
  ok: boolean
  value?: {
    credentials?: Record<string, { configured?: boolean; writable?: boolean; source?: string | null }>
    vision?: { baseUrl?: string; model?: string; apiKeyRef?: string }
    image?: { provider?: string; baseUrl?: string; model?: string; apiKeyRef?: string }
    autoUnderstand?: boolean
  }
}

/**
 * A stub `ctx.connection` whose `fetch.register` captures the plugin's
 * `/api/image-plugin-status/snapshot` route and exposes a callable that runs a
 * full envelope round-trip through the route (envelope validation + handler).
 */
function makeConnectionStub(): {
  stub: { fetch: { register(route: { path: string; fetch: (request: Request) => Promise<Response> }): void } }
  rpc: () => Promise<RpcResult>
} {
  let routeFetch: ((request: Request) => Promise<Response>) | null = null
  const stub = {
    fetch: {
      register(route: { path: string; fetch: (request: Request) => Promise<Response> }): void {
        if (route.path === '/api/image-plugin-status/snapshot') routeFetch = route.fetch
      },
    },
  }
  return {
    stub,
    rpc: async (): Promise<RpcResult> => {
      if (routeFetch === null) return { ok: false }
      const response = await routeFetch(new Request('http://127.0.0.1/api/image-plugin-status/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'image-plugin-status/snapshot', payload: {} }),
      }))
      const body = await response.json() as { result?: RpcResult }
      return response.status === 200 && body.result !== undefined ? body.result : { ok: false }
    },
  }
}

/** Mount the plugin with a settings provider + stub services; returns the RPC handler. */
async function mountWithSettings(
  initial: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<{ rpc: () => Promise<RpcResult>; dispose: () => void }> {
  const ctx = new Context()
  const conn = makeConnectionStub()
  ctx.provide('tools', { register(): void {} })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
  ctx.provide('connection', conn.stub as never)
  ctx.provide('credentials', {
    async describe(ref: string): Promise<{ configured: boolean; writable: boolean; source: string }> {
      return {
        configured: ref === credentialRef(UNDERSTAND_IMAGE_REF),
        writable: true,
        source: 'env',
      }
    },
  })
  await ctx.plugin(MemorySettings as never, initial)
  const fiber = ctx.plugin(plugin as never, config)
  await new Promise<void>(resolve => setTimeout(resolve, 400))
  return {
    rpc: conn.rpc,
    dispose: () => {
      fiber?.dispose()
    },
  }
}

test('settings initial values override the patch base config', async () => {
  const mounted = await mountWithSettings(
    {
      [SETTINGS_NAMESPACE]: {
        vision: { baseUrl: 'https://initial.example.com', apiKey: `cred:${UNDERSTAND_IMAGE_REF}`, model: 'initial-model' },
      },
    },
    { vision: { baseUrl: 'https://base.example.com', apiKey: `cred:${UNDERSTAND_IMAGE_REF}`, model: 'base-model' } },
  )
  try {
    const result = await mounted.rpc()
    assert.equal(result.ok, true)
    assert.equal(result.value?.vision?.model, 'initial-model')
    assert.equal(result.value?.vision?.baseUrl, 'https://initial.example.com')
    // image block absent → undefined (not an error)
    assert.equal(result.value?.image, undefined)
  } finally {
    mounted.dispose()
  }
})

test('settings edits apply to the live config without a restart', async () => {
  const ctx = new Context()
  const conn = makeConnectionStub()
  ctx.provide('tools', { register(): void {} })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
  ctx.provide('connection', conn.stub as never)
  ctx.provide('credentials', {
    async describe(ref: string): Promise<{ configured: boolean; writable: boolean; source: string }> {
      return { configured: ref === credentialRef(UNDERSTAND_IMAGE_REF), writable: true, source: 'env' }
    },
  })
  const ns = SETTINGS_NAMESPACE
  await ctx.plugin(MemorySettings as never, {
    [ns]: {
      vision: { baseUrl: 'https://a.example.com', apiKey: `cred:${UNDERSTAND_IMAGE_REF}`, model: 'model-a' },
    },
  })
  const fiber = ctx.plugin(plugin as never, {})
  await new Promise<void>(resolve => setTimeout(resolve, 400))

  const settings = ctx.get('settings')
  await settings.mutate(ns, [{ op: 'set', path: ['vision', 'model'], value: 'model-b' }])
  await new Promise<void>(resolve => setTimeout(resolve, 300))
  const result = await conn.rpc()
  assert.equal(result.value?.vision?.model, 'model-b')
  fiber?.dispose()
})

test('RPC reports credential state per fixed ref without leaking values', async () => {
  const mounted = await mountWithSettings(
    {
      [SETTINGS_NAMESPACE]: {
        vision: { baseUrl: 'https://v.example.com', apiKey: `cred:${UNDERSTAND_IMAGE_REF}`, model: 'v' },
        image: { baseUrl: 'https://i.example.com', apiKey: `cred:${GENERATE_IMAGE_REF}`, model: 'i' },
      },
    },
    {},
  )
  try {
    const result = await mounted.rpc()
    assert.equal(result.ok, true)
    const credentials = result.value?.credentials
    assert.ok(credentials)
    // Understand configured (mock says so); generate not configured.
    assert.equal(credentials[UNDERSTAND_IMAGE_REF]?.configured, true)
    assert.equal(credentials[GENERATE_IMAGE_REF]?.configured, false)
    // Never leaks the value: only configured/writable/source fields exist.
    assert.ok(!('value' in (credentials[UNDERSTAND_IMAGE_REF] as object)))
    assert.ok(!('key' in (credentials[UNDERSTAND_IMAGE_REF] as object)))
    assert.equal(result.value?.vision?.apiKeyRef, `cred:${UNDERSTAND_IMAGE_REF}`)
    assert.equal(result.value?.image?.provider, 'openai')
  } finally {
    mounted.dispose()
  }
})
