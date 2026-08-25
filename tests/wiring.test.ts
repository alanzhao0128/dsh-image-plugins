/**
 * Wiring tests: mount the plugin on a real Cordis context with stub services
 * and assert tool registration follows the configuration.
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
  dispose(): void
}

/** Mount the plugin with stub services, wait for the async fiber start, and capture registrations. */
async function mount(config: PluginConfig): Promise<MountResult> {
  const ctx = new Context()
  const registeredTools: string[] = []
  let preStepListeners = 0
  ctx.provide('tools', {
    register(tool: { name: string }): void {
      registeredTools.push(tool.name)
    },
  })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
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
      if (registeredTools.length > 0 || preStepListeners > 0 || Date.now() - startedAt > 500) {
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
    dispose: () => {
      fiber?.dispose()
    },
  }
}

test('registers nothing when no capability is configured', async () => {
  const mounted = await mount({})
  try {
    assert.deepEqual(mounted.registeredTools, [])
    assert.equal(mounted.preStepListeners, 0)
  } finally {
    mounted.dispose()
  }
})

test('registers understand_image and the pre-step listener with vision only', async () => {
  const mounted = await mount({
    vision: { baseUrl: 'https://v.example.com/v1', apiKey: 'k', model: 'vision-m' },
  })
  try {
    assert.deepEqual(mounted.registeredTools, ['understand_image'])
    assert.equal(mounted.preStepListeners, 1)
  } finally {
    mounted.dispose()
  }
})

test('skips the pre-step listener when autoUnderstand is false', async () => {
  const mounted = await mount({
    vision: { baseUrl: 'https://v.example.com/v1', apiKey: 'k', model: 'vision-m' },
    autoUnderstand: false,
  })
  try {
    assert.deepEqual(mounted.registeredTools, ['understand_image'])
    assert.equal(mounted.preStepListeners, 0)
  } finally {
    mounted.dispose()
  }
})

test('registers generate_image with image config only', async () => {
  const mounted = await mount({
    image: { baseUrl: 'https://i.example.com/v1', apiKey: 'k', model: 'image-m' },
  })
  try {
    assert.deepEqual(mounted.registeredTools, ['generate_image'])
    assert.equal(mounted.preStepListeners, 0)
  } finally {
    mounted.dispose()
  }
})

test('registers both tools when both capabilities are configured', async () => {
  const mounted = await mount({
    vision: { baseUrl: 'https://v.example.com/v1', apiKey: 'k', model: 'vision-m' },
    image: { baseUrl: 'https://i.example.com/v1', apiKey: 'k', model: 'image-m' },
  })
  try {
    assert.deepEqual(new Set(mounted.registeredTools), new Set(['understand_image', 'generate_image']))
    assert.equal(mounted.preStepListeners, 1)
  } finally {
    mounted.dispose()
  }
})

test('accepts cred: apiKey values at load and defers resolution to execution', async () => {
  const ctx = new Context()
  const registeredTools: string[] = []
  let preStepListeners = 0
  ctx.provide('tools', {
    register(tool: { name: string }): void {
      registeredTools.push(tool.name)
    },
  })
  ctx.provide('fs', {})
  ctx.provide('agents', {})
  ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {} })
  ctx.provide('credentials', {
    async resolve(ref: string): Promise<{ value: string; source: string } | undefined> {
      if (ref === credentialRef('DEEPSEEK_API_KEY')) return { value: 'cred-secret', source: 'env' }
      return undefined
    },
  })
  const originalOn = ctx.on.bind(ctx)
  ctx.on = ((event: string, listener: (...args: unknown[]) => unknown, options?: unknown) => {
    if (event === 'agent/pre-step') preStepListeners += 1
    return originalOn(event as never, listener as never, options as never)
  }) as typeof ctx.on
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
    assert.deepEqual(registeredTools, ['understand_image'])
    assert.equal(preStepListeners, 0)
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
