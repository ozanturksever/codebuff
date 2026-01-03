import { useChatStore } from '../state/chat-store'
import { getSystemMessage } from '../utils/message-history'
import { getCodebuffClient } from '../utils/codebuff-client'
import { loadAgentDefinitions } from '../utils/local-agent-registry'

import type { PostUserMessageFn } from '../types/contracts/send-message'
import type { ChatMessage } from '../types/chat'

/**
 * Extracts a text representation of the conversation from chat messages.
 */
function extractConversationText(messages: ChatMessage[]): string {
  const lines: string[] = []

  for (const msg of messages) {
    if (msg.variant === 'user') {
      lines.push(`User: ${msg.content}`)
    } else if (msg.variant === 'ai') {
      // Extract text content from AI messages
      if (msg.blocks) {
        for (const block of msg.blocks) {
          if (block.type === 'text' && block.content) {
            lines.push(`Assistant: ${block.content.slice(0, 1000)}`)
          }
          if (block.type === 'tool' && block.toolName === 'write_todos') {
            const todos = block.input?.todos as
              | Array<{ task: string; completed: boolean }>
              | undefined
            if (todos && todos.length > 0) {
              lines.push(
                `Todos: ${todos.map((t) => `[${t.completed ? 'x' : ' '}] ${t.task}`).join(', ')}`,
              )
            }
          }
        }
      } else if (msg.content) {
        lines.push(`Assistant: ${msg.content.slice(0, 1000)}`)
      }
    }
  }

  // Limit total size to avoid exceeding context limits
  const text = lines.join('\n')
  if (text.length > 50000) {
    return text.slice(-50000)
  }
  return text
}

/**
 * Handles the /handoff command.
 * Summarizes the current conversation and prepares for a fresh start.
 */
export async function handleHandoffCommand({
  clearMessages,
}: {
  clearMessages: () => void
}): Promise<{
  postUserMessage: PostUserMessageFn
  summary?: string
}> {
  const { messages, setInputValue, setRunState } = useChatStore.getState()

  if (messages.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('No conversation to summarize.'),
    ]
    return { postUserMessage }
  }

  // Extract conversation text
  const conversationText = extractConversationText(messages)

  if (!conversationText.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('No meaningful content to summarize.'),
    ]
    return { postUserMessage }
  }

  try {
    // Get the SDK client
    const client = await getCodebuffClient()

    if (!client) {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(
          'Unable to generate summary: not authenticated. Please log in first.',
        ),
      ]
      return { postUserMessage }
    }

    // Load agent definitions to find the handoff-summarizer
    const agentDefinitions = loadAgentDefinitions()
    const summarizerAgent = agentDefinitions.find(
      (a) => a.id === 'handoff-summarizer',
    )

    // Use the summarizer agent or fall back to a direct model call
    const agentToUse = summarizerAgent ?? 'handoff-summarizer'

    // Run the summarizer
    const runState = await client.run({
      agent: agentToUse,
      prompt: `Summarize this conversation for handoff:\n\n${conversationText}`,
    })

    // Extract the summary from the output
    let summary = ''
    if (runState.output && typeof runState.output === 'object') {
      const output = runState.output as { summary?: string }
      summary = output.summary ?? ''
    }

    // If structured output didn't work, try extracting from message content
    if (!summary && runState.output && 'message' in runState.output) {
      summary = String(runState.output.message ?? '')
    }

    if (!summary) {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(
          'Failed to generate summary. Please try again or use /new to start fresh.',
        ),
      ]
      return { postUserMessage }
    }

    // Clear the chat and run state
    clearMessages()
    useChatStore.getState().setMessages([])
    setRunState(null)

    // Set the input to the summary
    setInputValue({
      text: summary,
      cursorPosition: summary.length,
      lastEditDueToNav: false,
    })

    // Return empty post message since we've handled everything
    const postUserMessage: PostUserMessageFn = (prev) => prev
    return { postUserMessage, summary }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`Failed to generate handoff summary: ${errorMessage}`),
    ]
    return { postUserMessage }
  }
}
