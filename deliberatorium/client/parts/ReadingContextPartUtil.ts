import { ReadingContextPart } from '../../shared/schema/PromptPartDefinitions'
import { loadReadings } from '../deliberatorium/storage'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

const MAX_CONTEXT_ITEMS = 8
const MAX_READING_CHARS = 3500

export const ReadingContextPartUtil = registerPromptPartUtil(
	class ReadingContextPartUtil extends PromptPartUtil<ReadingContextPart> {
		static override type = 'readingContext' as const

		override getPart(): ReadingContextPart {
			const readings = loadReadings()
				.slice(-MAX_CONTEXT_ITEMS)
				.reverse()
				.map((reading) => ({
					id: reading.id,
					title: reading.title,
					createdAt: reading.createdAt,
					content: reading.content.slice(0, MAX_READING_CHARS),
				}))

			return {
				type: 'readingContext',
				readings,
			}
		}
	}
)
