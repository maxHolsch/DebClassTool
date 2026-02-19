import { DurableObjectSqliteSyncWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import { createTLSchema, defaultShapeSchemas, TLRecord } from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error, IRequest } from 'itty-router'
import { Environment } from '../environment'

const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas },
})

export class TldrawSyncDurableObject extends DurableObject<Environment> {
	private room: TLSocketRoom<TLRecord, void>

	constructor(ctx: DurableObjectState, env: Environment) {
		super(ctx, env)
		const sql = new DurableObjectSqliteSyncWrapper(ctx.storage)
		const storage = new SQLiteSyncStorage<TLRecord>({ sql })
		this.room = new TLSocketRoom<TLRecord, void>({ schema, storage })
	}

	private readonly router = AutoRouter({
		catch: (e) => {
			console.error('[sync-do] unhandled error', e)
			return error(e)
		},
	}).get('/connect/:roomId', (request) => this.handleConnect(request))

	override fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	private async handleConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')
		const roomId = request.params.roomId as string
		const storeId = request.query.storeId as string | undefined

		console.log('[sync-do] connect request', {
			roomId,
			sessionId,
			storeId,
			cfRay: request.headers.get('cf-ray'),
		})

		const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair()
		serverWebSocket.accept()
		serverWebSocket.addEventListener('close', (event) => {
			console.warn('[sync-do] server websocket close', {
				roomId,
				sessionId,
				storeId,
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			})
		})
		serverWebSocket.addEventListener('error', (_event) => {
			console.error('[sync-do] server websocket error', {
				roomId,
				sessionId,
				storeId,
			})
		})

		try {
			this.room.handleSocketConnect({ sessionId, socket: serverWebSocket })
		} catch (e) {
			console.error('[sync-do] handleSocketConnect failed', {
				roomId,
				sessionId,
				storeId,
				error: e instanceof Error ? e.message : String(e),
			})
			throw e
		}

		return new Response(null, { status: 101, webSocket: clientWebSocket })
	}
}
