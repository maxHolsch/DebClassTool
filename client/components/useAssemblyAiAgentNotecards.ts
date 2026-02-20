import { useCallback, useEffect, useRef, useState } from 'react'
import { BoxModel, createShapeId, TLShape, TLShapeId, toRichText } from 'tldraw'
import { applyAiStyle, sanitizeShapeMeta } from '../deliberatorium/shapeMeta'
import { TldrawAgent } from '../agent/TldrawAgent'

interface AssemblyAiTurnMessage {
	type?: string
	transcript?: string
	end_of_turn?: boolean
	turn_is_formatted?: boolean
	turn_order?: number
	id?: string
	speaker?: string
	speaker_id?: string
}

type AssemblyAiStatus = 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error'

export type RealtimeMappingService = 'live-notecards' | 'question-flowers'

interface UseAssemblyAiAgentNotecardsOptions {
	service: RealtimeMappingService
}

interface UseAssemblyAiAgentNotecardsResult {
	status: AssemblyAiStatus
	isListening: boolean
	error: string | null
	liveTranscript: string
	lastTurnSummary: string
	activeQuestionLabel: string
	start: () => Promise<void>
	stop: () => void
}

const CARD_WIDTH = 320
const CARD_HEIGHT = 140
const CARD_GAP = 24
const QUESTION_WIDTH = 360
const QUESTION_HEIGHT = 170
const RESPONSE_WIDTH = 300
const RESPONSE_HEIGHT = 140
const FLOWER_EDGE_LABEL = 'responds to'

interface ActiveQuestionFlower {
	shapeId: TLShapeId
	label: string
	clusterCenter: { x: number; y: number }
	responseCount: number
	lastResponseShapeId: TLShapeId | null
}

