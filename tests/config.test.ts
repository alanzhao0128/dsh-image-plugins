/**
 * Unit tests for capability-block normalization at plugin load.
 * @module dsh-image-plugins/tests/config
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveImage, resolveVision } from '../src/index.ts'
import { resolveApiKeyFromCredentials, resolveApiKeyRuntime } from '../src/config.ts'
import type { PluginConfig } from '../src/config.ts'

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
