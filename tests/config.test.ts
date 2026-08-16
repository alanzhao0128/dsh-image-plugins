/**
 * Unit tests for capability-block normalization at plugin load.
 * @module dsh-image-plugins/tests/config
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveImage, resolveVision } from '../src/index.ts'
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