export function useAssemblyAiAgentNotecards(
	agent: TldrawAgent,
	options: UseAssemblyAiAgentNotecardsOptions
): UseAssemblyAiAgentNotecardsResult {
	const { service } = options
	const [status, setStatus] = useState<AssemblyAiStatus>('idle')
	const [isListening, setIsListening] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [liveTranscript, setLiveTranscript] = useState('')
	const [lastTurnSummary, setLastTurnSummary] = useState('')
	const [activeQuestionLabel, setActiveQuestionLabel] = useState('')

	const processedTurnIdsRef = useRef(new Set<string>())
	const slotRef = useRef(0)
	const questionSlotRef = useRef(0)
	const activeQuestionRef = useRef<ActiveQuestionFlower | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const mediaStreamRef = useRef<MediaStream | null>(null)
	const audioContextRef = useRef<AudioContext | null>(null)
	const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
	const processorNodeRef = useRef<ScriptProcessorNode | null>(null)
	const shouldReconnectRef = useRef(false)
	const reconnectTimeoutRef = useRef<number | null>(null)

	const clearAudioPipeline = useCallback(() => {
		if (processorNodeRef.current) {
			processorNodeRef.current.onaudioprocess = null
			processorNodeRef.current.disconnect()
			processorNodeRef.current = null
		}
		if (sourceNodeRef.current) {
			sourceNodeRef.current.disconnect()
			sourceNodeRef.current = null
		}
		if (audioContextRef.current) {
			void audioContextRef.current.close()
			audioContextRef.current = null
		}
		if (mediaStreamRef.current) {
			for (const track of mediaStreamRef.current.getTracks()) {
				track.stop()
			}
			mediaStreamRef.current = null
		}
	}, [])

	const clearSocket = useCallback(() => {
		if (wsRef.current) {
			try {
				wsRef.current.send(JSON.stringify({ type: 'Terminate' }))
			} catch (_e) {
				// no-op
			}
			wsRef.current.close()
			wsRef.current = null
		}
	}, [])

	const stop = useCallback(() => {
		shouldReconnectRef.current = false
		if (reconnectTimeoutRef.current !== null) {
			window.clearTimeout(reconnectTimeoutRef.current)
			reconnectTimeoutRef.current = null
		}
		clearSocket()
		clearAudioPipeline()
		setIsListening(false)
		setStatus('idle')
		setLiveTranscript('')
	}, [clearAudioPipeline, clearSocket])

	const getQuestionClusterCenter = useCallback(() => {
		const viewport = agent.editor.getViewportPageBounds()
		const horizontalMargin = Math.min(220, viewport.w * 0.25)
		const verticalMargin = Math.min(200, viewport.h * 0.25)
		const gapX = 500
		const gapY = 420

		const columns = Math.max(1, Math.floor((viewport.w - horizontalMargin * 2) / gapX))
		const rows = Math.max(1, Math.floor((viewport.h - verticalMargin * 2) / gapY))
		const slotsPerPage = columns * rows
		const slot = questionSlotRef.current++
		const wrappedSlot = slot % slotsPerPage
		const page = Math.floor(slot / slotsPerPage)
		const column = wrappedSlot % columns
		const row = Math.floor(wrappedSlot / columns)

		return {
			x: viewport.minX + horizontalMargin + column * gapX + page * 60,
			y: viewport.minY + verticalMargin + row * gapY + page * 50,
		}
	}, [agent.editor])

	const getPlacementBounds = useCallback((): BoxModel => {
		const viewport = agent.editor.getViewportPageBounds()
		const cardsPerColumn = Math.max(1, Math.floor((viewport.h - CARD_GAP * 2) / (CARD_HEIGHT + CARD_GAP)))
		const slot = slotRef.current++
		const column = Math.floor(slot / cardsPerColumn)
		const row = slot % cardsPerColumn
		const laneX = viewport.maxX - CARD_WIDTH - CARD_GAP
		const x = laneX + column * (CARD_WIDTH + CARD_GAP)
		const y = viewport.minY + CARD_GAP + row * (CARD_HEIGHT + CARD_GAP)

		return {
			x: x - 16,
			y: y - 16,
			w: CARD_WIDTH + 32,
			h: CARD_HEIGHT + 32,
		}
	}, [agent.editor])

	const getCurrentQuestionCenter = useCallback(
		(activeQuestion: ActiveQuestionFlower) => {
			const shape = agent.editor.getShape(activeQuestion.shapeId)
			if (!shape) return activeQuestion.clusterCenter
			const bounds = agent.editor.getShapePageBounds(shape)
			if (!bounds) return activeQuestion.clusterCenter
			return { x: bounds.center.x, y: bounds.center.y }
		},
		[agent.editor]
	)

	const placeQuestionFlowerQuestion = useCallback(
		(turn: AssemblyAiTurnMessage) => {
			const transcript = turn.transcript?.trim()
			if (!transcript) return

			const speakerLabel = turn.speaker ?? turn.speaker_id ?? 'Speaker'
			const center = getQuestionClusterCenter()
			const questionLabel = formatQuestionLabel(transcript)
			const questionNote = truncateText(
				`${speakerLabel} asked: ${normalizeText(transcript)}`,
				220
			)
			const questionId = createShapeId()

			const questionShape = applyAiStyle({
				id: questionId,
				type: 'geo',
				x: center.x - QUESTION_WIDTH / 2,
				y: center.y - QUESTION_HEIGHT / 2,
				props: {
					geo: 'ellipse',
					w: QUESTION_WIDTH,
					h: QUESTION_HEIGHT,
					dash: 'draw',
					color: 'yellow',
					fill: 'solid',
					size: 's',
					font: 'draw',
					align: 'middle',
					verticalAlign: 'middle',
					richText: toRichText(questionLabel),
				},
				meta: sanitizeShapeMeta({
					note: questionNote,
					kind: 'concept-node',
					nodeRole: 'question',
				}),
			} as TLShape)

			agent.editor.store.mergeRemoteChanges(() => {
				agent.editor.createShape(questionShape)
			})

			activeQuestionRef.current = {
				shapeId: questionId,
				label: questionLabel,
				clusterCenter: center,
				responseCount: 0,
				lastResponseShapeId: null,
			}
			setActiveQuestionLabel(questionLabel)
			setLastTurnSummary(`Question (${speakerLabel}): ${questionLabel}`)
		},
		[agent.editor, getQuestionClusterCenter]
	)

	const placeQuestionFlowerResponse = useCallback(
		(turn: AssemblyAiTurnMessage) => {
			const transcript = turn.transcript?.trim()
			if (!transcript) return

			const activeQuestion = activeQuestionRef.current
			if (!activeQuestion) {
				const speakerLabel = turn.speaker ?? turn.speaker_id ?? 'Speaker'
				setLastTurnSummary(`Waiting for a question node before mapping responses. (${speakerLabel})`)
				return
			}

			const questionShape = agent.editor.getShape(activeQuestion.shapeId)
			if (!questionShape) {
				activeQuestionRef.current = null
				setActiveQuestionLabel('')
				setLastTurnSummary('Active question was removed. Waiting for a new question.')
				return
			}

			const speakerLabel = turn.speaker ?? turn.speaker_id ?? 'Speaker'
			const responseIndex = activeQuestion.responseCount
			activeQuestion.responseCount += 1

			const questionCenter = getCurrentQuestionCenter(activeQuestion)
			const responseCenter = getFlowerResponseCenter(questionCenter, responseIndex)

			const responseLabel = truncateText(
				`${speakerLabel}: ${normalizeText(transcript)}`,
				120
			)
			const responseNote = truncateText(normalizeText(transcript), 220)
			const responseShapeId = createShapeId()
			const primaryEdgeId = createShapeId()

			const responseShape = applyAiStyle({
				id: responseShapeId,
				type: 'geo',
				x: responseCenter.x - RESPONSE_WIDTH / 2,
				y: responseCenter.y - RESPONSE_HEIGHT / 2,
				props: {
					geo: 'rectangle',
					w: RESPONSE_WIDTH,
					h: RESPONSE_HEIGHT,
					dash: 'draw',
					color: 'yellow',
					fill: 'solid',
					size: 's',
					font: 'draw',
					align: 'middle',
					verticalAlign: 'middle',
					richText: toRichText(responseLabel),
				},
				meta: sanitizeShapeMeta({
					note: responseNote,
					kind: 'concept-node',
					nodeRole: 'response',
					questionShapeId: activeQuestion.shapeId,
				}),
			} as TLShape)

			const edgeShapes: TLShape[] = [
				createResponseEdgeShape({
					shapeId: primaryEdgeId,
					start: responseCenter,
					end: questionCenter,
					fromShapeId: responseShapeId,
					toShapeId: activeQuestion.shapeId,
					label: FLOWER_EDGE_LABEL,
					nodeRole: 'response-to-question',
				}),
			]

			const previousResponseId = activeQuestion.lastResponseShapeId
			if (previousResponseId && isLikelyReplyToPreviousResponse(transcript)) {
				const previousResponseShape = agent.editor.getShape(previousResponseId)
				const previousResponseBounds = previousResponseShape
					? agent.editor.getShapePageBounds(previousResponseShape)
					: null
				if (previousResponseBounds) {
					const chainEdgeId = createShapeId()
					edgeShapes.push(
						createResponseEdgeShape({
							shapeId: chainEdgeId,
							start: responseCenter,
							end: {
								x: previousResponseBounds.center.x,
								y: previousResponseBounds.center.y,
							},
							fromShapeId: responseShapeId,
							toShapeId: previousResponseId,
							label: 'builds on',
							nodeRole: 'response-to-response',
						})
					)
				}
			}

			agent.editor.store.mergeRemoteChanges(() => {
				agent.editor.createShape(responseShape)
				agent.editor.createShapes(edgeShapes)
			})

			activeQuestion.lastResponseShapeId = responseShapeId
			setLastTurnSummary(`Response (${speakerLabel}) mapped to: ${activeQuestion.label}`)
		},
		[agent.editor, getCurrentQuestionCenter]
	)

	const queueTurnAsQuestionFlower = useCallback(
		(turn: AssemblyAiTurnMessage) => {
			const transcript = turn.transcript?.trim()
			if (!transcript) return

			const turnId =
				turn.id ??
				(typeof turn.turn_order === 'number'
					? `turn-${turn.turn_order}`
					: `turn-${Date.now()}-${transcript.slice(0, 20)}`)

			if (processedTurnIdsRef.current.has(turnId)) return
			processedTurnIdsRef.current.add(turnId)

			if (isQuestionTranscript(transcript)) {
				placeQuestionFlowerQuestion(turn)
				return
			}
			placeQuestionFlowerResponse(turn)
		},
		[placeQuestionFlowerQuestion, placeQuestionFlowerResponse]
	)

	const queueTurnAsNotecard = useCallback(
		(turn: AssemblyAiTurnMessage) => {
			const transcript = turn.transcript?.trim()
			if (!transcript) return

			const turnId =
				turn.id ??
				(typeof turn.turn_order === 'number'
					? `turn-${turn.turn_order}`
					: `turn-${Date.now()}-${transcript.slice(0, 20)}`)

			if (processedTurnIdsRef.current.has(turnId)) return
			processedTurnIdsRef.current.add(turnId)

			const speakerLabel = turn.speaker ?? turn.speaker_id ?? 'Speaker'
			const bounds = getPlacementBounds()

			setLastTurnSummary(`${speakerLabel}: ${transcript}`)

			agent.schedule({
				source: 'self',
				bounds,
				contextItems: agent.context.getItems(),
				userMessages: [`Auto note (${speakerLabel})`],
				agentMessages: [
					[
						'You are processing one finalized speaker turn from a live discussion.',
						'Create exactly one new notecard as a concept node.',
						'Required action constraints:',
						'- Use exactly one create-concept-node action.',
						'- Do not create edges.',
						'- Do not move, update, or delete existing shapes.',
						'- Place the card fully within the provided viewport bounds.',
						'- Keep label concise (max 120 characters), capturing the single strongest point.',
						'- Optional note may include one brief supporting detail (max 220 characters).',
						`Speaker: ${speakerLabel}`,
						`Turn transcript: """${transcript}"""`,
					].join('\n'),
				],
			})
		},
		[agent, getPlacementBounds]
	)

	const handleSocketMessage = useCallback(
		(raw: string) => {
			let message: AssemblyAiTurnMessage
			try {
				message = JSON.parse(raw) as AssemblyAiTurnMessage
			} catch (_e) {
				return
			}

			if (message.type === 'Turn' && typeof message.transcript === 'string') {
				if (message.end_of_turn || message.turn_is_formatted) {
					setLiveTranscript('')
					if (service === 'question-flowers') {
						queueTurnAsQuestionFlower(message)
					} else {
						queueTurnAsNotecard(message)
					}
				} else {
					setLiveTranscript(message.transcript)
				}
			}
		},
		[queueTurnAsNotecard, queueTurnAsQuestionFlower, service]
	)

	const connect = useCallback(
		async (attempt = 0) => {
			try {
				setStatus(attempt > 0 ? 'reconnecting' : 'connecting')
				setError(null)

				const tokenRes = await fetch('/assemblyai/token')
				if (!tokenRes.ok) {
					throw new Error(`Token request failed (${tokenRes.status})`)
				}
				const tokenData = (await tokenRes.json()) as { token?: string }
				if (!tokenData.token) {
					throw new Error('Token response was empty.')
				}

				const stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
				})
				mediaStreamRef.current = stream

				const audioContext = new AudioContext()
				audioContextRef.current = audioContext

				const ws = new WebSocket(
					`wss://streaming.assemblyai.com/v3/ws?sample_rate=${audioContext.sampleRate}&encoding=pcm_s16le&format_turns=true&token=${encodeURIComponent(tokenData.token)}`
				)
				wsRef.current = ws

					ws.onopen = () => {
						const source = audioContext.createMediaStreamSource(stream)
						sourceNodeRef.current = source

						const processor = audioContext.createScriptProcessor(4096, 1, 1)
						processorNodeRef.current = processor
						const silentGain = audioContext.createGain()
						silentGain.gain.value = 0

						processor.onaudioprocess = (event: AudioProcessingEvent) => {
							if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
							const input = event.inputBuffer.getChannelData(0)
						const pcm = new Int16Array(input.length)
						for (let i = 0; i < input.length; i++) {
							const s = Math.max(-1, Math.min(1, input[i]))
							pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
						}
						wsRef.current.send(pcm.buffer)
						}

						source.connect(processor)
						processor.connect(silentGain)
						silentGain.connect(audioContext.destination)

					setIsListening(true)
					setStatus('listening')
				}

				ws.onmessage = (event) => {
					if (typeof event.data !== 'string') return
					handleSocketMessage(event.data)
				}

				ws.onerror = () => {
					setError('AssemblyAI connection encountered an error.')
				}

				ws.onclose = () => {
					clearAudioPipeline()
					wsRef.current = null
					setIsListening(false)
					if (!shouldReconnectRef.current) {
						setStatus('idle')
						return
					}

					const nextAttempt = attempt + 1
					const timeout = Math.min(1000 * 2 ** Math.min(nextAttempt, 5), 15000)
					reconnectTimeoutRef.current = window.setTimeout(() => {
						void connect(nextAttempt)
					}, timeout)
				}
			} catch (e) {
				clearAudioPipeline()
				setIsListening(false)
				setStatus('error')
				setError(e instanceof Error ? e.message : 'Could not start live transcription.')
				shouldReconnectRef.current = false
			}
		},
		[clearAudioPipeline, handleSocketMessage]
	)

	const start = useCallback(async () => {
		if (isListening || status === 'connecting' || status === 'reconnecting') return
		shouldReconnectRef.current = true
		await connect(0)
	}, [connect, isListening, status])

	useEffect(() => {
		return () => stop()
	}, [stop])

	return {
		status,
		isListening,
		error,
		liveTranscript,
		lastTurnSummary,
		activeQuestionLabel,
		start,
		stop,
	}
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	const safeMax = Math.max(4, maxChars)
	return `${text.slice(0, safeMax - 3).trimEnd()}...`
}

