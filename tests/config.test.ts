/**
 * Unit tests for capability-block normalization at plugin load.
 * @module dsh-image-plugins/tests/config
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveImage, resolveVision } from '../src/index.ts'
import {
  GENERATE_IMAGE_REF,
  UNDERSTAND_IMAGE_REF,
  resolveApiKeyFromCredentials,
  resolveApiKeyRuntime,
  resolveConfig,
} from '../src/config.ts'
import type { PluginConfig } from '../src/config.ts'

test('resolveConfig fills defaults for present blocks and keeps absent blocks absent', () => {
  const resolved = resolveConfig({})
  assert.equal(resolved.vision, undefined)
  assert.equal(resolved.image, undefined)
  assert.equal(resolved.autoUnderstand, false)

  const partial = resolveConfig({
    vision: { baseUrl: 'https://v.example.com', model: 'm' },
  })
  assert.equal(partial.vision?.baseUrl, 'https://v.example.com')
  assert.equal(partial.vision?.model, 'm')
  // Capabilities default to enabled; apiKey defaults to the fixed refs.
  assert.equal(partial.vision?.enabled, true)
  assert.equal(partial.vision?.apiKey, `cred:${UNDERSTAND_IMAGE_REF}`)
  assert.equal(partial.image, undefined)
})

test('resolveConfig preserves explicit enabled flags and defaults absent ones to true', () => {
  const resolved = resolveConfig({
    vision: { enabled: false, baseUrl: 'https://v.example.com', model: 'm' },
    image: { baseUrl: 'https://i.example.com', model: 'img-m' },
  })
  assert.equal(resolved.vision?.enabled, false)
  assert.equal(resolved.image?.enabled, true)
  assert.equal(resolved.image?.provider, 'openai')
  assert.equal(resolved.image?.apiKey, `cred:${GENERATE_IMAGE_REF}`)
  // The block stays present even when disabled (the switch is part of it).
  assert.ok(resolved.vision !== undefined)
})

test('resolveConfig defaults the image block and its credential ref', () => {
  const resolved = resolveConfig({
    image: { baseUrl: 'https://i.example.com', model: 'img-m' },
  })
  assert.equal(resolved.image?.provider, 'openai')
  assert.equal(resolved.image?.apiKey, `cred:${GENERATE_IMAGE_REF}`)
  assert.equal(resolved.image?.timeoutMs, undefined) // stays undefined; tool applies DEFAULT_IMAGE_TIMEOUT_MS
  assert.equal(resolved.vision, undefined)
})

test('resolveConfig preserves explicitly set values over defaults', () => {
  const resolved = resolveConfig({
    vision: { baseUrl: 'https://v.example.com', apiKey: 'plain-key', model: 'm', timeoutMs: 1234 },
    image: { baseUrl: 'https://i.example.com', apiKey: 'env:K', model: 'im', provider: 'dashscope', timeoutMs: 4321 },
    autoUnderstand: true,
  })
  assert.equal(resolved.vision?.apiKey, 'plain-key')
  assert.equal(resolved.vision?.timeoutMs, 1234)
  assert.equal(resolved.image?.provider, 'dashscope')
  assert.equal(resolved.image?.timeoutMs, 4321)
  assert.equal(resolved.autoUnderstand, true)
})

test('disables vision when the block is absent', () => {
  assert.equal(resolveVision({}), undefined)
})

test('disables vision when the block is fully empty', () => {
  assert.equal(resolveVision({ vision: {} }), undefined)
  assert.equal(resolveVision({ vision: { baseUrl: '', apiKey: '', model: '' } }), undefined)
})

test('fails loud on a partially filled vision block', () => {
  assert.throws(() => resolveVision({ vision: { baseUrl: 'https://x' } }), /together/)
  assert.throws(() => resolveVision({ vision: { baseUrl: '', apiKey: 'k', model: 'm' } }), /together/)
})

test('resolves a complete vision block and expands env: keys', () => {
  process.env.DSH_IMAGE_PLUGINS_TEST_KEY = 'secret'
  try {
    const vision = resolveVision({ vision: { baseUrl: 'https://x/v1', apiKey: 'env:DSH_IMAGE_PLUGINS_TEST_KEY', model: 'm' } })
    assert.equal(vision?.baseUrl, 'https://x/v1')
    assert.equal(vision?.apiKey, 'secret')
    assert.equal(vision?.model, 'm')
    assert.equal(vision?.enabled, true) // defaults to enabled when omitted
    const disabled = resolveVision({ vision: { enabled: false, baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' } })
    assert.equal(disabled?.enabled, false)
  } finally {
    delete process.env.DSH_IMAGE_PLUGINS_TEST_KEY
  }
})

test('throws when an env: key references an unset variable', () => {
  assert.throws(
    () => resolveVision({ vision: { baseUrl: 'https://x', apiKey: 'env:DSH_IMAGE_PLUGINS_MISSING', model: 'm' } }),
    /not set/,
  )
})

test('normalizes the image block the same way', () => {
  assert.equal(resolveImage({}), undefined)
  assert.equal(resolveImage({ image: {} }), undefined)
  assert.throws(() => resolveImage({ image: { model: 'm' } }), /together/)
  const image = resolveImage({ image: { baseUrl: 'https://x', apiKey: 'k', model: 'm', defaultSize: '512x512' } })
  assert.equal(image?.defaultSize, '512x512')
  assert.equal(image?.enabled, true) // defaults to enabled when omitted
  const disabled = resolveImage({ image: { enabled: false, baseUrl: 'https://x', apiKey: 'k', model: 'm' } })
  assert.equal(disabled?.enabled, false)
})

test('accepts the dashscope provider and rejects unknown providers', () => {
  const dashscope = resolveImage({ image: { baseUrl: 'https://dashscope.aliyuncs.com', apiKey: 'k', model: 'm', provider: 'dashscope' } })
  assert.equal(dashscope?.provider, 'dashscope')
  assert.throws(
    () => resolveImage({ image: { baseUrl: 'https://x', apiKey: 'k', model: 'm', provider: 'bogus' } }),
    /provider must be "openai" or "dashscope"/,
  )
})

test('keeps the plugin inert when nothing is configured', () => {
  const config: PluginConfig = { vision: undefined, image: undefined }
  assert.equal(resolveVision(config), undefined)
  assert.equal(resolveImage(config), undefined)
})

test('passes non-cred values through the credential seam unchanged', async () => {
  const ctx = new Context()
  assert.equal(await resolveApiKeyFromCredentials(ctx, 'plain-secret'), 'plain-secret')
  // env: expansion happens earlier in resolveVision (resolveApiKey); the
  // credential seam only handles cred:, so an env: value passes through here.
  assert.equal(await resolveApiKeyFromCredentials(ctx, 'env:SOME_VAR'), 'env:SOME_VAR')
})

test('resolves cred: values through the host credential service', async () => {
  const ctx = new Context()
  ctx.provide('credentials', {
    async resolve(ref: string): Promise<{ value: string; source: string } | undefined> {
      if (ref === credentialRef('DEEPSEEK_API_KEY')) return { value: 'cred-secret', source: 'env' }
      return undefined
    },
  })
  assert.equal(await resolveApiKeyFromCredentials(ctx, 'cred:DEEPSEEK_API_KEY'), 'cred-secret')
})

test('throws when cred: references a credential that is not configured', async () => {
  const ctx = new Context()
  ctx.provide('credentials', {
    async resolve(): Promise<{ value: string; source: string } | undefined> {
      return undefined
    },
  })
  await assert.rejects(
    () => resolveApiKeyFromCredentials(ctx, 'cred:DEEPSEEK_API_KEY'),
    /not configured/,
  )
})

test('throws when cred: is used but no credentials service is mounted', async () => {
  const ctx = new Context()
  await assert.rejects(
    () => resolveApiKeyFromCredentials(ctx, 'cred:DEEPSEEK_API_KEY'),
    /no credentials service is mounted/,
  )
})

test('resolveApiKeyRuntime combines env: and cred: resolution', async () => {
  const ctx = new Context()
  ctx.provide('credentials', {
    async resolve(ref: string): Promise<{ value: string; source: string } | undefined> {
      if (ref === credentialRef('DEEPSEEK_API_KEY')) return { value: 'cred-secret', source: 'env' }
      return undefined
    },
  })
  // literal passes through
  assert.equal(await resolveApiKeyRuntime(ctx, 'plain'), 'plain')
  // env: expands from process.env
  process.env.DSH_IMAGE_PLUGINS_TEST_KEY = 'env-secret'
  try {
    assert.equal(await resolveApiKeyRuntime(ctx, 'env:DSH_IMAGE_PLUGINS_TEST_KEY'), 'env-secret')
  } finally {
    delete process.env.DSH_IMAGE_PLUGINS_TEST_KEY
  }
  // cred: resolves through the host seam
  assert.equal(await resolveApiKeyRuntime(ctx, 'cred:DEEPSEEK_API_KEY'), 'cred-secret')
})
