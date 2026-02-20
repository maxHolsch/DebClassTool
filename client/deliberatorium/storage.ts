export type DeliberatoriumColor = 'yellow' | 'blue' | 'green' | 'red' | 'violet' | 'orange'

export interface DeliberatoriumProfile {
	name: string
	color: DeliberatoriumColor
}

export interface ReadingDocument {
	id: string
	title: string
	content: string
	createdAt: number
}

export interface WorkspaceFolder {
	id: string
	name: string
	parentId: string | null
	createdAt: number
}

export type WorkspaceFileType = 'canvas' | 'reading'

export interface WorkspaceFile {
	id: string
	name: string
	parentId: string | null
	type: WorkspaceFileType
	createdAt: number
	canvasKey: string
	readingId?: string
}

export interface WorkspaceState {
	folders: WorkspaceFolder[]
	files: WorkspaceFile[]
}

export interface SharedWorkspaceSnapshot {
	workspace: WorkspaceState
	readings: ReadingDocument[]
	revision: number
	updatedAt: number
}

const PROFILE_KEY = 'deliberatorium.profile.v1'
const READING_KEY = 'deliberatorium.readings.v1'
const WORKSPACE_KEY = 'deliberatorium.workspace.v1'
const SHARED_WORKSPACE_SCOPE = 'default'
const SHARED_WORKSPACE_BASE_PATH = '/workspace'

export const DEFAULT_CORE_FOLDER_ID = 'core-workspaces'
export const DEFAULT_READINGS_FOLDER_ID = 'readings'
export const DEFAULT_SKETCHES_FOLDER_ID = 'sketches'
export const SHARED_WORKSPACE_POLL_INTERVAL_MS = 3000

const MAX_READING_CHARS = 18000

function createId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

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

export function createDefaultWorkspaceState(timestamp = Date.now()): WorkspaceState {
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
		const createdAt = asTimestamp(item.createdAt)
		readingMap.set(id, { id, title, content, createdAt })
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

	const fileMap = new Map<string, WorkspaceFile>()
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

export function normalizeReadings(readings: ReadingDocument[]): ReadingDocument[] {
	return normalizeReadingsValue(readings)
}

export function normalizeWorkspaceState(workspace: WorkspaceState): WorkspaceState {
	return normalizeWorkspaceValue(workspace)
}

export function loadProfile(): DeliberatoriumProfile | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.localStorage.getItem(PROFILE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as DeliberatoriumProfile
		if (!parsed?.name || !parsed?.color) return null
		return parsed
	} catch {
		return null
	}
}

export function saveProfile(profile: DeliberatoriumProfile): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function loadReadings(): ReadingDocument[] {
	if (typeof window === 'undefined') return []
	try {
		const raw = window.localStorage.getItem(READING_KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as unknown
		return normalizeReadingsValue(parsed)
	} catch {
		return []
	}
}

export function saveReadings(readings: ReadingDocument[]): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(READING_KEY, JSON.stringify(normalizeReadingsValue(readings)))
}

export function loadWorkspaceState(): WorkspaceState {
	if (typeof window === 'undefined') return createDefaultWorkspaceState()
	try {
		const raw = window.localStorage.getItem(WORKSPACE_KEY)
		if (!raw) return createDefaultWorkspaceState()
		const parsed = JSON.parse(raw) as unknown
		return normalizeWorkspaceValue(parsed)
	} catch {
		return createDefaultWorkspaceState()
	}
}

export function saveWorkspaceState(workspace: WorkspaceState): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(normalizeWorkspaceValue(workspace)))
}

export function ensureReadingFilesInWorkspace(
	workspace: WorkspaceState,
	readings: ReadingDocument[]
): WorkspaceState {
	const normalizedWorkspace = normalizeWorkspaceValue(workspace)
	const normalizedReadings = normalizeReadingsValue(readings)
	const fileMap = new Map(normalizedWorkspace.files.map((file) => [file.id, file] as const))
	let changed = false

	for (const reading of normalizedReadings) {
		const id = `reading-${reading.id}`
		if (fileMap.has(id)) continue
		changed = true
		fileMap.set(id, createReadingWorkspaceFile(reading, DEFAULT_READINGS_FOLDER_ID))
	}

	if (!changed) return normalizedWorkspace
	return normalizeWorkspaceValue({
		folders: normalizedWorkspace.folders,
		files: Array.from(fileMap.values()),
	})
}

export function mergeReadings(primary: ReadingDocument[], secondary: ReadingDocument[]): ReadingDocument[] {
	const secondaryNormalized = normalizeReadingsValue(secondary)
	const primaryNormalized = normalizeReadingsValue(primary)
	const map = new Map<string, ReadingDocument>()
	for (const reading of secondaryNormalized) map.set(reading.id, reading)
	for (const reading of primaryNormalized) map.set(reading.id, reading)
	return normalizeReadingsValue(Array.from(map.values()))
}

