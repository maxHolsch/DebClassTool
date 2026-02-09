import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	DefaultColorStyle,
	DefaultSizeStyle,
	ErrorBoundary,
	TLComponents,
	TLUiOverrides,
	Tldraw,
	TldrawOverlays,
	TldrawUiToastsProvider,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { createHumanMeta, sanitizeShapeMeta } from './deliberatorium/shapeMeta'
import {
	createCanvasWorkspaceFile,
	createReadingDocument,
	createReadingWorkspaceFile,
	createWorkspaceFolder,
	DEFAULT_READINGS_FOLDER_ID,
	DEFAULT_SKETCHES_FOLDER_ID,
	DeliberatoriumColor,
	DeliberatoriumProfile,
	loadProfile,
	loadReadings,
	loadWorkspaceState,
	readTextFromFile,
	ReadingDocument,
	saveProfile,
	saveReadings,
	saveWorkspaceState,
	WorkspaceFile,
	WorkspaceFolder,
	WorkspaceState,
} from './deliberatorium/storage'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'

DefaultSizeStyle.setDefaultValue('s')

const tools = [TargetShapeTool, TargetAreaTool]
const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		return {
			...tools,
			'target-area': {
				id: 'target-area',
				label: 'Pick Area',
				kbd: 'c',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-area')
				},
			},
			'target-shape': {
				id: 'target-shape',
				label: 'Pick Shape',
				kbd: 's',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-shape')
				},
			},
		}
	},
}

const CLASS_PASSWORD = import.meta.env.VITE_CLASS_PASSWORD ?? 'deliberatorium'
const COLOR_OPTIONS: DeliberatoriumColor[] = ['yellow', 'blue', 'green', 'red', 'violet', 'orange']
const COLOR_SWATCHES: Record<DeliberatoriumColor, string> = {
	yellow: '#f2c94c',
	blue: '#2f80ed',
	green: '#27ae60',
	red: '#eb5757',
	violet: '#9b51e0',
	orange: '#f2994a',
}
const PDF_URL_HASH = '#deliberatorium-pdf'

