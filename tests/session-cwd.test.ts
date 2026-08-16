/**
 * Unit tests for session-cwd derivation.
 * @module dsh-image-plugins/tests/session-cwd
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionCwd, sessionResolveOptions } from '../src/session-cwd.ts'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

function execWith(cwd: string | undefined): ToolExecution {
  return {
    signal: new AbortController().signal,
    agent: {
      session: {
        header: { cwd },
      },
    },
  } as unknown as ToolExecution
}

test('derives the session cwd from the agent header', () => {
  assert.equal(sessionCwd(execWith('/Users/alan/code/dsh-test')), '/Users/alan/code/dsh-test')
})

test('returns undefined when no session cwd exists', () => {
  assert.equal(sessionCwd(execWith(undefined)), undefined)
})

test('builds resolution options with cwd and signal', () => {
  const exec = execWith('/workspace')
  const options = sessionResolveOptions(exec, exec.signal)
  assert.equal(options.cwd, '/workspace')
  assert.equal(options.signal, exec.signal)
})

test('omits cwd when none applies', () => {
  const exec = execWith(undefined)
  const options = sessionResolveOptions(exec, exec.signal)
  assert.equal('cwd' in options, false)
  assert.equal(options.signal, exec.signal)
})
