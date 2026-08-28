/**
 * Wiring tests: mount the plugin on a real Cordis context with stub services
 * and assert tool registration follows the configuration.
 *
 * Since 0.2.0 the two tools always register (they resolve their configuration
 * per execution from the live settings, and fail with a clear "not configured"
 * error when the panel has not filled the block in). Only the dormant
 * pre-step auto-understand listener is conditional (autoUnderstand).
 * @module dsh-image-plugins/tests/wiring
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as plugin from '../src/index.ts'
import type { PluginConfig } from '../src/config.ts'

interface MountResult {
  registeredTools: string[]
  preStepListeners: number
  rpcChannels: string[]
  dispose(): void
}

/** Mount the plugin with stub services, wait for the async fiber start, and capture registrations. */
async function mount(config: PluginConfig): Promise<MountResult> {
  const ctx = new Context()
  const registeredTools: string[] = []
  const rpcChannels: string[] = []
  let preStepListeners = 0
  ctx.provide('tools', {
    register(tool: { name: string }): void {
      registeredTools.push(tool.name)
    },
  })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
  ctx.provide('connection', {
    rpc: {
      handle(channel: string): void {
        rpcChannels.push(channel)
      },
    },
  })
  ctx.provide('credentials', {
    async describe(): Promise<{ configured: boolean; writable: boolean; source: string } | undefined> {
      return { configured: false, writable: true, source: null }
    },
  })
  const originalOn = ctx.on.bind(ctx)
  ctx.on = ((event: string, listener: (...args: unknown[]) => unknown, options?: unknown) => {
    if (event === 'agent/pre-step') preStepListeners += 1
    return originalOn(event as never, listener as never, options as never)
  }) as typeof ctx.on
  const fiber = ctx.plugin(plugin as never, config)
  // cordis starts plugin fibers asynchronously; poll until the fiber settles.
  await new Promise<void>(resolve => {
    const startedAt = Date.now()
    const poll = (): void => {
      if (registeredTools.length > 0 || preStepListeners > 0 || rpcChannels.length > 0 || Date.now() - startedAt > 500) {
        resolve()
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
  return {
    registeredTools,
    preStepListeners,
    rpcChannels,
    dispose: () => {
      fiber?.dispose()
    },
  }
}

test('registers both tools even with an empty config (they resolve live config per execution)', async () => {
  const mounted = await mount({})
  try {
    assert.deepEqual(new Set(mounted.registeredTools), new Set(['understand_image', 'generate_image']))
    // autoUnderstand defaults to false in resolveConfig, so no pre-step listener.
    assert.equal(mounted.preStepListeners, 0)
  } finally {
    mounted.dispose()
  }
})

test('registers the pre-step listener only when autoUnderstand is true', async () => {
  const mounted = await mount({ autoUnderstand: true })
  try {
    assert.equal(mounted.preStepListeners, 1)
  } finally {
    mounted.dispose()
  }
})

test('skips the pre-step listener when autoUnderstand is false', async () => {
  const mounted = await mount({ autoUnderstand: false })
  try {
    assert.equal(mounted.preStepListeners, 0)
  } finally {
    mounted.dispose()
  }
})

test('registers the /image-plugin-status RPC channel', async () => {
  const mounted = await mount({})
  try {
    assert.ok(mounted.rpcChannels.includes('/image-plugin-status'))
  } finally {
    mounted.dispose()
  }
})

test('accepts cred: apiKey values at load and defers resolution to execution', async () => {
  const ctx = new Context()
  const registeredTools: string[] = []
  ctx.provide('tools', {
    register(tool: { name: string }): void {
      registeredTools.push(tool.name)
    },
  })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
  ctx.provide('connection', {
    rpc: {
      handle(): void {},
    },
  })
  ctx.provide('credentials', {
    async describe(): Promise<{ configured: boolean; writable: boolean; source: string } | undefined> {
      return { configured: false, writable: true, source: null }
    },
  })
  const fiber = ctx.plugin(plugin as never, {
    vision: { baseUrl: 'https://v.example.com/v1', apiKey: 'cred:DEEPSEEK_API_KEY', model: 'vision-m' },
    autoUnderstand: false,
  })
  await new Promise<void>(resolve => {
    const startedAt = Date.now()
    const poll = (): void => {
      if (registeredTools.length > 0 || Date.now() - startedAt > 500) {
        resolve()
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
  try {
    assert.deepEqual(new Set(registeredTools), new Set(['understand_image', 'generate_image']))
  } finally {
    fiber?.dispose()
  }
})

test('apply does not resolve cred: values (resolution happens per request)', async () => {
  // The credential service is intentionally absent: at load time the plugin
  // must not require it, because the service may not be started yet when apply
  // runs. A cred: apiKey resolves inside the tool's execute path instead.
  const ctx = new Context()
  ctx.provide('tools', {
    register(): void {},
  })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
  plugin.apply(ctx, {
    vision: { baseUrl: 'https://v.example.com/v1', apiKey: 'cred:DEEPSEEK_API_KEY', model: 'vision-m' },
    autoUnderstand: false,
  })
  // No rejection: apply() returned synchronously without touching credentials.
})
