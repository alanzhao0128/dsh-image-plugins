/**
 * Unit tests for the OpenAI-compatible image-generation client.
 * @module dsh-image-plugins/tests/image-gen
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callImageGen, dashscopeRoot, dashscopeSize, formatFromUrl } from '../src/image-gen.ts'
import { slugify } from '../src/tools/generate-image.ts'
import { json, readJsonBody, withServer } from './helpers.ts'

const PNG_BYTES = new TextEncoder().encode('PNGDATA')
const WEBP_BYTES = new TextEncoder().encode('WEBPDATA')

test('decodes a b64_json response item', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/images/generations')
    assert.equal(req.headers.authorization, 'Bearer test-key')
    const body = await readJsonBody(req) as { model: string; prompt: string; size: string; n: number }
    assert.equal(body.model, 'image-model')
    assert.equal(body.prompt, 'a red apple')
    assert.equal(body.size, '1024x1024')
    assert.equal(body.n, 1)
    json(res, 200, { data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }] })
  }, async baseUrl => {
    const result = await callImageGen(
      { baseUrl, apiKey: 'test-key', model: 'image-model', timeoutMs: 5_000, size: '1024x1024' },
      'a red apple',
    )
    assert.deepEqual(result.data, PNG_BYTES)
    assert.equal(result.format, 'png')
  })
})

test('downloads a url response item', async () => {
  await withServer((req, res) => {
    if (req.url === '/images/generations') {
      void readJsonBody(req).then(() => {
        json(res, 200, { data: [{ url: `http://127.0.0.1:${(req.socket.localPort ?? 0)}/out.webp` }] })
      })
      return
    }
    if (req.url === '/out.webp') {
      res.writeHead(200, { 'content-type': 'image/webp' })
      res.end(WEBP_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  }, async baseUrl => {
    const result = await callImageGen(
      { baseUrl, apiKey: 'test-key', model: 'image-model', timeoutMs: 5_000 },
      'a red apple',
    )
    assert.deepEqual(result.data, WEBP_BYTES)
    assert.equal(result.format, 'webp')
  })
})

test('falls back to an unauthenticated download when the authorized one is forbidden', async () => {
  let downloadAttempts = 0
  await withServer((req, res) => {
    if (req.url === '/images/generations') {
      void readJsonBody(req).then(() => {
        json(res, 200, { data: [{ url: `http://127.0.0.1:${(req.socket.localPort ?? 0)}/out.png` }] })
      })
      return
    }
    if (req.url === '/out.png') {
      downloadAttempts += 1
      if (downloadAttempts === 1) {
        res.writeHead(403)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  }, async baseUrl => {
    const result = await callImageGen(
      { baseUrl, apiKey: 'test-key', model: 'image-model', timeoutMs: 5_000 },
      'a red apple',
    )
    assert.deepEqual(result.data, PNG_BYTES)
    assert.equal(downloadAttempts, 2)
  })
})

test('throws when the endpoint returns no data items', async () => {
  await withServer(async (_req, res) => {
    json(res, 200, { data: [] })
  }, async baseUrl => {
    await assert.rejects(
      callImageGen({ baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000 }, 'a red apple'),
      /no data items/,
    )
  })
})

test('throws with the HTTP status on endpoint errors', async () => {
  await withServer(async (_req, res) => {
    json(res, 500, { error: { message: 'quota exceeded' } })
  }, async baseUrl => {
    await assert.rejects(
      callImageGen({ baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000 }, 'a red apple'),
      /HTTP 500.*quota exceeded/,
    )
  })
})

test('throws before any request when the apiKey is empty', async () => {
  await assert.rejects(
    callImageGen({ baseUrl: 'http://127.0.0.1:1', apiKey: '', model: 'm', timeoutMs: 5_000 }, 'a red apple'),
    /apiKey is not configured/,
  )
})

test('derives a format label from the download URL', () => {
  assert.equal(formatFromUrl('https://cdn.example.com/x/out.webp?v=2'), 'webp')
  assert.equal(formatFromUrl('https://cdn.example.com/out.JPEG'), 'jpg')
  assert.equal(formatFromUrl('https://cdn.example.com/out'), 'png')
})

test('slugifies prompts into filesystem-safe names', () => {
  assert.equal(slugify('A Red Apple 3!'), 'a-red-apple-3')
  assert.equal(slugify('!!!'), 'image')
  assert.equal(slugify('x'.repeat(100)).length <= 40, true)
})

// ---- DashScope native flavor ----

test('normalizes DashScope base urls to the native root', () => {
  assert.equal(dashscopeRoot('https://dashscope.aliyuncs.com'), 'https://dashscope.aliyuncs.com')
  assert.equal(dashscopeRoot('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com')
  assert.equal(dashscopeRoot('https://dashscope.aliyuncs.com/v1/'), 'https://dashscope.aliyuncs.com')
})

test('converts OpenAI-style sizes to the DashScope asterisk form', () => {
  assert.equal(dashscopeSize('1024x1024'), '1024*1024')
  assert.equal(dashscopeSize('1024*1024'), '1024*1024')
  assert.equal(dashscopeSize(undefined), undefined)
  assert.equal(dashscopeSize(''), undefined)
})

test('calls the native multimodal-generation endpoint and downloads the image url', async () => {
  await withServer((req, res) => {
    if (req.url === '/api/v1/services/aigc/multimodal-generation/generation') {
      void readJsonBody(req).then(body => {
        const b = body as {
          model: string
          input: { messages: { role: string; content: { text: string }[] }[] }
          parameters: { n: number; prompt_extend: boolean; size: string }
        }
        assert.equal(b.model, 'qwen-image-3.0-pro')
        assert.equal(b.input.messages.length, 1)
        assert.equal(b.input.messages[0]?.role, 'user')
        assert.equal(b.input.messages[0]?.content[0]?.text, 'a red apple')
        assert.equal(b.parameters.n, 1)
        assert.equal(b.parameters.prompt_extend, true)
        assert.equal(b.parameters.size, '512*512')
        json(res, 200, {
          output: {
            choices: [{
              finish_reason: 'stop',
              message: { role: 'assistant', content: [{ image: `http://127.0.0.1:${(req.socket.localPort ?? 0)}/out.png` }] },
            }],
          },
        })
      })
      return
    }
    if (req.url === '/out.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  }, async baseUrl => {
    const result = await callImageGen(
      {
        baseUrl,
        apiKey: 'test-key',
        model: 'qwen-image-3.0-pro',
        timeoutMs: 5_000,
        size: '512x512',
        provider: 'dashscope',
      },
      'a red apple',
    )
    assert.deepEqual(result.data, PNG_BYTES)
    assert.equal(result.format, 'png')
  })
})

test('accepts a compatible-mode base url for the dashscope flavor', async () => {
  let seenUrl = ''
  await withServer((req, res) => {
    if (req.url?.includes('/api/v1/services/aigc/multimodal-generation/generation')) {
      seenUrl = req.url
      json(res, 200, {
        output: { choices: [{ message: { content: [{ image: `http://127.0.0.1:${(req.socket.localPort ?? 0)}/out.png` }] } }] },
      })
      return
    }
    if (req.url === '/out.png') {
      res.writeHead(200)
      res.end(PNG_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  }, async baseUrl => {
    // The mock serves everything under one origin, so append the compatible path.
    const result = await callImageGen(
      {
        baseUrl: `${baseUrl}/compatible-mode/v1`,
        apiKey: 'k',
        model: 'qwen-image-3.0-pro',
        timeoutMs: 5_000,
        provider: 'dashscope',
      },
      'a red apple',
    )
    assert.equal(seenUrl, '/api/v1/services/aigc/multimodal-generation/generation')
    assert.deepEqual(result.data, PNG_BYTES)
  })
})

test('maps DashScope error bodies into the thrown message', async () => {
  await withServer(async (_req, res) => {
    json(res, 400, { code: 'InvalidParameter', message: 'size out of range', request_id: 'r1' })
  }, async baseUrl => {
    await assert.rejects(
      callImageGen(
        { baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000, provider: 'dashscope' },
        'a red apple',
      ),
      /DashScope HTTP 400 InvalidParameter.*size out of range/,
    )
  })
})

test('throws when the DashScope response carries no image url', async () => {
  await withServer(async (_req, res) => {
    json(res, 200, { output: { choices: [{ message: { content: [{ text: 'sorry' }] } }] } })
  }, async baseUrl => {
    await assert.rejects(
      callImageGen(
        { baseUrl, apiKey: 'k', model: 'm', timeoutMs: 5_000, provider: 'dashscope' },
        'a red apple',
      ),
      /no image url/,
    )
  })
})

test('sends reference images as base64 content for I2I', async () => {
  await withServer((req, res) => {
    if (req.url?.includes('/api/v1/services/aigc/multimodal-generation/generation')) {
      void readJsonBody(req).then(body => {
        const b = body as {
          input: { messages: { content: { image?: string; text?: string }[] }[] }
        }
        const content = b.input.messages[0]?.content ?? []
        assert.equal(content.length, 2)
        assert.equal(content[0]?.image, `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`)
        assert.equal(content[1]?.text, 'make the apple green')
        json(res, 200, {
          output: { choices: [{ message: { content: [{ image: `http://127.0.0.1:${(req.socket.localPort ?? 0)}/out.png` }] } }] },
        })
      })
      return
    }
    if (req.url === '/out.png') {
      res.writeHead(200)
      res.end(PNG_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  }, async baseUrl => {
    const result = await callImageGen(
      {
        baseUrl,
        apiKey: 'k',
        model: 'qwen-image-3.0-pro',
        timeoutMs: 5_000,
        provider: 'dashscope',
        referenceImages: [{ mediaType: 'image/png', data: PNG_BYTES, name: 'ref.png' }],
      },
      'make the apple green',
    )
    assert.deepEqual(result.data, PNG_BYTES)
  })
})

test('rejects reference images on the openai flavor', async () => {
  await assert.rejects(
    callImageGen(
      { baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: 'm', timeoutMs: 5_000, referenceImages: [{ mediaType: 'image/png', data: PNG_BYTES }] },
      'a red apple',
    ),
    /reference images require provider "dashscope"/,
  )
})
