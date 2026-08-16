/**
 * Session working-directory derivation for filesystem tools, mirroring the
 * official `dsh-tool-fs` helper: relative paths resolve against the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`) so each
 * session's tools act on ITS workspace, never the server's launch directory.
 * @module dsh-image-plugins/src/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * The session workspace cwd for this call, or `undefined` when none applies
 * (the backend then applies its own default).
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}

/** Resolution options for one fs call: session cwd plus the call's signal. */
export function sessionResolveOptions(
  exec: ToolExecution,
  signal: AbortSignal | undefined,
): { cwd?: string; signal?: AbortSignal } {
  return {
    ...sessionCwd(exec) === undefined ? {} : { cwd: sessionCwd(exec) },
    signal,
  }
}
