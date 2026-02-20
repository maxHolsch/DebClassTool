import { ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AutoRouter, cors, error, IRequest } from 'itty-router'
import { Environment } from './environment'
import { assemblyAiToken } from './routes/assemblyAiToken'
import { stream } from './routes/stream'

const { preflight, corsify } = cors({ origin: '*' })

const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	before: [preflight],
	finally: [corsify],
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	.post('/stream', stream)
	.get('/assemblyai/token', assemblyAiToken)
	.get('/workspace/:scope', async (request, env) => {
		const scope = request.params.scope ?? 'default'
		const id = env.WORKSPACE_STATE_DURABLE_OBJECT.idFromName(scope)
		const workspace = env.WORKSPACE_STATE_DURABLE_OBJECT.get(id)
		return workspace.fetch('https://workspace.internal/state', {
			method: 'GET',
		})
	})
	.put('/workspace/:scope', async (request, env) => {
		const scope = request.params.scope ?? 'default'
		const id = env.WORKSPACE_STATE_DURABLE_OBJECT.idFromName(scope)
		const workspace = env.WORKSPACE_STATE_DURABLE_OBJECT.get(id)
		const body = await (request as unknown as Request).arrayBuffer()
		const headers = new Headers()
		const contentType = (request as unknown as Request).headers.get('content-type')
		if (contentType) headers.set('content-type', contentType)
		return workspace.fetch('https://workspace.internal/state', {
			method: 'PUT',
			headers,
			body,
		})
	})
	.post('/assets/:uploadId', async (request, env) => {
		const key = request.params.uploadId
		const body = await (request as unknown as Request).arrayBuffer()
		await env.ASSETS_BUCKET.put(key, body, {
			httpMetadata: {
				contentType: (request as unknown as Request).headers.get('content-type') || 'application/octet-stream',
			},
		})
		return new Response(JSON.stringify({ ok: true }), {
			headers: { 'Content-Type': 'application/json' },
		})
	})
	.get('/assets/:key', async (request, env) => {
		const key = request.params.key
		const object = await env.ASSETS_BUCKET.get(key)
		if (!object) return new Response('Not found', { status: 404 })
		return new Response(object.body as ReadableStream, {
			headers: {
				'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		})
	})

export default class extends WorkerEntrypoint<Environment> {
	override fetch(request: Request): Promise<Response> {
		// Handle WebSocket upgrades outside the CORS router —
		// corsify would corrupt the 101 upgrade response
		const url = new URL(request.url)
		const match = url.pathname.match(/^\/connect\/(.+)$/)
		if (match && request.headers.get('upgrade') === 'websocket') {
			const roomId = match[1]
			const sessionId = url.searchParams.get('sessionId')
			const storeId = url.searchParams.get('storeId')
			console.log('[sync] websocket upgrade request', {
				roomId,
				sessionId,
				storeId,
				cfRay: request.headers.get('cf-ray'),
			})
			const id = this.env.SYNC_DURABLE_OBJECT.idFromName(roomId)
			const room = this.env.SYNC_DURABLE_OBJECT.get(id)
			return room.fetch(request.url, { headers: request.headers }) as Promise<Response>
		}

		return router.fetch(request, this.env, this.ctx)
	}
}

// Make the durable objects available to the cloudflare worker
export { AgentDurableObject } from './do/AgentDurableObject'
export { TldrawSyncDurableObject } from './do/TldrawSyncDurableObject'
export { WorkspaceStateDurableObject } from './do/WorkspaceStateDurableObject'
