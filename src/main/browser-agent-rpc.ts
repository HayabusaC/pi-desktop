import { createServer, type Server } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import type { BrowserService } from './browser-service'
import { isBrowserAgentAction } from '../shared/browser-agent-action'

const MAX_BODY_BYTES = 256 * 1024

function authorized(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith('Bearer ')) return false
  const token = Buffer.from(actual.slice(7))
  const wanted = Buffer.from(expected)
  return token.length === wanted.length && timingSafeEqual(token, wanted)
}

/** Loopback-only authenticated bridge used by the bundled agent extension. */
export class BrowserAgentRpcServer {
  private server: Server | null = null
  readonly token = randomBytes(32).toString('base64url')
  url: string | null = null

  constructor(private readonly browser: BrowserService) {}

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      if (request.method !== 'POST' || request.url !== '/browser' || !authorized(request.headers.authorization, this.token)) {
        response.statusCode = 404
        response.end(JSON.stringify({ error: 'Not found' }))
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) tooLarge = true
        else if (!tooLarge) chunks.push(chunk)
      })
      request.on('end', () => {
        if (tooLarge) {
          response.statusCode = 413
          response.end(JSON.stringify({ error: 'Browser RPC request too large' }))
          return
        }
        void (async () => {
          try {
            const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!isBrowserAgentAction(payload)) throw new Error('Invalid browser action')
            const result = await this.browser.dispatchAgentAction(payload)
            response.end(JSON.stringify({ result }))
          } catch (error) {
            response.statusCode = 400
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          }
        })()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Browser RPC failed to bind')
    this.server = server
    this.url = `http://127.0.0.1:${address.port}/browser`
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.url = null
  }
}
