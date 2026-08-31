import { DurableObject } from 'cloudflare:workers'

const SESSION_REPLACED_CLOSE_CODE = 4001

/** One instance per account, used only to hold live browser connections. */
export class SessionNotifier extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async invalidate(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ type: 'session-replaced' }))
        socket.close(SESSION_REPLACED_CLOSE_CODE, 'SESSION_REPLACED')
      } catch (error) {
        console.warn('Unable to close replaced session connection', error)
      }
    }
  }
}
