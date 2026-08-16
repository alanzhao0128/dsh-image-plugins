/**
 * Shared test helpers: an ephemeral HTTP server and JSON body utilities.
 * @module dsh-image-plugins/tests/helpers
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Run a callback against an ephemeral HTTP server on 127.0.0.1. */
export async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error === undefined ? resolve() : reject(error)))
    })
  }
}

/** Collect and JSON-parse a request body. */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += String(chunk) })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data) as unknown)
      } catch (error: unknown) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Write a JSON response. */
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
