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

const PROFILE_KEY = 'deliberatorium.profile.v1'
const READING_KEY = 'deliberatorium.readings.v1'
const WORKSPACE_KEY = 'deliberatorium.workspace.v1'

export const DEFAULT_CORE_FOLDER_ID = 'core-workspaces'
export const DEFAULT_READINGS_FOLDER_ID = 'readings'
export const DEFAULT_SKETCHES_FOLDER_ID = 'sketches'

const MAX_READING_CHARS = 18000

function createId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createDefaultWorkspaceState(): WorkspaceState {
	return {
		folders: [
			{
				id: DEFAULT_CORE_FOLDER_ID,
				name: 'Core Workspaces',
				parentId: null,
				createdAt: Date.now(),
			},
			{
				id: DEFAULT_READINGS_FOLDER_ID,
				name: 'Readings',
				parentId: null,
				createdAt: Date.now(),
			},
			{
				id: DEFAULT_SKETCHES_FOLDER_ID,
				name: 'Sketches',
				parentId: null,
				createdAt: Date.now(),
			},
		],
		files: [
			{
				id: 'weekly-prep',
				name: 'Weekly Prep',
				parentId: DEFAULT_CORE_FOLDER_ID,
				type: 'canvas',
				createdAt: Date.now(),
				canvasKey: 'deliberatorium-weekly-prep',
			},
			{
				id: 'question-space',
				name: 'Question Space',
				parentId: DEFAULT_CORE_FOLDER_ID,
				type: 'canvas',
				createdAt: Date.now(),
				canvasKey: 'deliberatorium-question-space',
			},
		],
	}
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
		const parsed = JSON.parse(raw) as ReadingDocument[]
		if (!Array.isArray(parsed)) return []
		return parsed.filter((item) => item?.id && item?.title && item?.content)
	} catch {
		return []
	}
}

export function saveReadings(readings: ReadingDocument[]): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(READING_KEY, JSON.stringify(readings))
}

export function loadWorkspaceState(): WorkspaceState {
	if (typeof window === 'undefined') return createDefaultWorkspaceState()
	try {
		const raw = window.localStorage.getItem(WORKSPACE_KEY)
		if (!raw) return createDefaultWorkspaceState()
		const parsed = JSON.parse(raw) as WorkspaceState
		if (!parsed || !Array.isArray(parsed.folders) || !Array.isArray(parsed.files)) {
			return createDefaultWorkspaceState()
		}

		const folders = parsed.folders.filter((folder) => folder?.id && folder?.name)
		const files = parsed.files.filter((file) => file?.id && file?.name && file?.canvasKey)
		const hasCore = folders.some((folder) => folder.id === DEFAULT_CORE_FOLDER_ID)
		const hasReadingsFolder = folders.some((folder) => folder.id === DEFAULT_READINGS_FOLDER_ID)
		const hasSketchesFolder = folders.some((folder) => folder.id === DEFAULT_SKETCHES_FOLDER_ID)
		const hasWeekly = files.some((file) => file.id === 'weekly-prep')
		const hasQuestion = files.some((file) => file.id === 'question-space')

		const next: WorkspaceState = {
			folders: [...folders],
			files: [...files],
		}

		if (!hasCore) {
			next.folders.push({
				id: DEFAULT_CORE_FOLDER_ID,
				name: 'Core Workspaces',
				parentId: null,
				createdAt: Date.now(),
			})
		}
		if (!hasReadingsFolder) {
			next.folders.push({
				id: DEFAULT_READINGS_FOLDER_ID,
				name: 'Readings',
				parentId: null,
				createdAt: Date.now(),
			})
		}
		if (!hasSketchesFolder) {
			next.folders.push({
				id: DEFAULT_SKETCHES_FOLDER_ID,
				name: 'Sketches',
				parentId: null,
				createdAt: Date.now(),
			})
		}
		if (!hasWeekly) {
			next.files.push({
				id: 'weekly-prep',
				name: 'Weekly Prep',
				parentId: DEFAULT_CORE_FOLDER_ID,
				type: 'canvas',
				createdAt: Date.now(),
				canvasKey: 'deliberatorium-weekly-prep',
			})
		}
		if (!hasQuestion) {
			next.files.push({
				id: 'question-space',
				name: 'Question Space',
				parentId: DEFAULT_CORE_FOLDER_ID,
				type: 'canvas',
				createdAt: Date.now(),
				canvasKey: 'deliberatorium-question-space',
			})
		}
		return next
	} catch {
		return createDefaultWorkspaceState()
	}
}

export function saveWorkspaceState(workspace: WorkspaceState): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
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
