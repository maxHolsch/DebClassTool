import { FormEventHandler, useCallback, useRef } from 'react'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { TodoList } from './TodoList'
import { useAssemblyAiAgentNotecards } from './useAssemblyAiAgentNotecards'

export function ChatPanel() {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const realtimeNotes = useAssemblyAiAgentNotecards(agent)

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string

			// If the user's message is empty, just cancel the current request (if there is one)
			if (value === '') {
				agent.cancel()
				return
			}

			// Clear the chat input (context is cleared after it's captured in requestAgentActions)
			inputRef.current.value = ''

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent]
	)

	const handleNewChat = useCallback(() => {
		agent.reset()
	}, [agent])

	return (
		<div className="chat-panel tl-theme__dark">
			<div className="chat-header">
				<div className="chat-header-copy">
					<div className="chat-header-title">Agent Panel</div>
					<div className="chat-header-subtitle">Map readings, tensions, and questions</div>
				</div>
				<button className="new-chat-button" onClick={handleNewChat}>
					New Chat
				</button>
			</div>
			<div className="chat-realtime-panel">
				<div className="chat-realtime-top">
					<div>
						<div className="chat-realtime-title">Live Notecards</div>
						<div className="chat-realtime-status">Status: {realtimeNotes.status}</div>
					</div>
					{realtimeNotes.isListening ? (
						<button className="chat-realtime-button stop" onClick={realtimeNotes.stop}>
							Stop Mic
						</button>
					) : (
						<button className="chat-realtime-button start" onClick={() => void realtimeNotes.start()}>
							Start Mic
						</button>
					)}
				</div>
				{realtimeNotes.error && <div className="chat-realtime-error">{realtimeNotes.error}</div>}
				{realtimeNotes.liveTranscript && (
					<div className="chat-realtime-live">Live: {realtimeNotes.liveTranscript}</div>
				)}
				{realtimeNotes.lastTurnSummary && (
					<div className="chat-realtime-last-turn">Last turn: {realtimeNotes.lastTurnSummary}</div>
				)}
			</div>
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<TodoList agent={agent} />
				<ChatInput handleSubmit={handleSubmit} inputRef={inputRef} />
			</div>
		</div>
	)
}
