/**
 * Unit tests for the `/api` shared-channel Fetch route helper (rpcRoute):
 * the classic client-request envelope round-trip plus the official error
 * branches (404 non-POST, 415 wrong content-type, 400 bad body/envelope,
 * 500 handler failure).
 * @module dsh-image-plugins/tests/rpc-route
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rpcRoute } from '../src/index.ts'

const ENDPOINT = 'image-plugin-status/snapshot'

function makeRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1/api/${ENDPOINT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
}

test('round-trips a client-request envelope through the handler', async () => {
  const route = rpcRoute(ENDPOINT, async (endpoint, payload) => {
    assert.equal(endpoint, ENDPOINT)
    return { ok: true, value: { echo: payload } }
  })
  const response = await route.fetch(makeRequest({
    type: 'client-request',
    rpcId: 'abc',
    method: ENDPOINT,
    payload: { hello: 'world' },
  }))
  assert.equal(response.status, 200)
  const body = await response.json() as { type: string; rpcId: string; result: { ok: boolean; value: unknown } }
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, 'abc')
  assert.equal(body.result.ok, true)
  assert.deepEqual(body.result.value, { echo: { hello: 'world' } })
})

test('rejects non-POST with 404', async () => {
  const route = rpcRoute(ENDPOINT, async () => ({ ok: true, value: null }))
  const response = await route.fetch(new Request(`http://127.0.0.1/api/${ENDPOINT}`, { method: 'GET' }))
  assert.equal(response.status, 404)
})

test('rejects a wrong content-type with 415', async () => {
  const route = rpcRoute(ENDPOINT, async () => ({ ok: true, value: null }))
  const response = await route.fetch(new Request(`http://127.0.0.1/api/${ENDPOINT}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'nope',
  }))
  assert.equal(response.status, 415)
})

test('rejects an unparseable body with 400', async () => {
  const route = rpcRoute(ENDPOINT, async () => ({ ok: true, value: null }))
  const response = await route.fetch(new Request(`http://127.0.0.1/api/${ENDPOINT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json at all',
  }))
  assert.equal(response.status, 400)
})

test('rejects an invalid envelope with 400', async () => {
  const route = rpcRoute(ENDPOINT, async () => ({ ok: true, value: null }))
  // Missing type; wrong method.
  const badType = await route.fetch(makeRequest({ rpcId: 'x', method: ENDPOINT, payload: {} }))
  assert.equal(badType.status, 400)
  const wrongMethod = await route.fetch(makeRequest({ type: 'client-request', rpcId: 'x', method: 'other/snapshot', payload: {} }))
  assert.equal(wrongMethod.status, 400)
})

test('maps a handler failure to 500', async () => {
  const route = rpcRoute(ENDPOINT, async () => {
    throw new Error('boom')
  })
  const response = await route.fetch(makeRequest({
    type: 'client-request',
    rpcId: 'e',
    method: ENDPOINT,
    payload: {},
  }))
  assert.equal(response.status, 500)
  const text = await response.text()
  assert.ok(text.includes('handler failure: Error: boom'))
})

test('exposes the expected route shape for connection.fetch.register', () => {
  const route = rpcRoute(ENDPOINT, async () => ({ ok: true, value: null }))
  assert.equal(route.path, `/api/${ENDPOINT}`)
  assert.deepEqual(route.methods, ['POST'])
  assert.equal(route.requestBody, 'buffered')
  assert.equal(typeof route.fetch, 'function')
})
