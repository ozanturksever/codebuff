import { useChatStore } from '../state/chat-store'
import { getSystemMessage } from '../utils/message-history'

import type { PostUserMessageFn } from '../types/contracts/send-message'
import type { ChatMessage } from '../types/chat'

/**
 * Extracts a text representation of the conversation from chat messages.
 * Used to generate a handoff prompt.
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
            lines.push(`Assistant: ${block.content.slice(0, 500)}`)
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
        lines.push(`Assistant: ${msg.content.slice(0, 500)}`)
      }
    }
  }

  // Limit total size
  const text = lines.join('\n')
  if (text.length > 10000) {
    return text.slice(-10000)
  }
  return text
}

/**
 * Generates a handoff prompt from the conversation context.
 */
function generateHandoffPrompt(conversationText: string): string {
  return `Continue from previous session:\n${conversationText}`
}

/**
 * Handles the /handoff command.
 * Generates a handoff prompt and injects it into the input.
 * If userPrompt is provided, it's combined with the generated handoff prompt.
 */
export function handleHandoffCommand({
  clearMessages,
  userPrompt,
}: {
  clearMessages: () => void
  userPrompt?: string
}): {
  postUserMessage: PostUserMessageFn
  handoffPrompt?: string
} {
  const { messages, setInputValue, setRunState } = useChatStore.getState()

  if (messages.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('No conversation to create handoff from.'),
    ]
    return { postUserMessage }
  }

  // Extract conversation text
  const conversationText = extractConversationText(messages)

  if (!conversationText.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('No meaningful content to create handoff from.'),
    ]
    return { postUserMessage }
  }

  // Generate the handoff prompt
  let handoffPrompt = generateHandoffPrompt(conversationText)

  // If user provided a prompt, combine them
  if (userPrompt?.trim()) {
    handoffPrompt = `${userPrompt.trim()}\n\n${handoffPrompt}`
  }

  // Clear the chat and run state
  clearMessages()
  useChatStore.getState().setMessages([])
  setRunState(null)

  // Set the input to the handoff prompt
  setInputValue({
    text: handoffPrompt,
    cursorPosition: handoffPrompt.length,
    lastEditDueToNav: false,
  })

  // Return empty post message since we've handled everything
  const postUserMessage: PostUserMessageFn = (prev) => prev
  return { postUserMessage, handoffPrompt }
}
