/**
 * Regression tests for the browser half (client/client.js):
 * - Evaluates as a classic-script under ModuleLoader.
 * - Does NOT include 'settingsScope' in static inject array (prevents 0.1.7 hang).
 * - Correctly resolves scope from configForms in dsh >= 0.1.7.
 * - Correctly resolves scope from settingsScope in dsh <= 0.1.5.
 * - Registers settings.section slot.
 * @module dsh-image-plugins/tests/client
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const CLIENT_SOURCE = join(PROJECT_ROOT, 'client', 'client.js')

interface ModuleLoaderEntry { id: string; factory: (require: (name: string) => unknown) => unknown }
interface SlotEntry { name: string; id: string; order?: number; component: unknown }

function loadClient(): ModuleLoaderEntry {
  let registered: ModuleLoaderEntry | null = null
  ;(globalThis as Record<string, unknown>).window = {
    __ModuleLoader__: { load: (entry: ModuleLoaderEntry) => { registered = entry } },
  }
  const src = readFileSync(CLIENT_SOURCE, 'utf8')
  // eslint-disable-next-line no-eval
  ;(0, eval)(src)
  assert.ok(registered, 'client.js must register a module-loader entry')
  return registered!
}

const reactStub = {
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: unknown) => fn,
  useState: (v: unknown) => [v, () => {}],
}
const jsxStub = { jsx: (_t: unknown, p: unknown) => ({ p }), jsxs: (_t: unknown, p: unknown) => ({ p }) }
const fakeRequire = (name: string): unknown => {
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime') return jsxStub
  throw new Error('unexpected require: ' + name)
}

test('client.js inject array omits settingsScope and preserves standard services', () => {
  const { factory } = loadClient()
  const plugin = factory(fakeRequire) as { apply: (ctx: unknown) => void; inject: string[] }
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(!plugin.inject.includes('settingsScope'), 'settingsScope must be removed from inject to avoid 0.1.7 hang')
  assert.ok(plugin.inject.includes('connection'))
  assert.ok(plugin.inject.includes('slots'))
  assert.ok(plugin.inject.includes('locale'))
})

test('client.js resolves scope from configForms in dsh >= 0.1.7', () => {
  const { factory } = loadClient()
  const plugin = factory(fakeRequire) as { apply: (ctx: unknown) => void; inject: string[] }
  const entries: SlotEntry[] = []
  let requestedId = ''
  const fakeScope = {
    getSnapshot: () => ({ status: 'ready', value: {}, revision: 1, writable: true }),
    subscribe: () => () => {},
    mutate: async () => true,
  }

  const fakeCtx = {
    get: (name: string) => {
      if (name === 'connection') return { rpc: { call: async () => ({ ok: true }) } }
      if (name === 'remote') return { credentials: { set: async () => ({ ok: true }) } }
      if (name === 'configForms') return {
        get: (id: string) => {
          requestedId = id
          return fakeScope
        },
      }
      return null
    },
    effect: (_fn: () => unknown) => {},
    locale: { register: () => {} },
    slots: {
      inject: (_name: string, fn: () => unknown) => { entries.push(fn() as SlotEntry) },
      register: (opts: SlotEntry, component: unknown) => ({ ...opts, component }),
    },
  }

  plugin.apply(fakeCtx)
  assert.equal(requestedId, 'image-plugins', 'should resolve scope from configForms with image-plugins id')
  const section = entries.find(e => e.name === 'settings.section')
  assert.ok(section, 'settings.section slot must be registered')
  assert.equal(section!.id, 'image-plugins')
})

test('client.js resolves scope from settingsScope in dsh <= 0.1.5', () => {
  const { factory } = loadClient()
  const plugin = factory(fakeRequire) as { apply: (ctx: unknown) => void; inject: string[] }
  const entries: SlotEntry[] = []
  let boundNamespace = ''
  const fakeScope = {
    getSnapshot: () => ({ status: 'ready', value: {}, revision: 1, writable: true }),
    subscribe: () => () => {},
    mutate: async () => true,
  }

  const fakeCtx = {
    get: (name: string) => {
      if (name === 'connection') return { rpc: { call: async () => ({ ok: true }) } }
      if (name === 'remote') return { credentials: { set: async () => ({ ok: true }) } }
      if (name === 'settingsScope') return {
        bind: (opts: { namespace: string }) => {
          boundNamespace = opts.namespace
          return fakeScope
        },
      }
      return null
    },
    effect: (_fn: () => unknown) => {},
    locale: { register: () => {} },
    slots: {
      inject: (_name: string, fn: () => unknown) => { entries.push(fn() as SlotEntry) },
      register: (opts: SlotEntry, component: unknown) => ({ ...opts, component }),
    },
  }

  plugin.apply(fakeCtx)
  assert.equal(boundNamespace, 'dsh-image-plugins', 'should bind settingsScope with dsh-image-plugins namespace')
  const section = entries.find(e => e.name === 'settings.section')
  assert.ok(section, 'settings.section slot must be registered')
  assert.equal(section!.id, 'image-plugins')
})
