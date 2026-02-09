import { TLShape } from 'tldraw'
import { DeliberatoriumColor } from './storage'

export interface DeliberatoriumShapeMeta {
	source: 'ai' | 'human'
	author: string
	timestamp: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && (value.constructor === Object || Object.getPrototypeOf(value) === null)
}

function toSerializableJsonValue(value: unknown): unknown {
	if (value == null) return null
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
	if (Array.isArray(value)) {
		return value.map((item) => toSerializableJsonValue(item))
	}
	if (isPlainObject(value)) {
		const result: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined) continue
			result[key] = toSerializableJsonValue(item)
		}
		return result
	}
	return String(value)
}

export function sanitizeShapeMeta(meta: unknown): Record<string, unknown> {
	if (!isPlainObject(meta)) return {}
	return toSerializableJsonValue(meta) as Record<string, unknown>
}

export function createAiMeta(): DeliberatoriumShapeMeta {
	return {
		source: 'ai',
		author: 'Deliberatorium Agent',
		timestamp: Date.now(),
	}
}

export function createHumanMeta(name: string): DeliberatoriumShapeMeta {
	return {
		source: 'human',
		author: name,
		timestamp: Date.now(),
	}
}

export function applyAiStyle(shape: TLShape): TLShape {
	if ('props' in shape && shape.props && typeof shape.props === 'object') {
		const props = { ...(shape.props as Record<string, unknown>) }
		if ('color' in props) props.color = 'yellow'
		if ('fill' in props && (shape.type === 'geo' || shape.type === 'note')) props.fill = 'solid'
		shape = { ...shape, props } as TLShape
	}

	return {
		...shape,
		meta: {
			...sanitizeShapeMeta(shape.meta),
			...createAiMeta(),
		},
	}
}

export function applyHumanStyle(shape: TLShape, color: DeliberatoriumColor, author: string): TLShape {
	const next = { ...shape } as TLShape

	if ('props' in next && next.props && typeof next.props === 'object') {
		const props = { ...(next.props as Record<string, unknown>) }
		if ('color' in props) props.color = color
		next.props = props as TLShape['props']
	}

	next.meta = {
		...sanitizeShapeMeta(next.meta),
		...createHumanMeta(author),
	}

	return next
}