function isPdfFile(file: File): boolean {
	return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [profile, setProfile] = useState<DeliberatoriumProfile | null>(null)
	const [readings, setReadings] = useState<ReadingDocument[]>([])
	const [readingPdfUrls, setReadingPdfUrls] = useState<Record<string, string>>({})
	const [workspace, setWorkspace] = useState<WorkspaceState>({ folders: [], files: [] })
	const [activeFileId, setActiveFileId] = useState<string | null>(null)
	const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
	const [expandedFolderIds, setExpandedFolderIds] = useState<Record<string, boolean>>({})
	const [showRecommender, setShowRecommender] = useState(false)
	const [liveTranscript, setLiveTranscript] = useState('')
	const [lastSavedAt, setLastSavedAt] = useState<number>(Date.now())
	const fileInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		setProfile(loadProfile())

		const initialReadings = loadReadings()
		setReadings(initialReadings)

		let initialWorkspace = loadWorkspaceState()
		const readingIdsInWorkspace = new Set(
			initialWorkspace.files.filter((file) => file.type === 'reading').map((file) => file.readingId)
		)
		const missingReadingFiles = initialReadings
			.filter((reading) => !readingIdsInWorkspace.has(reading.id))
			.map((reading) => createReadingWorkspaceFile(reading, DEFAULT_READINGS_FOLDER_ID))
		if (missingReadingFiles.length > 0) {
			initialWorkspace = {
				...initialWorkspace,
				files: [...initialWorkspace.files, ...missingReadingFiles],
			}
			saveWorkspaceState(initialWorkspace)
		}

		setWorkspace(initialWorkspace)
		setActiveFileId(initialWorkspace.files[0]?.id ?? null)
			setExpandedFolderIds({
				[DEFAULT_READINGS_FOLDER_ID]: true,
				[DEFAULT_SKETCHES_FOLDER_ID]: true,
				'core-workspaces': true,
			})
	}, [])

	useEffect(() => {
		if (!app || !profile) return
		app.editor.setStyleForNextShapes(DefaultColorStyle, profile.color)
	}, [app, profile])

	useEffect(() => {
		if (!app || !profile) return
		const editor = app.editor

		const markSaved = () => setLastSavedAt(Date.now())
		const isAgentActing = () => app.agents.getAgents().some((agent) => agent.getIsActingOnEditor())

		const cleanUpCreate = editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
			if (source !== 'user' || isAgentActing()) return
			const metadata = createHumanMeta(profile.name)
			const patch: any = {
				id: shape.id,
				type: shape.type,
				meta: {
					...sanitizeShapeMeta(shape.meta),
					...metadata,
				},
			}
			if ('props' in shape && shape.props && 'color' in shape.props) {
				patch.props = {
					...(shape.props as Record<string, unknown>),
					color: profile.color,
				}
			}
			editor.updateShape(patch)
			markSaved()
		})

		const cleanUpChange = editor.sideEffects.registerAfterChangeHandler(
			'shape',
			(_prev, next, source) => {
				if (source !== 'user') return
				if (!isAgentActing() && (!next.meta || !('source' in next.meta))) {
					editor.updateShape({
						id: next.id,
						type: next.type,
						meta: {
							...sanitizeShapeMeta(next.meta),
							...createHumanMeta(profile.name),
						},
					} as any)
				}
				markSaved()
			}
		)

		const cleanUpDelete = editor.sideEffects.registerAfterDeleteHandler('shape', (_shape, source) => {
			if (source !== 'user' || isAgentActing()) return
			markSaved()
		})

		return () => {
			cleanUpCreate()
			cleanUpChange()
			cleanUpDelete()
		}
	}, [app, profile])

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	const components: TLComponents = useMemo(() => {
		return {
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
			Overlays: () => (
				<>
					<TldrawOverlays />
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<AgentViewportBoundsHighlights />
							<AllContextHighlights />
						</TldrawAgentAppContextProvider>
					)}
				</>
			),
		}
	}, [app])

	const updateWorkspace = useCallback((updater: (prev: WorkspaceState) => WorkspaceState) => {
		setWorkspace((prev) => {
			const next = updater(prev)
			saveWorkspaceState(next)
			return next
		})
	}, [])

	const folderById = useMemo(() => {
		const map = new Map<string, WorkspaceFolder>()
		for (const folder of workspace.folders) {
			map.set(folder.id, folder)
		}
		return map
	}, [workspace.folders])

	const activeFile = useMemo(() => {
		if (!workspace.files.length) return null
		return workspace.files.find((file) => file.id === activeFileId) ?? workspace.files[0]
	}, [activeFileId, workspace.files])

	useEffect(() => {
		if (!activeFile) return
		if (activeFileId !== activeFile.id) {
			setActiveFileId(activeFile.id)
		}
	}, [activeFile, activeFileId])

	const canvasPersistenceKey = useMemo(
		() => activeFile?.canvasKey ?? 'deliberatorium-weekly-prep',
		[activeFile]
	)

	const activeWorkspaceLabel = useMemo(() => {
		return 'A new Deliberatorium'
	}, [])

	const activeWorkspaceSubtitle = useMemo(() => {
		if (!activeFile) return 'Create or select a file in the explorer.'
		if (activeFile.id === 'weekly-prep') {
			return ''
		}
		if (activeFile.id === 'question-space') {
			return 'Track unresolved questions and responses across the semester.'
		}
		if (activeFile.type === 'reading') {
			return 'Reference map generated from an uploaded source reading.'
		}
		return 'Custom canvas file for ongoing group thinking.'
	}, [activeFile])

	const activeReadingPdfUrl = useMemo(() => {
		if (!activeFile || activeFile.type !== 'reading' || !activeFile.readingId) return null
		return readingPdfUrls[activeFile.readingId] ?? null
	}, [activeFile, readingPdfUrls])

	const recommendations = useMemo(() => {
		const queryWords = liveTranscript
			.toLowerCase()
			.split(/\W+/)
			.filter((word) => word.length > 3)
		if (!queryWords.length) return []

		const scored = readings
			.map((reading) => {
				const haystack = reading.content.toLowerCase()
				const score = queryWords.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0)
				return { reading, score }
			})
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 3)

		const tags = ['supports', 'contradicts', 'extends'] as const
		return scored.map((entry, index) => ({
			...entry,
			tag: tags[index % tags.length],
			excerpt: entry.reading.content.slice(0, 220),
		}))
	}, [liveTranscript, readings])

	const lastSavedLabel = useMemo(() => {
		const elapsed = Date.now() - lastSavedAt
		if (elapsed < 30_000) return 'just now'
		const minutes = Math.max(1, Math.round(elapsed / 60_000))
		if (minutes < 60) return `${minutes}m ago`
		const hours = Math.round(minutes / 60)
		return `${hours}h ago`
	}, [lastSavedAt])

	const handleAuthSubmit = useCallback((nextProfile: DeliberatoriumProfile) => {
		saveProfile(nextProfile)
		setProfile(nextProfile)
	}, [])

	const handleUploadClick = useCallback(() => {
		fileInputRef.current?.click()
	}, [])

	const handleReadingUpload = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0]
			if (!file) return
			const pdfUpload = isPdfFile(file)
			let content = ''
			if (pdfUpload) {
				content = `PDF uploaded: ${file.name}`
			} else {
				content = await readTextFromFile(file)
			}

			if (!pdfUpload && !content.trim()) {
				window.alert('Could not read text from this file. Upload a text-based file (.txt, .md, .json).')
				event.target.value = ''
				return
			}

			const reading = createReadingDocument(file.name, content)
			setReadings((prev) => {
				const next = [...prev, reading]
				saveReadings(next)
				return next
			})

			const readingFile = createReadingWorkspaceFile(reading, DEFAULT_READINGS_FOLDER_ID)
			updateWorkspace((prev) => ({
				...prev,
				files: [...prev.files, readingFile],
			}))
				setExpandedFolderIds((prev) => ({ ...prev, [DEFAULT_READINGS_FOLDER_ID]: true }))
				setSelectedFolderId(DEFAULT_READINGS_FOLDER_ID)
				setActiveFileId(readingFile.id)
				if (pdfUpload) {
					const pdfUrl = `${URL.createObjectURL(file)}${PDF_URL_HASH}`
					setReadingPdfUrls((prev) => ({ ...prev, [reading.id]: pdfUrl }))
				}
				event.target.value = ''
			},
			[updateWorkspace]
		)

	const handleMapReading = useCallback(() => {
		const agent = app?.agents.getAgent()
		if (!agent) return
		agent.interrupt({
			input: {
				agentMessages: [
					'Map the latest uploaded reading using create-concept-node and create-relationship-edge actions. Keep all AI nodes yellow and make tensions explicit.',
				],
				bounds: agent.editor.getViewportPageBounds(),
				source: 'user',
				contextItems: agent.context.getItems(),
			},
		})
	}, [app])

	const handleCreateFolder = useCallback(() => {
		const name = window.prompt('Folder name')
		if (!name || !name.trim()) return
		const folder = createWorkspaceFolder(name, selectedFolderId)
		updateWorkspace((prev) => ({
			...prev,
			folders: [...prev.folders, folder],
		}))
		setExpandedFolderIds((prev) => ({ ...prev, [selectedFolderId ?? 'root']: true, [folder.id]: true }))
		setSelectedFolderId(folder.id)
	}, [selectedFolderId, updateWorkspace])

	const handleCreateFile = useCallback(() => {
		const name = window.prompt('File name')
		if (!name || !name.trim()) return
		const file = createCanvasWorkspaceFile(name, selectedFolderId)
		updateWorkspace((prev) => ({
			...prev,
			files: [...prev.files, file],
		}))
		setActiveFileId(file.id)
	}, [selectedFolderId, updateWorkspace])

	const handleToggleFolder = useCallback((folderId: string) => {
		setExpandedFolderIds((prev) => ({ ...prev, [folderId]: !prev[folderId] }))
	}, [])

	if (!profile) {
		return <AuthGate onSubmit={handleAuthSubmit} />
	}

	return (
		<TldrawUiToastsProvider>
			<div className="deliberatorium-shell">
				<header className="deliberatorium-topbar">
					<div className="deliberatorium-brand-wrap">
						<div className="deliberatorium-brand">
							<img className="brand-logo" src="/ccc/assets/logoCCC.svg" alt="Center for Constructive Communication" />
							<div className="brand-copy">
								<span className="brand-title">Deliberatorium</span>
								<span className="brand-subtitle">Constructive Communication Workspace</span>
							</div>
						</div>
						<img className="brand-mit-logo" src="/ccc/assets/mit_logo_std_rgb_silver-gray.svg" alt="MIT" />
					</div>
					<div className="deliberatorium-current-file" title={activeWorkspaceLabel}>
						{activeWorkspaceLabel}
					</div>
					<div className="deliberatorium-actions">
						<input
							ref={fileInputRef}
							type="file"
							hidden
							onChange={handleReadingUpload}
							accept=".txt,.md,.json,.csv,.html,.rtf,.pdf"
						/>
						<button className="btn-secondary" onClick={handleUploadClick}>
							Upload Reading
						</button>
						<button className="btn-secondary" onClick={handleMapReading}>
							Map Latest Reading
						</button>
						<button
							className={showRecommender ? 'btn-primary' : 'btn-secondary'}
							onClick={() => setShowRecommender((prev) => !prev)}
						>
							Reading Recommender
						</button>
					</div>
				</header>

				<div className="tldraw-agent-container">
					<aside className="deliberatorium-explorer">
						<div className="explorer-header">
							<strong>Files</strong>
							<div className="explorer-actions">
								<button type="button" onClick={handleCreateFile}>
									+ File
								</button>
								<button type="button" onClick={handleCreateFolder}>
									+ Folder
								</button>
							</div>
						</div>
						<ExplorerTree
							folders={workspace.folders}
							files={workspace.files}
							activeFileId={activeFile?.id ?? null}
							selectedFolderId={selectedFolderId}
							expandedFolderIds={expandedFolderIds}
							onToggleFolder={handleToggleFolder}
							onSelectFolder={setSelectedFolderId}
							onSelectFile={(file) => {
								setActiveFileId(file.id)
								setSelectedFolderId(file.parentId)
							}}
						/>
					</aside>

						<div className="tldraw-canvas deliberatorium-canvas">
							<div className="deliberatorium-canvas-header">
								<div>
									<div className="canvas-title">{activeFile?.name ?? 'Workspace'}</div>
									<div className="canvas-subtitle">{activeWorkspaceSubtitle}</div>
								</div>
								{activeReadingPdfUrl && (
									<button
										className="btn-secondary"
										type="button"
										onClick={() => window.open(activeReadingPdfUrl, '_blank', 'noopener,noreferrer')}
									>
										Open PDF
									</button>
								)}
							</div>
						<Tldraw
							key={canvasPersistenceKey}
							persistenceKey={canvasPersistenceKey}
							tools={tools}
							overrides={overrides}
							components={components}
						>
								<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
						</Tldraw>
						<div className="deliberatorium-legend">
							<div>
								<span className="legend-chip" style={{ background: '#f2c94c' }} /> AI first pass
							</div>
							<div>
								<span className="legend-chip" style={{ background: COLOR_SWATCHES[profile.color] }} />{' '}
								{profile.name}
							</div>
						</div>
					</div>

					<ErrorBoundary fallback={ChatPanelFallback}>
						{app && (
							<TldrawAgentAppContextProvider app={app}>
								<ChatPanel />
							</TldrawAgentAppContextProvider>
						)}
					</ErrorBoundary>
				</div>

				<footer className="deliberatorium-status">
					<div>4 collaborators online</div>
					<div>Last saved {lastSavedLabel}</div>
					<div>{readings.length} readings indexed</div>
				</footer>

				{showRecommender && (
					<div className="recommender-popout" role="dialog" aria-label="Reading recommender">
						<div className="recommender-header">
							<strong>Reading Recommender</strong>
							<button onClick={() => setShowRecommender(false)}>Close</button>
						</div>
						<textarea
							placeholder="Paste live transcript text..."
							value={liveTranscript}
							onChange={(event) => setLiveTranscript(event.target.value)}
						/>
						<div className="recommender-cards">
							{recommendations.length === 0 && (
								<div className="recommender-card empty">
									No matches yet. Add transcript text to surface relevant passages.
								</div>
							)}
							{recommendations.map((item) => (
								<div key={item.reading.id} className="recommender-card">
									<div className="recommender-card-header">
										<strong>{item.reading.title}</strong>
										<span className={`recommender-tag recommender-tag-${item.tag}`}>
											{item.tag}
										</span>
									</div>
									<p>{item.excerpt}...</p>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</TldrawUiToastsProvider>
	)
}

function ExplorerTree({
	folders,
	files,
	activeFileId,
	selectedFolderId,
	expandedFolderIds,
	onToggleFolder,
	onSelectFolder,
	onSelectFile,
}: {
	folders: WorkspaceFolder[]
	files: WorkspaceFile[]
	activeFileId: string | null
	selectedFolderId: string | null
	expandedFolderIds: Record<string, boolean>
	onToggleFolder: (folderId: string) => void
	onSelectFolder: (folderId: string | null) => void
	onSelectFile: (file: WorkspaceFile) => void
}) {
	const foldersByParent = useMemo(() => {
		const map = new Map<string | null, WorkspaceFolder[]>()
		for (const folder of folders) {
			const list = map.get(folder.parentId) ?? []
			list.push(folder)
			map.set(folder.parentId, list)
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.name.localeCompare(b.name))
		}
		return map
	}, [folders])

	const filesByParent = useMemo(() => {
		const map = new Map<string | null, WorkspaceFile[]>()
		for (const file of files) {
			const list = map.get(file.parentId) ?? []
			list.push(file)
			map.set(file.parentId, list)
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.name.localeCompare(b.name))
		}
		return map
	}, [files])

	const renderFolder = (parentId: string | null, depth: number): JSX.Element[] => {
		const folderItems = foldersByParent.get(parentId) ?? []
		const fileItems = filesByParent.get(parentId) ?? []
		const rows: JSX.Element[] = []

		for (const folder of folderItems) {
			const expanded = expandedFolderIds[folder.id] ?? false
			rows.push(
				<div key={folder.id} className="explorer-row" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
					<button
						type="button"
						className={`explorer-item explorer-folder ${selectedFolderId === folder.id ? 'active' : ''}`}
						onClick={() => onSelectFolder(folder.id)}
					>
						<span className="explorer-caret" onClick={() => onToggleFolder(folder.id)}>
							{expanded ? '-' : '+'}
						</span>
						<span>[dir] {folder.name}</span>
					</button>
				</div>
			)
			if (expanded) {
				rows.push(...renderFolder(folder.id, depth + 1))
			}
		}

		for (const file of fileItems) {
			rows.push(
				<div key={file.id} className="explorer-row" style={{ paddingLeft: `${depth * 14 + 32}px` }}>
					<button
						type="button"
						className={`explorer-item explorer-file ${activeFileId === file.id ? 'active' : ''}`}
						onClick={() => onSelectFile(file)}
					>
						<span>{file.type === 'reading' ? '[READ]' : '[FILE]'} {file.name}</span>
					</button>
				</div>
			)
		}

		return rows
	}

	return <div className="explorer-tree">{renderFolder(null, 0)}</div>
}

function AuthGate({ onSubmit }: { onSubmit: (profile: DeliberatoriumProfile) => void }) {
	const [password, setPassword] = useState('')
	const [name, setName] = useState('')
	const [color, setColor] = useState<DeliberatoriumColor>('blue')
	const [error, setError] = useState<string | null>(null)

	const handleSubmit = useCallback(
		(event: FormEvent) => {
			event.preventDefault()
			if (password !== CLASS_PASSWORD) {
				setError('Incorrect class password.')
				return
			}
			if (!name.trim()) {
				setError('Please enter your name.')
				return
			}
			onSubmit({ name: name.trim(), color })
		},
		[color, name, onSubmit, password]
	)

	return (
		<div className="auth-gate">
			<form className="auth-card" onSubmit={handleSubmit}>
				<h1>The Deliberatorium</h1>
				<p>Enter the class password, your display name, and your annotation color.</p>
				<label>
					Class Password
					<input
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
				</label>
				<label>
					Your Name
					<input value={name} onChange={(event) => setName(event.target.value)} required />
				</label>
				<label>
					Your Color
					<select value={color} onChange={(event) => setColor(event.target.value as DeliberatoriumColor)}>
						{COLOR_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</label>
				{error && <div className="auth-error">{error}</div>}
				<button type="submit">Enter Workspace</button>
			</form>
		</div>
	)
}

export default App