export function mergeWorkspaceStates(primary: WorkspaceState, secondary: WorkspaceState): WorkspaceState {
	const secondaryNormalized = normalizeWorkspaceValue(secondary)
	const primaryNormalized = normalizeWorkspaceValue(primary)
	const folderMap = new Map<string, WorkspaceFolder>()
	const fileMap = new Map<string, WorkspaceFile>()

	for (const folder of secondaryNormalized.folders) folderMap.set(folder.id, folder)
	for (const file of secondaryNormalized.files) fileMap.set(file.id, file)
	for (const folder of primaryNormalized.folders) folderMap.set(folder.id, folder)
	for (const file of primaryNormalized.files) fileMap.set(file.id, file)

	return normalizeWorkspaceValue({
		folders: Array.from(folderMap.values()),
		files: Array.from(fileMap.values()),
	})
}

export function getWorkspaceSnapshotFingerprint(
	workspace: WorkspaceState,
	readings: ReadingDocument[]
): string {
	const normalizedReadings = normalizeReadingsValue(readings)
	const normalizedWorkspace = ensureReadingFilesInWorkspace(normalizeWorkspaceValue(workspace), normalizedReadings)
	return JSON.stringify({
		workspace: normalizedWorkspace,
		readings: normalizedReadings,
	})
}

function normalizeSharedWorkspaceSnapshot(value: unknown): SharedWorkspaceSnapshot | null {
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

function getSharedWorkspaceUrl(scope: string): string {
	return `${SHARED_WORKSPACE_BASE_PATH}/${encodeURIComponent(scope)}`
}

export async function loadSharedWorkspaceSnapshot(
	scope = SHARED_WORKSPACE_SCOPE
): Promise<SharedWorkspaceSnapshot | null> {
	if (typeof window === 'undefined') return null
	try {
		const response = await fetch(getSharedWorkspaceUrl(scope), {
			method: 'GET',
			headers: {
				Accept: 'application/json',
			},
		})
		if (!response.ok) return null
		const parsed = (await response.json()) as unknown
		const snapshot = normalizeSharedWorkspaceSnapshot(parsed)
		if (!snapshot) return null
		saveReadings(snapshot.readings)
		saveWorkspaceState(snapshot.workspace)
		return snapshot
	} catch {
		return null
	}
}

export async function saveSharedWorkspaceSnapshot({
	workspace,
	readings,
	scope = SHARED_WORKSPACE_SCOPE,
	knownRevision,
}: {
	workspace: WorkspaceState
	readings: ReadingDocument[]
	scope?: string
	knownRevision?: number
}): Promise<SharedWorkspaceSnapshot | null> {
	if (typeof window === 'undefined') return null
	const normalizedReadings = normalizeReadingsValue(readings)
	const normalizedWorkspace = ensureReadingFilesInWorkspace(workspace, normalizedReadings)

	try {
		const response = await fetch(getSharedWorkspaceUrl(scope), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				workspace: normalizedWorkspace,
				readings: normalizedReadings,
				knownRevision,
			}),
		})
		if (!response.ok) return null
		const parsed = (await response.json()) as unknown
		const snapshot = normalizeSharedWorkspaceSnapshot(parsed)
		if (!snapshot) return null
		saveReadings(snapshot.readings)
		saveWorkspaceState(snapshot.workspace)
		return snapshot
	} catch {
		return null
	}
}

export function createWorkspaceFolder(name: string, parentId: string | null): WorkspaceFolder {
	return {
		id: createId('folder'),
		name: name.trim(),
		parentId,
		createdAt: Date.now(),
	}
}

export function createCanvasWorkspaceFile(name: string, parentId: string | null): WorkspaceFile {
	const id = createId('canvas')
	return {
		id,
		name: name.trim(),
		parentId,
		type: 'canvas',
		createdAt: Date.now(),
		canvasKey: `deliberatorium-canvas-${id}`,
	}
}

export function createReadingWorkspaceFile(
	reading: ReadingDocument,
	parentId: string | null
): WorkspaceFile {
	return {
		id: `reading-${reading.id}`,
		name: reading.title,
		parentId,
		type: 'reading',
		readingId: reading.id,
		createdAt: reading.createdAt,
		canvasKey: `deliberatorium-sketch-${reading.id}`,
	}
}

export function createReadingDocument(fileName: string, content: string): ReadingDocument {
	const normalized = content.replace(/\s+/g, ' ').trim().slice(0, MAX_READING_CHARS)
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		title: fileName,
		content: normalized,
		createdAt: Date.now(),
	}
}

export async function readTextFromFile(file: File): Promise<string> {
	const text = await file.text()
	return text
}
