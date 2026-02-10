import { useCallback, useEffect, useRef, useState } from 'react'
import { BoxModel } from 'tldraw'
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

interface UseAssemblyAiAgentNotecardsResult {
	status: AssemblyAiStatus
	isListening: boolean
	error: string | null
	liveTranscript: string
	lastTurnSummary: string
	start: () => Promise<void>
	stop: () => void
}

const CARD_WIDTH = 320
const CARD_HEIGHT = 140
const CARD_GAP = 24

export function useAssemblyAiAgentNotecards(
	agent: TldrawAgent
): UseAssemblyAiAgentNotecardsResult {
	const [status, setStatus] = useState<AssemblyAiStatus>('idle')
	const [isListening, setIsListening] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [liveTranscript, setLiveTranscript] = useState('')
	const [lastTurnSummary, setLastTurnSummary] = useState('')

	const processedTurnIdsRef = useRef(new Set<string>())
	const slotRef = useRef(0)
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
					queueTurnAsNotecard(message)
				} else {
					setLiveTranscript(message.transcript)
				}
			}
		},
		[queueTurnAsNotecard]
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
		start,
		stop,
	}
}
