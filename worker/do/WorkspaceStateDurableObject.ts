import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error, IRequest } from 'itty-router'
import { Environment } from '../environment'

interface ReadingDocument {
	id: string
	title: string
	content: string
	createdAt: number
}

interface WorkspaceFolder {
	id: string
	name: string
	parentId: string | null
	createdAt: number
}

type WorkspaceFileType = 'canvas' | 'reading'

interface WorkspaceFile {
	id: string
	name: string
	parentId: string | null
	type: WorkspaceFileType
	createdAt: number
	canvasKey: string
	readingId?: string
}

interface WorkspaceState {
	folders: WorkspaceFolder[]
	files: WorkspaceFile[]
}

interface WorkspaceSnapshot {
	workspace: WorkspaceState
	readings: ReadingDocument[]
	revision: number
	updatedAt: number
}

const STORAGE_KEY = 'workspace-snapshot'
const DEFAULT_CORE_FOLDER_ID = 'core-workspaces'
const DEFAULT_READINGS_FOLDER_ID = 'readings'
const DEFAULT_SKETCHES_FOLDER_ID = 'sketches'
const MAX_READING_CHARS = 18000

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const next = value.trim()
	return next ? next : null
}

function asOptionalParentId(value: unknown): string | null {
	if (value === null || value === undefined) return null
	return asString(value)
}

function asTimestamp(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return Date.now()
	}
	return value
}

function createDefaultWorkspaceState(timestamp = Date.now()): WorkspaceState {
	return {
		folders: [
			{
				id: DEFAULT_CORE_FOLDER_ID,
				name: 'Core Workspaces',
				parentId: null,
				createdAt: timestamp,
			},
			{
				id: DEFAULT_READINGS_FOLDER_ID,
				name: 'Readings',
				parentId: null,
				createdAt: timestamp,
			},
			{
				id: DEFAULT_SKETCHES_FOLDER_ID,
				name: 'Sketches',
				parentId: null,
				createdAt: timestamp,
			},
		],
		files: [
			{
				id: 'weekly-prep',
				name: 'Weekly Prep',
				parentId: DEFAULT_CORE_FOLDER_ID,
				type: 'canvas',
				createdAt: timestamp,
				canvasKey: 'deliberatorium-weekly-prep',
			},
			{
				id: 'question-space',
				name: 'Question Space',
				parentId: DEFAULT_CORE_FOLDER_ID,
				type: 'canvas',
				createdAt: timestamp,
				canvasKey: 'deliberatorium-question-space',
			},
		],
	}
}

function normalizeReadingsValue(input: unknown): ReadingDocument[] {
	if (!Array.isArray(input)) return []
	const readingMap = new Map<string, ReadingDocument>()

	for (const item of input) {
		if (!isRecord(item)) continue
		const id = asString(item.id)
		const title = asString(item.title)
		if (!id || !title) continue
		const contentValue = typeof item.content === 'string' ? item.content : ''
		const content = contentValue.replace(/\s+/g, ' ').trim().slice(0, MAX_READING_CHARS)
		readingMap.set(id, {
			id,
			title,
			content,
			createdAt: asTimestamp(item.createdAt),
		})
	}

	return Array.from(readingMap.values()).sort((a, b) => {
		if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
		return a.title.localeCompare(b.title)
	})
}

function normalizeWorkspaceValue(input: unknown): WorkspaceState {
	const fallback = createDefaultWorkspaceState()
	if (!isRecord(input)) return fallback
	const rawFolders = Array.isArray(input.folders) ? input.folders : []
	const rawFiles = Array.isArray(input.files) ? input.files : []
	const folderMap = new Map<string, WorkspaceFolder>()
	const fileMap = new Map<string, WorkspaceFile>()

	for (const folder of rawFolders) {
		if (!isRecord(folder)) continue
		const id = asString(folder.id)
		const name = asString(folder.name)
		if (!id || !name) continue
		folderMap.set(id, {
			id,
			name,
			parentId: asOptionalParentId(folder.parentId),
			createdAt: asTimestamp(folder.createdAt),
		})
	}

	for (const file of rawFiles) {
		if (!isRecord(file)) continue
		const id = asString(file.id)
		const name = asString(file.name)
		const canvasKey = asString(file.canvasKey)
		if (!id || !name || !canvasKey) continue
		const type: WorkspaceFileType = file.type === 'reading' ? 'reading' : 'canvas'
		const readingId = asString(file.readingId) ?? undefined
		fileMap.set(id, {
			id,
			name,
			parentId: asOptionalParentId(file.parentId),
			type,
			createdAt: asTimestamp(file.createdAt),
			canvasKey,
			readingId,
		})
	}

	const next: WorkspaceState = {
		folders: Array.from(folderMap.values()),
		files: Array.from(fileMap.values()),
	}

	if (!folderMap.has(DEFAULT_CORE_FOLDER_ID)) {
		next.folders.push({
			id: DEFAULT_CORE_FOLDER_ID,
			name: 'Core Workspaces',
			parentId: null,
			createdAt: Date.now(),
		})
	}
	if (!folderMap.has(DEFAULT_READINGS_FOLDER_ID)) {
		next.folders.push({
			id: DEFAULT_READINGS_FOLDER_ID,
			name: 'Readings',
			parentId: null,
			createdAt: Date.now(),
		})
	}
	if (!folderMap.has(DEFAULT_SKETCHES_FOLDER_ID)) {
		next.folders.push({
			id: DEFAULT_SKETCHES_FOLDER_ID,
			name: 'Sketches',
			parentId: null,
			createdAt: Date.now(),
		})
	}
	if (!fileMap.has('weekly-prep')) {
		next.files.push({
			id: 'weekly-prep',
			name: 'Weekly Prep',
			parentId: DEFAULT_CORE_FOLDER_ID,
			type: 'canvas',
			createdAt: Date.now(),
			canvasKey: 'deliberatorium-weekly-prep',
		})
	}
	if (!fileMap.has('question-space')) {
		next.files.push({
			id: 'question-space',
			name: 'Question Space',
			parentId: DEFAULT_CORE_FOLDER_ID,
			type: 'canvas',
			createdAt: Date.now(),
			canvasKey: 'deliberatorium-question-space',
		})
	}

	next.folders.sort((a, b) => {
		if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
		return a.name.localeCompare(b.name)
	})
	next.files.sort((a, b) => {
		if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
		return a.name.localeCompare(b.name)
	})

	return next
}

