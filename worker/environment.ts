export interface Environment {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	SYNC_DURABLE_OBJECT: DurableObjectNamespace
	WORKSPACE_STATE_DURABLE_OBJECT: DurableObjectNamespace
	ASSETS_BUCKET: R2Bucket
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string
	ASSEMBLYAI_API_KEY: string
}
