/**
 * Unit tests for the pre-step message rewriting logic.
 * @module dsh-image-plugins/tests/pre-step
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteImageMessages } from '../src/pre-step.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

function ref(id: string, name?: string): ImageAttachmentRef {
  return {
    attachmentId: id as never,
    mediaType: 'image/png',
    bytes: 4,
    width: 2,
    height: 2,
    ...(name === undefined ? {} : { name }),
  }
}

function message(blocks: unknown[]): UserMessage {
  return { id: `msg-${blocks.length}` as never, content: blocks as never, source: { kind: 'user' } as never }
}

test('replaces image blocks with description text and keeps other blocks in order', async () => {
  const original = message([
    { type: 'text', text: 'look at this:' },
    { type: 'image', attachment: ref('att-1', 'cat.png') },
  ])
  const described: string[] = []
  const rewritten = await rewriteImageMessages(
    [original],
    async (attachmentRef, signal) => {
      described.push(String(attachmentRef.attachmentId))
      assert.ok(signal instanceof AbortSignal)
      return 'a red apple'
    },
    new AbortController().signal,
  )
  assert.equal(rewritten.length, 1)
  assert.notEqual(rewritten[0], original, 'the message is replaced, not mutated')
  const blocks = rewritten[0]!.content
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], { type: 'text', text: 'look at this:' })
  assert.equal((blocks[1] as { type: string; text: string }).type, 'text')
  assert.match((blocks[1] as { type: string; text: string }).text, /cat\.png.*a red apple/)
  assert.deepEqual(described, ['att-1'])
})

test('describes each image in a multi-image message once', async () => {
  const original = message([
    { type: 'image', attachment: ref('att-1', 'a.png') },
    { type: 'text', text: 'and' },
    { type: 'image', attachment: ref('att-2', 'b.png') },
  ])
  const rewritten = await rewriteImageMessages(
    [original],
    async attachmentRef => `desc-${String(attachmentRef.attachmentId)}`,
    new AbortController().signal,
  )
  const texts = rewritten[0]!.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
  assert.equal(texts.length, 3)
  assert.match(texts[0]!, /desc-att-1/)
  assert.equal(texts[1], 'and')
  assert.match(texts[2]!, /desc-att-2/)
})

test('passes messages without images through unchanged', async () => {
  const original = message([{ type: 'text', text: 'plain question' }])
  const rewritten = await rewriteImageMessages(
    [original],
    async () => 'unused',
    new AbortController().signal,
  )
  assert.equal(rewritten.length, 1)
  assert.equal(rewritten[0], original, 'the same object reference is returned')
})

test('uses a deterministic placeholder when describing fails', async () => {
  const original = message([{ type: 'image', attachment: ref('att-1', 'broken.png') }])
  const rewritten = await rewriteImageMessages(
    [original],
    async () => { throw new Error('network down') },
    new AbortController().signal,
  )
  const block = rewritten[0]!.content[0] as { type: string; text: string }
  assert.match(block.text, /could not be described/)
  assert.match(block.text, /network down/)
  assert.match(block.text, /understand_image/)
})

test('keeps non-image messages alongside rewritten ones', async () => {
  const withImage = message([{ type: 'image', attachment: ref('att-1') }])
  const plain = message([{ type: 'text', text: 'also answer this' }])
  const rewritten = await rewriteImageMessages(
    [withImage, plain],
    async () => 'described',
    new AbortController().signal,
  )
  assert.equal(rewritten.length, 2)
  assert.equal(rewritten[1], plain)
})
