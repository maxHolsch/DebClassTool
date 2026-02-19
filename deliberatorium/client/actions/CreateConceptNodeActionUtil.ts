import { createShapeId, Editor, TLShape, TLShapeId, toRichText } from 'tldraw'
import { CreateConceptNodeAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'
import { applyAiStyle, sanitizeShapeMeta } from '../deliberatorium/shapeMeta'

export const CreateConceptNodeActionUtil = registerActionUtil(
	class CreateConceptNodeActionUtil extends AgentActionUtil<CreateConceptNodeAction> {
		static override type = 'create-concept-node' as const

		override getInfo(action: Streaming<CreateConceptNodeAction>) {
			return {
				icon: 'pencil' as const,
				description: action.intent ?? 'Create a concept node',
			}
		}

		override sanitizeAction(action: Streaming<CreateConceptNodeAction>, helpers: AgentHelpers) {
			if (action.shapeId) {
				action.shapeId = helpers.ensureShapeIdIsUnique(action.shapeId)
			}
			action.w = Math.max(180, helpers.ensureValueIsNumber(action.w) ?? 240)
			action.h = Math.max(100, helpers.ensureValueIsNumber(action.h) ?? 140)
			action.x = helpers.ensureValueIsNumber(action.x) ?? 0
			action.y = helpers.ensureValueIsNumber(action.y) ?? 0
			return action
		}

		override applyAction(action: Streaming<CreateConceptNodeAction>) {
			if (!action.complete) return

			const shapeId = action.shapeId ? (`shape:${action.shapeId}` as TLShapeId) : createShapeId()
			const label = action.label ?? ''
			const meta = sanitizeShapeMeta({
				note:
					typeof action.note === 'string'
						? action.note
						: typeof action.intent === 'string'
							? action.intent
							: undefined,
				kind: 'concept-node',
			})

			const shape = applyAiStyle({
				id: shapeId,
				type: 'geo',
				x: action.x,
				y: action.y,
				opacity: TYPED_REVEAL_START_OPACITY,
				props: {
					geo: 'rectangle',
					w: action.w,
					h: action.h,
					dash: 'draw',
					color: 'yellow',
					fill: 'solid',
					size: 's',
					font: 'draw',
					align: 'middle',
					verticalAlign: 'middle',
					richText: toRichText(''),
				},
				meta,
			} as TLShape)

			this.editor.createShape(shape)
			runTypedReveal(this.editor, shapeId, label)
		}
	}
)

const TYPED_REVEAL_START_OPACITY = 0.04
const MIN_TYPING_DURATION_MS = 900
const MAX_TYPING_DURATION_MS = 7200
const TYPING_SPEED_MULTIPLIER = 0.75

type TypingFrame = {
	delayMs: number
	text: string
	progress: number
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

function runTypedReveal(editor: Editor, shapeId: TLShapeId, text: string) {
	if (typeof window === 'undefined') return

	const frames = buildTypingFrames(text, String(shapeId))
	if (frames.length === 0) {
		editor.store.mergeRemoteChanges(() => {
			editor.updateShape({
				id: shapeId,
				type: 'geo',
				opacity: 1,
			} as Pick<TLShape, 'id' | 'type' | 'opacity'>)
		})
		return
	}

	for (const frame of frames) {
		window.setTimeout(() => {
			const shape = editor.getShape(shapeId)
			if (!shape) return

			// Mark animation-only updates as remote so they don't pollute user history tracking.
			editor.store.mergeRemoteChanges(() => {
				editor.updateShape({
					id: shape.id,
					type: shape.type,
					opacity: TYPED_REVEAL_START_OPACITY + frame.progress * (1 - TYPED_REVEAL_START_OPACITY),
					props: {
						richText: toRichText(frame.text),
					},
				} as Pick<TLShape, 'id' | 'type' | 'opacity' | 'props'>)
			})
		}, frame.delayMs)
	}
}

function buildTypingFrames(text: string, seed: string): TypingFrame[] {
	const chars = Array.from(text)
	const totalChars = chars.length
	if (totalChars === 0) return []

	const rng = createSeededRandom(`${seed}:${text}`)
	let elapsedMs = 0
	let typedText = ''
	let correctlyTypedChars = 0
	let typoCount = 0
	const maxTypos = Math.max(1, Math.floor(totalChars * 0.1))
	const frames: TypingFrame[] = []

	for (let i = 0; i < totalChars; i++) {
		const char = chars[i]
		const prevChar = i > 0 ? chars[i - 1] : ''
		const keyDelayMs = getKeystrokeDelayMs(char, prevChar, rng)
		const shouldTypo = /[A-Za-z]/.test(char) && typoCount < maxTypos && rng() < 0.09

		if (shouldTypo) {
			const typoChar = getTypoChar(char, rng)

			typedText += typoChar
			elapsedMs += keyDelayMs
			frames.push({
				delayMs: elapsedMs,
				text: typedText,
				progress: correctlyTypedChars / totalChars,
			})

			elapsedMs += randomInt(rng, 70, 170)
			typedText = typedText.slice(0, -1)
			frames.push({
				delayMs: elapsedMs,
				text: typedText,
				progress: correctlyTypedChars / totalChars,
			})

			elapsedMs += randomInt(rng, 50, 130)
			typedText += char
			correctlyTypedChars += 1
			typoCount += 1
			frames.push({
				delayMs: elapsedMs,
				text: typedText,
				progress: correctlyTypedChars / totalChars,
			})
			continue
		}

		typedText += char
		correctlyTypedChars += 1
		elapsedMs += keyDelayMs
		frames.push({
			delayMs: elapsedMs,
			text: typedText,
			progress: correctlyTypedChars / totalChars,
		})
	}

	return normalizeTypingTimeline(frames)
}

function normalizeTypingTimeline(frames: TypingFrame[]): TypingFrame[] {
	if (frames.length === 0) return frames
	const finalDelayMs = frames[frames.length - 1].delayMs
	if (finalDelayMs <= 0) return frames

	const scaledTotal = clamp(
		finalDelayMs * TYPING_SPEED_MULTIPLIER,
		MIN_TYPING_DURATION_MS * TYPING_SPEED_MULTIPLIER,
		MAX_TYPING_DURATION_MS * TYPING_SPEED_MULTIPLIER
	)
	const scale = scaledTotal / finalDelayMs
	if (Math.abs(scale - 1) < 0.01) return frames

	let prevDelay = 0
	return frames.map((frame) => {
		const nextDelay = Math.max(prevDelay + 1, Math.round(frame.delayMs * scale))
		prevDelay = nextDelay
		return { ...frame, delayMs: nextDelay }
	})
}

function getKeystrokeDelayMs(char: string, prevChar: string, rng: () => number): number {
	let delayMs = randomInt(rng, 45, 140)

	// People often pause slightly between words, after punctuation, and at line breaks.
	if (prevChar === ' ') delayMs += randomInt(rng, 70, 220)
	if (char === ' ') delayMs += randomInt(rng, 90, 180)
	if (/[,.!?;:]/.test(char)) delayMs += randomInt(rng, 120, 260)
	if (char === '\n') delayMs += randomInt(rng, 260, 420)
	if (rng() < 0.03) delayMs += randomInt(rng, 220, 480)

	return delayMs
}

function getTypoChar(char: string, rng: () => number): string {
	const lowerChar = char.toLowerCase()
	const pool = KEYBOARD_NEIGHBORS[lowerChar] ?? FALLBACK_TYPO_CHARS
	const typo = pool[randomInt(rng, 0, pool.length - 1)] ?? lowerChar
	return char === lowerChar ? typo : typo.toUpperCase()
}

function randomInt(rng: () => number, min: number, max: number): number {
	return Math.floor(rng() * (max - min + 1)) + min
}

function createSeededRandom(seedText: string): () => number {
	let seed = 2166136261
	for (const char of seedText) {
		seed ^= char.charCodeAt(0)
		seed = Math.imul(seed, 16777619)
	}

	return () => {
		seed += 0x6d2b79f5
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const FALLBACK_TYPO_CHARS = ['e', 'a', 'i', 'o', 'n', 'r', 's', 't'] as const

const KEYBOARD_NEIGHBORS: Record<string, readonly string[]> = {
	a: ['s', 'q', 'w', 'z'],
	b: ['v', 'g', 'h', 'n'],
	c: ['x', 'd', 'f', 'v'],
	d: ['s', 'e', 'r', 'f', 'c', 'x'],
	e: ['w', 's', 'd', 'r'],
	f: ['d', 'r', 't', 'g', 'v', 'c'],
	g: ['f', 't', 'y', 'h', 'b', 'v'],
	h: ['g', 'y', 'u', 'j', 'n', 'b'],
	i: ['u', 'j', 'k', 'o'],
	j: ['h', 'u', 'i', 'k', 'm', 'n'],
	k: ['j', 'i', 'o', 'l', 'm'],
	l: ['k', 'o', 'p'],
	m: ['n', 'j', 'k'],
	n: ['b', 'h', 'j', 'm'],
	o: ['i', 'k', 'l', 'p'],
	p: ['o', 'l'],
	q: ['w', 'a'],
	r: ['e', 'd', 'f', 't'],
	s: ['a', 'w', 'e', 'd', 'x', 'z'],
	t: ['r', 'f', 'g', 'y'],
	u: ['y', 'h', 'j', 'i'],
	v: ['c', 'f', 'g', 'b'],
	w: ['q', 'a', 's', 'e'],
	x: ['z', 's', 'd', 'c'],
	y: ['t', 'g', 'h', 'u'],
	z: ['a', 's', 'x'],
}
