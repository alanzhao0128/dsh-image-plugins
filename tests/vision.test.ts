/**
 * Unit tests for the OpenAI-compatible vision client.
 * @module dsh-image-plugins/tests/vision
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callVision } from '../src/vision.ts'
import { json, readJsonBody, withServer } from './helpers.ts'

const IMAGE_BYTES = new TextEncoder().encode('ABC')

test('sends a chat-completions request with a base64 image and returns the answer', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/chat/completions')
    assert.equal(req.headers.authorization, 'Bearer test-key')
    const body = await readJsonBody(req) as {
      model: string
      messages: { role: string; content: unknown[] }[]
    }
    assert.equal(body.model, 'vision-model')
    assert.equal(body.messages.length, 1)
    assert.equal(body.messages[0].role, 'user')
    const [text, image] = body.messages[0].content
    assert.equal((text as { type: string; text: string }).text, 'what is this?')
    const imageBlock = image as { type: string; image_url: { url: string } }
    assert.equal(imageBlock.type, 'image_url')
    assert.equal(imageBlock.image_url.url, `data:image/png;base64,${Buffer.from(IMAGE_BYTES).toString('base64')}`)
    json(res, 200, { choices: [{ message: { content: 'a red apple' } }] })
  }, async baseUrl => {
    const answer = await callVision(
      { baseUrl, apiKey: 'test-key', model: 'vision-model', timeoutMs: 5_000 },
      'what is this?',
      { mediaType: 'image/png', data: IMAGE_BYTES },
    )
    assert.equal(answer, 'a red apple')
  })
})

test('sends the configured system prompt before the user content', async () => {
  let seenSystem = false
  await withServer(async (req, res) => {
    const body = await readJsonBody(req) as { messages: { role: string; content: string }[] }
    seenSystem = body.messages[0]?.role === 'system' && body.messages[0]?.content === 'you are a chart reader'
    json(res, 200, { choices: [{ message: { content: 'ok' } }] })
  }, async baseUrl => {
    await callVision(
      { baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000, systemPrompt: 'you are a chart reader' },
      'hi',
      { mediaType: 'image/png', data: IMAGE_BYTES },
    )
    assert.equal(seenSystem, true)
  })
})

test('joins text parts when the answer is a content array', async () => {
  await withServer(async (_req, res) => {
    json(res, 200, {
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'one ' },
            { type: 'text', text: 'two' },
          ],
        },
      }],
    })
  }, async baseUrl => {
    const answer = await callVision(
      { baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000 },
      'hi',
      { mediaType: 'image/png', data: IMAGE_BYTES },
    )
    assert.equal(answer, 'one two')
  })
})

test('throws with the HTTP status and a body excerpt on endpoint errors', async () => {
  await withServer(async (_req, res) => {
    json(res, 401, { error: { message: 'invalid api key' } })
  }, async baseUrl => {
    await assert.rejects(
      callVision({ baseUrl, apiKey: 'bad', model: 'm', timeoutMs: 5_000 }, 'hi', { mediaType: 'image/png', data: IMAGE_BYTES }),
      /HTTP 401.*invalid api key/,
    )
  })
})

test('throws when the endpoint returns no text content', async () => {
  await withServer(async (_req, res) => {
    json(res, 200, { choices: [{ message: { content: '' } }] })
  }, async baseUrl => {
    await assert.rejects(
      callVision({ baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000 }, 'hi', { mediaType: 'image/png', data: IMAGE_BYTES }),
      /no text content/,
    )
  })
})

test('aborts when the endpoint is too slow', async () => {
  await withServer((_req, _res) => {
    // Never respond; the client timeout must abort.
  }, async baseUrl => {
    await assert.rejects(
      callVision({ baseUrl, apiKey: 'k', model: 'm', timeoutMs: 150 }, 'hi', { mediaType: 'image/png', data: IMAGE_BYTES }),
      /abort|timeout/i,
    )
  })
})

test('throws before any request when the apiKey is empty', async () => {
  await assert.rejects(
    callVision({ baseUrl: 'http://127.0.0.1:1', apiKey: '', model: 'm', timeoutMs: 5_000 }, 'hi', { mediaType: 'image/png', data: IMAGE_BYTES }),
    /apiKey is not configured/,
  )
})
