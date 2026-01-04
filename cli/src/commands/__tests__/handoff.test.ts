import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

import { useChatStore } from '../../state/chat-store'
import { handleHandoffCommand } from '../handoff'

import type { ChatMessage } from '../../types/chat'

describe('handleHandoffCommand', () => {
  let clearMessages: ReturnType<typeof mock>

  beforeEach(() => {
    clearMessages = mock(() => {})
    // Reset the chat store
    useChatStore.setState({
      messages: [],
      runState: null,
    })
  })

  afterEach(() => {
    mock.restore()
  })

  describe('empty conversation handling', () => {
    test('returns error message when no messages exist', () => {
      useChatStore.setState({ messages: [] })

      const { postUserMessage, handoffPrompt } = handleHandoffCommand({
        clearMessages,
      })

      expect(handoffPrompt).toBeUndefined()
      
      const messages = postUserMessage([])
      expect(messages.length).toBe(1)
      expect(messages[0]?.content).toContain('No conversation to create handoff from')
    })

    test('does not clear messages when conversation is empty', () => {
      useChatStore.setState({ messages: [] })

      handleHandoffCommand({ clearMessages })

      expect(clearMessages).not.toHaveBeenCalled()
    })
  })

  describe('conversation extraction', () => {
    test('extracts user messages', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello, please help me',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      expect(handoffPrompt).toContain('User: Hello, please help me')
    })

    test('extracts AI text block content', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Help me',
          timestamp: new Date().toISOString(),
        },
        {
          id: '2',
          variant: 'ai',
          content: '',
          timestamp: new Date().toISOString(),
          blocks: [
            {
              type: 'text',
              content: 'Sure, I can help you with that.',
            },
          ],
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      expect(handoffPrompt).toContain('User: Help me')
      expect(handoffPrompt).toContain('Assistant: Sure, I can help you with that.')
    })

    test('extracts todos from write_todos tool blocks', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Create a plan',
          timestamp: new Date().toISOString(),
        },
        {
          id: '2',
          variant: 'ai',
          content: '',
          timestamp: new Date().toISOString(),
          blocks: [
            {
              type: 'tool',
              toolName: 'write_todos',
              toolCallId: 'tc1',
              input: {
                todos: [
                  { task: 'First task', completed: true },
                  { task: 'Second task', completed: false },
                ],
              },
            },
          ],
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      expect(handoffPrompt).toContain('Todos:')
      expect(handoffPrompt).toContain('[x] First task')
      expect(handoffPrompt).toContain('[ ] Second task')
    })

    test('handles AI messages with content but no blocks', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
        {
          id: '2',
          variant: 'ai',
          content: 'Direct content response',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      expect(handoffPrompt).toContain('Assistant: Direct content response')
    })

    test('truncates long AI content to 500 characters', () => {
      const longContent = 'A'.repeat(1000)
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
        {
          id: '2',
          variant: 'ai',
          content: longContent,
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      // The truncated content should be 500 chars
      expect(handoffPrompt).toContain('A'.repeat(500))
      expect(handoffPrompt).not.toContain('A'.repeat(501))
    })
  })

  describe('handoff prompt generation', () => {
    test('generates handoff prompt with conversation context', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Fix the bug',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      expect(handoffPrompt).toContain('Continue from previous session')
      expect(handoffPrompt).toContain('User: Fix the bug')
    })

    test('combines user prompt with generated handoff prompt', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Original task',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({
        clearMessages,
        userPrompt: 'Focus on performance',
      })

      // User prompt should come first
      expect(handoffPrompt).toMatch(/^Focus on performance/)
      // Then the generated handoff prompt
      expect(handoffPrompt).toContain('Continue from previous session')
      expect(handoffPrompt).toContain('User: Original task')
    })

    test('trims whitespace from user prompt', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Task',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({
        clearMessages,
        userPrompt: '  Extra spaces  ',
      })

      expect(handoffPrompt).toMatch(/^Extra spaces/)
    })

    test('ignores empty user prompt', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Task',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt: withEmpty } = handleHandoffCommand({
        clearMessages,
        userPrompt: '',
      })

      // Both should start with the generated prompt, not user prompt
      expect(withEmpty).toMatch(/^Continue from previous session/)

      // Reset messages for second test (they were cleared)
      useChatStore.setState({ messages })

      const { handoffPrompt: withWhitespace } = handleHandoffCommand({
        clearMessages,
        userPrompt: '   ',
      })

      expect(withWhitespace).toMatch(/^Continue from previous session/)
    })
  })

  describe('state management', () => {
    test('clears messages on successful handoff', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      handleHandoffCommand({ clearMessages })

      expect(clearMessages).toHaveBeenCalled()
      expect(useChatStore.getState().messages).toEqual([])
    })

    test('sets input value to handoff prompt', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { handoffPrompt } = handleHandoffCommand({ clearMessages })

      expect(handoffPrompt).toBeDefined()
      const state = useChatStore.getState()
      expect(state.inputValue).toBe(handoffPrompt as string)
      expect(state.cursorPosition).toBe((handoffPrompt as string).length)
    })

    test('clears run state on successful handoff', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({
        messages,
        runState: { runId: 'test-run' } as any,
      })

      handleHandoffCommand({ clearMessages })

      expect(useChatStore.getState().runState).toBeNull()
    })
  })

  describe('postUserMessage function', () => {
    test('returns previous messages unchanged on successful handoff', () => {
      const messages: ChatMessage[] = [
        {
          id: '1',
          variant: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ]
      useChatStore.setState({ messages })

      const { postUserMessage } = handleHandoffCommand({ clearMessages })

      const previousMessages: ChatMessage[] = [
        {
          id: 'prev',
          variant: 'user',
          content: 'Previous',
          timestamp: new Date().toISOString(),
        },
      ]
      const result = postUserMessage(previousMessages)

      // Should return the same array unchanged
      expect(result).toBe(previousMessages)
    })

    test('appends error message on failure', () => {
      useChatStore.setState({ messages: [] })

      const { postUserMessage } = handleHandoffCommand({ clearMessages })

      const previousMessages: ChatMessage[] = []
      const result = postUserMessage(previousMessages)

      expect(result.length).toBe(1)
      // getSystemMessage creates an 'ai' variant message
      expect(result[0]?.variant).toBe('ai')
    })
  })
})
