import { IRequest } from 'itty-router'
import { Environment } from '../environment'

const DEFAULT_TOKEN_DURATION_SECONDS = 600

export async function assemblyAiToken(_request: IRequest, env: Environment) {
	if (!env.ASSEMBLYAI_API_KEY) {
		return Response.json({ error: 'AssemblyAI key is not configured.' }, { status: 500 })
	}

	const tokenResponse = await fetch(
		`https://streaming.assemblyai.com/v3/token?expires_in_seconds=${DEFAULT_TOKEN_DURATION_SECONDS}`,
		{
			method: 'GET',
			headers: {
				Authorization: env.ASSEMBLYAI_API_KEY,
			},
		}
	)

	if (!tokenResponse.ok) {
		const body = await tokenResponse.text()
		console.error('AssemblyAI token request failed:', tokenResponse.status, body)
		return Response.json({ error: 'Failed to get AssemblyAI token.' }, { status: 502 })
	}

	const data = await tokenResponse.json<{ token?: string; error?: string }>()
	if (!data.token) {
		return Response.json({ error: data.error ?? 'AssemblyAI token was empty.' }, { status: 502 })
	}

	return Response.json({
		token: data.token,
		expiresInSeconds: DEFAULT_TOKEN_DURATION_SECONDS,
	})
}