function createReadingWorkspaceFile(reading: ReadingDocument): WorkspaceFile {
	return {
		id: `reading-${reading.id}`,
		name: reading.title,
		parentId: DEFAULT_READINGS_FOLDER_ID,
		type: 'reading',
		readingId: reading.id,
		createdAt: reading.createdAt,
		canvasKey: `deliberatorium-sketch-${reading.id}`,
	}
}

function ensureReadingFilesInWorkspace(workspace: WorkspaceState, readings: ReadingDocument[]): WorkspaceState {
	const fileMap = new Map(workspace.files.map((file) => [file.id, file] as const))
	let changed = false
	for (const reading of readings) {
		const id = `reading-${reading.id}`
		if (fileMap.has(id)) continue
		fileMap.set(id, createReadingWorkspaceFile(reading))
		changed = true
	}
	if (!changed) return workspace
	return normalizeWorkspaceValue({
		folders: workspace.folders,
		files: Array.from(fileMap.values()),
	})
}

function createDefaultSnapshot(timestamp = Date.now()): WorkspaceSnapshot {
	return {
		workspace: createDefaultWorkspaceState(timestamp),
		readings: [],
		revision: 0,
		updatedAt: timestamp,
	}
}

function normalizeSnapshot(value: unknown): WorkspaceSnapshot | null {
	if (!isRecord(value)) return null
	const workspace = normalizeWorkspaceValue(value.workspace)
	const readings = normalizeReadingsValue(value.readings)
	const revisionRaw = value.revision
	const updatedAtRaw = value.updatedAt
	const revision = typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) ? revisionRaw : 0
	const updatedAt = typeof updatedAtRaw === 'number' && Number.isFinite(updatedAtRaw) ? updatedAtRaw : 0
	return {
		workspace: ensureReadingFilesInWorkspace(workspace, readings),
		readings,
		revision,
		updatedAt,
	}
}

function json(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	})
}

export class WorkspaceStateDurableObject extends DurableObject<Environment> {
	private readonly router = AutoRouter({
		catch: (e) => {
			console.error('[workspace-do] unhandled error', e)
			return error(e)
		},
	})
		.get('/state', () => this.handleGet())
		.put('/state', (request) => this.handlePut(request))

	private async getSnapshot(): Promise<WorkspaceSnapshot> {
		const stored = await this.ctx.storage.get<WorkspaceSnapshot>(STORAGE_KEY)
		const normalized = normalizeSnapshot(stored)
		if (normalized) return normalized
		const next = createDefaultSnapshot()
		await this.ctx.storage.put(STORAGE_KEY, next)
		return next
	}

	private async handleGet(): Promise<Response> {
		const snapshot = await this.getSnapshot()
		return json(snapshot)
	}

	private async handlePut(request: IRequest): Promise<Response> {
		const current = await this.getSnapshot()
		const rawPayload = (await (request as unknown as Request).json()) as unknown
		if (!isRecord(rawPayload)) return error(400, 'Invalid payload')
		const workspace = normalizeWorkspaceValue(rawPayload.workspace ?? current.workspace)
		const readings = normalizeReadingsValue(rawPayload.readings ?? current.readings)
		const knownRevisionRaw = rawPayload.knownRevision
		const knownRevision = typeof knownRevisionRaw === 'number' ? knownRevisionRaw : undefined

		if (typeof knownRevision === 'number' && knownRevision > current.revision) {
			return error(409, 'Revision mismatch')
		}

		const next: WorkspaceSnapshot = {
			workspace: ensureReadingFilesInWorkspace(workspace, readings),
			readings,
			revision: current.revision + 1,
			updatedAt: Date.now(),
		}
		await this.ctx.storage.put(STORAGE_KEY, next)
		return json(next)
	}

	override fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}
}
