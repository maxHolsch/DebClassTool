import { createShapeId, TLShape, TLShapeId, toRichText } from 'tldraw'
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
					richText: toRichText(action.label),
				},
				meta,
			} as TLShape)

			this.editor.createShape(shape)
		}
	}
)