function formatQuestionLabel(transcript: string): string {
	const compact = normalizeText(transcript)
	const label = compact.endsWith('?') ? compact : `${compact}?`
	return truncateText(label, 120)
}

function isQuestionTranscript(transcript: string): boolean {
	const compact = normalizeText(transcript)
	if (!compact) return false
	if (compact.includes('?')) return true

	const lowered = compact.toLowerCase()
	return /^(who|what|when|where|why|how|is|are|am|do|does|did|can|could|should|would|will|might|may|which)\b/.test(
		lowered
	)
}

function getFlowerResponseCenter(questionCenter: { x: number; y: number }, responseIndex: number) {
	const petalsPerRing = 6
	const ring = Math.floor(responseIndex / petalsPerRing)
	const ringIndex = responseIndex % petalsPerRing
	const angle = (ringIndex / petalsPerRing) * Math.PI * 2 - Math.PI / 2
	const radius = 190 + ring * 110
	return {
		x: questionCenter.x + Math.cos(angle) * radius,
		y: questionCenter.y + Math.sin(angle) * radius,
	}
}

function isLikelyReplyToPreviousResponse(transcript: string): boolean {
	const lowered = normalizeText(transcript).toLowerCase()
	return /\b(i agree|i disagree|building on|to your point|responding to|in response|that point|following up|as you said|you said)\b/.test(
		lowered
	)
}

function createResponseEdgeShape({
	shapeId,
	start,
	end,
	fromShapeId,
	toShapeId,
	label,
	nodeRole,
}: {
	shapeId: TLShapeId
	start: { x: number; y: number }
	end: { x: number; y: number }
	fromShapeId: TLShapeId
	toShapeId: TLShapeId
	label: string
	nodeRole: 'response-to-question' | 'response-to-response'
}) {
	const x = Math.min(start.x, end.x)
	const y = Math.min(start.y, end.y)

	return applyAiStyle({
		id: shapeId,
		type: 'arrow',
		x,
		y,
		props: {
			start: { x: start.x - x, y: start.y - y },
			end: { x: end.x - x, y: end.y - y },
			arrowheadStart: 'none',
			arrowheadEnd: 'arrow',
			bend: 0,
			dash: 'draw',
			color: 'yellow',
			labelColor: 'yellow',
			fill: 'none',
			font: 'draw',
			size: 's',
			richText: toRichText(label),
		},
		meta: sanitizeShapeMeta({
			note: label,
			kind: 'relationship-edge',
			nodeRole,
			fromShapeId,
			toShapeId,
		}),
	} as TLShape)
}
