import { useCallback, useEffect, useState } from 'react'

import { useChatStore } from '../state/chat-store'
import { logger } from '../utils/logger'
import { loadSettings, saveSettings } from '../utils/settings'

import type { ChatMessage } from '../types/chat'

/**
 * Event detail for context overflow events.
 */
export interface ContextOverflowEventDetail {
  errorMessage: string
  messages: ChatMessage[]
}

/**
 * Hook to manage auto-handoff setting state.
 */
export function useAutoHandoffSetting(): {
  autoHandoff: boolean
  setAutoHandoff: (enabled: boolean) => void
} {
  const [autoHandoff, setAutoHandoffState] = useState(() => {
    const settings = loadSettings()
    // Default to true - auto-handoff is enabled by default
    return settings.autoHandoff ?? true
  })

  const setAutoHandoff = useCallback((enabled: boolean) => {
    setAutoHandoffState(enabled)
    saveSettings({ autoHandoff: enabled })
  }, [])

  return { autoHandoff, setAutoHandoff }
}

/**
 * Extract a brief summary of recent conversation for the handoff.
 * Focuses on the most recent user messages and key context.
 */
function extractConversationSummary(messages: ChatMessage[]): string {
  const recentMessages = messages.slice(-10)
  const userMessages: string[] = []
  const aiSummaries: string[] = []

  for (const msg of recentMessages) {
    if (msg.variant === 'user' && msg.content) {
      const content = msg.content.trim()
      if (content.length > 0 && content.length < 500) {
        userMessages.push(content)
      } else if (content.length >= 500) {
        userMessages.push(content.slice(0, 200) + '...')
      }
    } else if (msg.variant === 'ai' && msg.blocks) {
      // Extract text from AI messages
      for (const block of msg.blocks) {
        if (block.type === 'text' && block.content) {
          const text = block.content.trim()
          if (text.length > 0 && text.length < 300) {
            aiSummaries.push(text.slice(0, 150))
          }
        }
      }
    }
  }

  // Build a condensed summary
  const parts: string[] = []
  
  if (userMessages.length > 0) {
    const lastUserMsg = userMessages[userMessages.length - 1]
    parts.push(`Last request: ${lastUserMsg}`)
  }

  if (aiSummaries.length > 0) {
    const lastAiSummary = aiSummaries[aiSummaries.length - 1]
    parts.push(`Recent progress: ${lastAiSummary}`)
  }

  return parts.join('\n\n')
}

interface AutoHandoffProps {
  /** Whether auto-handoff is enabled */
  enabled: boolean
}

/**
 * Headless component that handles automatic handoff when context overflow errors occur.
 * 
 * When the conversation exceeds the model's token limit, this component:
 * 1. Detects the context overflow error
 * 2. Creates a summary of the conversation
 * 3. Clears the conversation history
 * 4. Sends a new message with the summary to continue
 */
export function AutoHandoff({ enabled }: AutoHandoffProps): null {
  const reset = useChatStore((state) => state.reset)

  const handleContextOverflow = useCallback(
    (event: CustomEvent<ContextOverflowEventDetail>) => {
      if (!enabled) {
        logger.debug('Auto-handoff disabled, ignoring context overflow')
        return
      }

      const { errorMessage, messages: overflowMessages } = event.detail

      logger.info(
        { errorMessage, messageCount: overflowMessages.length },
        'Context overflow detected, initiating auto-handoff',
      )

      // Extract summary from the conversation
      const summary = extractConversationSummary(overflowMessages)

      // Build the handoff prompt
      const handoffPrompt = summary.length > 0
        ? `Continue from where we left off. Context from previous conversation:\n\n${summary}\n\nPlease continue with the task.`
        : 'Continue with the previous task. The conversation context was cleared due to length limits.'

      // Reset the conversation state
      reset()

      // Small delay to ensure state is cleared before sending new message
      setTimeout(() => {
        // Dispatch event to send the handoff prompt as a new message
        const sendEvent = new CustomEvent('codebuff:auto-handoff-continue', {
          detail: {
            prompt: handoffPrompt,
          },
        })
        globalThis.dispatchEvent(sendEvent)
      }, 100)
    },
    [enabled, reset],
  )

  useEffect(() => {
    const handler = (event: Event) => {
      handleContextOverflow(event as CustomEvent<ContextOverflowEventDetail>)
    }

    globalThis.addEventListener('codebuff:context-overflow', handler)

    return () => {
      globalThis.removeEventListener('codebuff:context-overflow', handler)
    }
  }, [handleContextOverflow])

  return null
}
