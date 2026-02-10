import { createShapeId, TLShape, TLShapeId, toRichText } from 'tldraw'
import { CreateRelationshipEdgeAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'
import { applyAiStyle, sanitizeShapeMeta } from '../deliberatorium/shapeMeta'

export const CreateRelationshipEdgeActionUtil = registerActionUtil(
	class CreateRelationshipEdgeActionUtil extends AgentActionUtil<CreateRelationshipEdgeAction> {
		static override type = 'create-relationship-edge' as const

		override getInfo(action: Streaming<CreateRelationshipEdgeAction>) {
			return {
				icon: 'pencil' as const,
				description: action.intent ?? 'Create relationship edge',
			}
		}

		override sanitizeAction(action: Streaming<CreateRelationshipEdgeAction>, helpers: AgentHelpers) {
			action.fromShapeId = helpers.ensureShapeIdExists(action.fromShapeId)
			action.toShapeId = helpers.ensureShapeIdExists(action.toShapeId)
			if (action.shapeId) {
				action.shapeId = helpers.ensureShapeIdIsUnique(action.shapeId)
			}
			action.bend = helpers.ensureValueIsNumber(action.bend) ?? 0
			return action
		}

		override applyAction(action: Streaming<CreateRelationshipEdgeAction>) {
			if (!action.complete) return

			const fromId = `shape:${action.fromShapeId}` as TLShapeId
			const toId = `shape:${action.toShapeId}` as TLShapeId
			const fromShape = this.editor.getShape(fromId)
			const toShape = this.editor.getShape(toId)
			if (!fromShape || !toShape) return

			const fromBounds = this.editor.getShapePageBounds(fromShape)
			const toBounds = this.editor.getShapePageBounds(toShape)
			if (!fromBounds || !toBounds) return

			const start = { x: fromBounds.center.x, y: fromBounds.center.y }
			const end = { x: toBounds.center.x, y: toBounds.center.y }
			const x = Math.min(start.x, end.x)
			const y = Math.min(start.y, end.y)

			const shapeId = action.shapeId ? (`shape:${action.shapeId}` as TLShapeId) : createShapeId()

			const meta = sanitizeShapeMeta({
				note: typeof action.intent === 'string' ? action.intent : undefined,
				kind: 'relationship-edge',
				fromShapeId: action.fromShapeId,
				toShapeId: action.toShapeId,
			})

			const shape = applyAiStyle({
				id: shapeId,
				type: 'arrow',
				x,
				y,
				props: {
					start: { x: start.x - x, y: start.y - y },
					end: { x: end.x - x, y: end.y - y },
					arrowheadStart: 'none',
					arrowheadEnd: 'arrow',
					bend: action.bend,
					dash: 'draw',
					color: 'yellow',
					labelColor: 'yellow',
					fill: 'none',
					font: 'draw',
					size: 's',
					richText: toRichText(action.label ?? ''),
				},
				meta,
			} as TLShape)

			this.editor.createShape(shape)
		}
	}
)
