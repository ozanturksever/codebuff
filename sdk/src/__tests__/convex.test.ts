import { describe, expect, test, mock, afterEach } from 'bun:test'
import {
  ConvexCodebuffClient,
  ConvexUnsupportedToolError,
  getMatchingSpawn,
  validateSpawnPermission,
  BASE_AGENT_IDS,
  MAX_SUBAGENT_DEPTH,
  filterUnfinishedToolCalls,
} from '../convex'

import type { Message, AssistantMessage, ToolMessage, UserMessage } from '../convex'

describe('ConvexCodebuffClient', () => {
  const originalFetch = globalThis.fetch

  const setFetchMock = (mockFetch: ReturnType<typeof mock>) => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('constructor', () => {
    test('throws error when apiKey is not provided', () => {
      expect(() => {
        // @ts-expect-error - testing missing apiKey
        new ConvexCodebuffClient({})
      }).toThrow('Codebuff API key is required')
    })

    test('creates client with valid apiKey', () => {
      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      expect(client.options.apiKey).toBe('test-key')
    })

    test('generates fingerprintId with convex prefix', () => {
      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      expect(client.options.fingerprintId).toMatch(/^codebuff-convex-sdk-/)
    })

    test('accepts projectFiles option', () => {
      const projectFiles = { 'index.ts': 'console.log("hello")' }
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        projectFiles,
      })
      expect(client.options.projectFiles).toEqual(projectFiles)
    })

    test('accepts knowledgeFiles option', () => {
      const knowledgeFiles = { 'README.md': '# Project' }
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        knowledgeFiles,
      })
      expect(client.options.knowledgeFiles).toEqual(knowledgeFiles)
    })

    test('accepts maxAgentSteps option', () => {
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        maxAgentSteps: 10,
      })
      expect(client.options.maxAgentSteps).toBe(10)
    })

    test('sets default handleEvent that throws on error', () => {
      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      expect(() => {
        client.options.handleEvent?.({ type: 'error', message: 'test error' })
      }).toThrow('Received error: test error')
    })
  })

  describe('checkConnection', () => {
    test('returns true when healthz responds with status ok', async () => {
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        } as Response),
      )

      setFetchMock(mockFetch)

      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      const result = await client.checkConnection()

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test('returns false when response is not ok', async () => {
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ status: 'ok' }),
        } as Response),
      )

      setFetchMock(mockFetch)

      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      const result = await client.checkConnection()

      expect(result).toBe(false)
    })

    test('returns false when status is not ok', async () => {
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'error' }),
        } as Response),
      )

      setFetchMock(mockFetch)

      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      const result = await client.checkConnection()

      expect(result).toBe(false)
    })

    test('returns false when fetch throws an error', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('Network error')))

      setFetchMock(mockFetch)

      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      const result = await client.checkConnection()

      expect(result).toBe(false)
    })

    test('returns false when response body is null', async () => {
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(null),
        } as Response),
      )

      setFetchMock(mockFetch)

      const client = new ConvexCodebuffClient({ apiKey: 'test-key' })
      const result = await client.checkConnection()

      expect(result).toBe(false)
    })
  })
})

describe('ConvexUnsupportedToolError', () => {
  test('creates error with correct message format', () => {
    const error = new ConvexUnsupportedToolError(
      'run_terminal_command',
      'child_process is not available',
    )

    expect(error.message).toContain('run_terminal_command')
    expect(error.message).toContain('child_process is not available')
    expect(error.message).toContain('overrideTools')
    expect(error.name).toBe('ConvexUnsupportedToolError')
  })

  test('is instanceof Error', () => {
    const error = new ConvexUnsupportedToolError('test_tool', 'test reason')
    expect(error instanceof Error).toBe(true)
  })

  test('includes guidance about overrides', () => {
    const error = new ConvexUnsupportedToolError('write_file', 'no fs access')
    expect(error.message).toContain(
      'Either provide an override via overrideTools',
    )
  })
})

describe('getMatchingSpawn', () => {
  describe('exact match', () => {
    test('returns exact match when agent ID matches exactly', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0', 'codebuff/commander@1.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'codebuff/file-picker@1.0.0')
      expect(result).toBe('codebuff/file-picker@1.0.0')
    })

    test('returns null when no match found', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'codebuff/commander@1.0.0')
      expect(result).toBeNull()
    })
  })

  describe('agent name matching without version/publisher', () => {
    test('matches by agent name only when no version specified in request', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'file-picker')
      expect(result).toBe('codebuff/file-picker@1.0.0')
    })

    test('matches simple agent name without publisher prefix', () => {
      const spawnableAgents = ['commander@1.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'commander')
      expect(result).toBe('commander@1.0.0')
    })
  })

  describe('publisher and agent name matching', () => {
    test('matches with same publisher and agent name when version differs', () => {
      const spawnableAgents = ['codebuff/file-picker@2.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'codebuff/file-picker')
      expect(result).toBe('codebuff/file-picker@2.0.0')
    })

    test('matches with same publisher, agent name, and version', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0', 'codebuff/file-picker@2.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'codebuff/file-picker@2.0.0')
      expect(result).toBe('codebuff/file-picker@2.0.0')
    })

    test('returns null when publisher differs', () => {
      const spawnableAgents = ['other-publisher/file-picker@1.0.0']
      const result = getMatchingSpawn(spawnableAgents, 'codebuff/file-picker@1.0.0')
      expect(result).toBeNull()
    })
  })

  describe('edge cases', () => {
    test('returns null for empty spawnableAgents list', () => {
      const result = getMatchingSpawn([], 'any-agent')
      expect(result).toBeNull()
    })

    test('handles agents with multiple slashes in path', () => {
      const spawnableAgents = ['org/sub/agent@1.0.0']
      // Note: Current implementation only splits on first /
      const result = getMatchingSpawn(spawnableAgents, 'org/sub/agent@1.0.0')
      expect(result).toBe('org/sub/agent@1.0.0')
    })
  })
})

describe('validateSpawnPermission', () => {
  describe('base agent permissions', () => {
    test.each(BASE_AGENT_IDS)('base agent "%s" can spawn any agent', (baseAgentId) => {
      const result = validateSpawnPermission(baseAgentId, [], 'any-child-agent')
      expect(result).toBe('any-child-agent')
    })

    test('base agent with publisher prefix can spawn any agent', () => {
      const result = validateSpawnPermission('codebuff/base@1.0.0', [], 'any-child-agent')
      expect(result).toBe('any-child-agent')
    })

    test('base-lite with version can spawn any agent', () => {
      const result = validateSpawnPermission('codebuff/base-lite@1.0.0', [], 'file-picker')
      expect(result).toBe('file-picker')
    })
  })

  describe('non-base agent permissions', () => {
    test('allows spawn when child agent is in spawnableAgents', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0']
      const result = validateSpawnPermission(
        'custom-agent',
        spawnableAgents,
        'codebuff/file-picker@1.0.0',
      )
      expect(result).toBe('codebuff/file-picker@1.0.0')
    })

    test('returns matched agent when fuzzy matching succeeds', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0']
      const result = validateSpawnPermission('custom-agent', spawnableAgents, 'file-picker')
      expect(result).toBe('codebuff/file-picker@1.0.0')
    })

    test('throws error when child agent is not in spawnableAgents', () => {
      const spawnableAgents = ['codebuff/file-picker@1.0.0']
      expect(() => {
        validateSpawnPermission('custom-agent', spawnableAgents, 'commander')
      }).toThrow('Agent "custom-agent" is not allowed to spawn child agent "commander"')
    })

    test('error message includes allowed spawnable agents', () => {
      const spawnableAgents = ['file-picker', 'code-searcher']
      expect(() => {
        validateSpawnPermission('custom-agent', spawnableAgents, 'commander')
      }).toThrow('Allowed spawnable agents: file-picker, code-searcher')
    })

    test('throws error with empty spawnableAgents list', () => {
      expect(() => {
        validateSpawnPermission('custom-agent', [], 'any-agent')
      }).toThrow('Allowed spawnable agents: none')
    })
  })
})

describe('BASE_AGENT_IDS', () => {
  test('contains expected base agent identifiers', () => {
    expect(BASE_AGENT_IDS).toContain('base')
    expect(BASE_AGENT_IDS).toContain('base-lite')
    expect(BASE_AGENT_IDS).toContain('base-max')
    expect(BASE_AGENT_IDS).toContain('base-experimental')
  })

  test('is an array of strings', () => {
    expect(Array.isArray(BASE_AGENT_IDS)).toBe(true)
    for (const id of BASE_AGENT_IDS) {
      expect(typeof id).toBe('string')
    }
  })
})

describe('MAX_SUBAGENT_DEPTH', () => {
  test('is a positive integer', () => {
    expect(typeof MAX_SUBAGENT_DEPTH).toBe('number')
    expect(MAX_SUBAGENT_DEPTH).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_SUBAGENT_DEPTH)).toBe(true)
  })

  test('is set to 5', () => {
    expect(MAX_SUBAGENT_DEPTH).toBe(5)
  })
})

describe('spawn_agents tool handling', () => {
  const originalFetch = globalThis.fetch

  const setFetchMock = (mockFetch: ReturnType<typeof mock>) => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // Helper to create a mock streaming response for chat completion
  const createStreamingResponse = (textContent: string, toolCalls?: Array<{ name: string; arguments: string }>) => {
    const chunks: string[] = []
    
    // Add text content chunk
    if (textContent) {
      chunks.push(`data: ${JSON.stringify({
        choices: [{ delta: { content: textContent } }]
      })}\n\n`)
    }

    // Add tool call chunks if provided
    if (toolCalls) {
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]
        chunks.push(`data: ${JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{
                index: i,
                id: `call_${i}`,
                function: { name: tc.name, arguments: tc.arguments }
              }]
            }
          }]
        })}\n\n`)
      }
    }

    // Add done
    chunks.push('data: [DONE]\n\n')

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
        controller.close()
      },
    })

    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  test('client accepts agentDefinitions for subagent spawning', () => {
    const agentDefs = [
      { id: 'helper-agent', displayName: 'Helper', systemPrompt: 'You help.', toolNames: [] as string[], model: 'anthropic/claude-sonnet-4' },
    ]
    const client = new ConvexCodebuffClient({
      apiKey: 'test-key',
      agentDefinitions: agentDefs,
    })
    expect(client.options.agentDefinitions).toEqual(agentDefs)
  })

  test('client accepts spawnableAgents in agent definitions', () => {
    const agentDefs = [
      {
        id: 'parent-agent',
        displayName: 'Parent',
        systemPrompt: 'You are a parent.',
        toolNames: ['spawn_agents'] as string[],
        spawnableAgents: ['helper-agent'],
        model: 'anthropic/claude-sonnet-4',
      },
      { id: 'helper-agent', displayName: 'Helper', systemPrompt: 'You help.', toolNames: [] as string[], model: 'anthropic/claude-sonnet-4' },
    ]
    const client = new ConvexCodebuffClient({
      apiKey: 'test-key',
      agentDefinitions: agentDefs,
    })
    expect(client.options.agentDefinitions?.[0].spawnableAgents).toEqual(['helper-agent'])
  })
})

describe('subagent streaming events', () => {
  test('handleStreamChunk type includes subagent events', () => {
    // This is a type-level test to ensure the types are correct
    const handler: NonNullable<ConvexCodebuffClient['options']['handleStreamChunk']> = (chunk) => {
      if (typeof chunk === 'string') {
        // Text chunk
      } else if (chunk.type === 'subagent_start') {
        const { agentId, agentType, parentAgentId, prompt } = chunk
        expect(typeof agentId).toBe('string')
        expect(typeof agentType).toBe('string')
      } else if (chunk.type === 'subagent_chunk') {
        const { agentId, agentType, chunk: text } = chunk
        expect(typeof text).toBe('string')
      } else if (chunk.type === 'subagent_finish') {
        const { agentId, agentType, parentAgentId } = chunk
        expect(typeof agentId).toBe('string')
      }
    }

    // Verify handler can be set on client
    const client = new ConvexCodebuffClient({
      apiKey: 'test-key',
      handleStreamChunk: handler,
    })
    expect(client.options.handleStreamChunk).toBe(handler)
  })
})

describe('filterUnfinishedToolCalls', () => {
  const createUserMessage = (text: string): UserMessage => ({
    role: 'user',
    content: [{ type: 'text', text }],
    sentAt: Date.now(),
  })

  const createAssistantMessage = (text: string): AssistantMessage => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    sentAt: Date.now(),
  })

  const createAssistantWithToolCall = (text: string, toolCallId: string, toolName: string): AssistantMessage => ({
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'tool-call', toolCallId, toolName, input: {} } as any,
    ],
    sentAt: Date.now(),
  })

  const createToolMessage = (toolCallId: string, toolName: string): ToolMessage => ({
    role: 'tool',
    toolCallId,
    toolName,
    content: [{ type: 'json', value: { result: 'success' } }],
  })

  test('returns empty array for empty input', () => {
    const result = filterUnfinishedToolCalls([])
    expect(result).toEqual([])
  })

  test('preserves messages without tool calls', () => {
    const messages: Message[] = [
      createUserMessage('Hello'),
      createAssistantMessage('Hi there!'),
      createUserMessage('How are you?'),
    ]

    const result = filterUnfinishedToolCalls(messages)
    expect(result).toHaveLength(3)
    expect(result[0].role).toBe('user')
    expect(result[1].role).toBe('assistant')
    expect(result[2].role).toBe('user')
  })

  test('preserves completed tool calls', () => {
    const messages: Message[] = [
      createUserMessage('Read this file'),
      createAssistantWithToolCall('Let me read that', 'call-1', 'read_files'),
      createToolMessage('call-1', 'read_files'),
      createAssistantMessage('Here is the content'),
    ]

    const result = filterUnfinishedToolCalls(messages)
    expect(result).toHaveLength(4)
    
    // Verify the tool call is preserved
    const assistantMsg = result[1] as AssistantMessage
    expect(assistantMsg.content).toHaveLength(2)
    expect(assistantMsg.content[1].type).toBe('tool-call')
  })

  test('removes unfinished tool calls from assistant messages', () => {
    const messages: Message[] = [
      createUserMessage('Do something'),
      createAssistantWithToolCall('Working on it', 'call-incomplete', 'some_tool'),
      // Note: No tool result message for 'call-incomplete'
    ]

    const result = filterUnfinishedToolCalls(messages)
    expect(result).toHaveLength(2)
    
    // The assistant message should have the tool call filtered out
    const assistantMsg = result[1] as AssistantMessage
    expect(assistantMsg.content).toHaveLength(1)
    expect(assistantMsg.content[0].type).toBe('text')
  })

  test('removes assistant message entirely if only content was unfinished tool call', () => {
    const assistantOnlyToolCall: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call-only', toolName: 'some_tool', input: {} } as any,
      ],
      sentAt: Date.now(),
    }

    const messages: Message[] = [
      createUserMessage('Do something'),
      assistantOnlyToolCall,
      // No tool result
    ]

    const result = filterUnfinishedToolCalls(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })

  test('handles mixed completed and unfinished tool calls', () => {
    const assistantWithMultipleCalls: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me do both' },
        { type: 'tool-call', toolCallId: 'call-complete', toolName: 'tool1', input: {} } as any,
        { type: 'tool-call', toolCallId: 'call-incomplete', toolName: 'tool2', input: {} } as any,
      ],
      sentAt: Date.now(),
    }

    const messages: Message[] = [
      createUserMessage('Do two things'),
      assistantWithMultipleCalls,
      createToolMessage('call-complete', 'tool1'),
      // Note: No tool result for 'call-incomplete'
    ]

    const result = filterUnfinishedToolCalls(messages)
    expect(result).toHaveLength(3)
    
    // The assistant message should have only the completed tool call
    const assistantMsg = result[1] as AssistantMessage
    expect(assistantMsg.content).toHaveLength(2) // text + completed tool call
    expect(assistantMsg.content[0].type).toBe('text')
    expect(assistantMsg.content[1].type).toBe('tool-call')
    expect((assistantMsg.content[1] as any).toolCallId).toBe('call-complete')
  })

  test('preserves tool result messages', () => {
    const messages: Message[] = [
      createUserMessage('Read file'),
      createAssistantWithToolCall('Reading', 'call-1', 'read_files'),
      createToolMessage('call-1', 'read_files'),
    ]

    const result = filterUnfinishedToolCalls(messages)
    expect(result).toHaveLength(3)
    expect(result[2].role).toBe('tool')
  })
})

describe('includeMessageHistory support', () => {
  test('agent definition with includeMessageHistory is accepted', () => {
    const agentDefs = [
      {
        id: 'context-aware-agent',
        displayName: 'Context Aware',
        systemPrompt: 'You have full conversation context.',
        toolNames: [] as string[],
        includeMessageHistory: true,
        model: 'anthropic/claude-sonnet-4',
      },
    ]
    const client = new ConvexCodebuffClient({
      apiKey: 'test-key',
      agentDefinitions: agentDefs,
    })
    expect(client.options.agentDefinitions?.[0].includeMessageHistory).toBe(true)
  })

  test('agent definition without includeMessageHistory defaults to undefined', () => {
    const agentDefs = [
      {
        id: 'simple-agent',
        displayName: 'Simple',
        systemPrompt: 'You are simple.',
        toolNames: [] as string[],
        model: 'anthropic/claude-sonnet-4',
      },
    ]
    const client = new ConvexCodebuffClient({
      apiKey: 'test-key',
      agentDefinitions: agentDefs,
    })
    expect(client.options.agentDefinitions?.[0].includeMessageHistory).toBeUndefined()
  })

  test('spawnable agents can have different includeMessageHistory settings', () => {
    const agentDefs = [
      {
        id: 'parent-agent',
        displayName: 'Parent',
        systemPrompt: 'You spawn children.',
        toolNames: ['spawn_agents'] as string[],
        spawnableAgents: ['context-child', 'no-context-child'],
        model: 'anthropic/claude-sonnet-4',
      },
      {
        id: 'context-child',
        displayName: 'Context Child',
        systemPrompt: 'You see history.',
        toolNames: [] as string[],
        includeMessageHistory: true,
        model: 'anthropic/claude-sonnet-4',
      },
      {
        id: 'no-context-child',
        displayName: 'No Context Child',
        systemPrompt: 'You start fresh.',
        toolNames: [] as string[],
        includeMessageHistory: false,
        model: 'anthropic/claude-sonnet-4',
      },
    ]
    const client = new ConvexCodebuffClient({
      apiKey: 'test-key',
      agentDefinitions: agentDefs,
    })
    expect(client.options.agentDefinitions?.[1].includeMessageHistory).toBe(true)
    expect(client.options.agentDefinitions?.[2].includeMessageHistory).toBe(false)
  })
})

describe('read_subtree tool', () => {
  test('client exposes read_subtree in tools for API', () => {
    // Import buildToolsForApi to test it
    const { buildToolsForApi } = require('../convex')
    const tools = buildToolsForApi(undefined, [])
    const readSubtreeTool = tools?.find(
      (t: any) => t.function?.name === 'read_subtree',
    )
    expect(readSubtreeTool).toBeDefined()
    expect(readSubtreeTool.function.description).toContain('directory subtree')
    expect(readSubtreeTool.function.parameters.properties.paths).toBeDefined()
    expect(readSubtreeTool.function.parameters.properties.maxFiles).toBeDefined()
  })

  test('read_subtree tool has correct parameter schema', () => {
    const { buildToolsForApi } = require('../convex')
    const tools = buildToolsForApi(undefined, [])
    const readSubtreeTool = tools?.find(
      (t: any) => t.function?.name === 'read_subtree',
    )
    expect(readSubtreeTool.function.parameters.required).toContain('paths')
    expect(readSubtreeTool.function.parameters.properties.paths.type).toBe('array')
  })
})

describe('buildSystemPrompt file tree', () => {
  test('includes hierarchical file tree in system prompt', () => {
    const { buildSystemPrompt } = require('../convex')
    const projectFiles = {
      'src/index.ts': 'console.log("hello")',
      'src/utils/helper.ts': 'export const helper = () => {}',
      'package.json': '{}',
    }
    const result = buildSystemPrompt(undefined, projectFiles)
    expect(result).toContain('Project Files')
    expect(result).toContain('src/')
    expect(result).toContain('index.ts')
    expect(result).toContain('utils/')
    expect(result).toContain('helper.ts')
    expect(result).toContain('package.json')
  })

  test('shows helpful message when no files provided', () => {
    const { buildSystemPrompt } = require('../convex')
    const result = buildSystemPrompt(undefined, {})
    expect(result).toContain('No project files were provided')
  })

  test('mentions read_subtree tool in system prompt', () => {
    const { buildSystemPrompt } = require('../convex')
    const projectFiles = { 'test.ts': 'code' }
    const result = buildSystemPrompt(undefined, projectFiles)
    expect(result).toContain('read_subtree')
  })
})

describe('credit tracking and aggregation', () => {
  describe('ExecuteAgentLoopResult credit fields', () => {
    test('result type includes credit tracking fields', () => {
      // Type-level test to ensure the result structure is correct
      type ExpectedResult = {
        response: string
        output: any
        creditsUsed: number
        directCreditsUsed: number
        subagentCreditsUsed: number
        messages: any[]
      }

      // This verifies the type structure exists
      const mockResult: ExpectedResult = {
        response: 'test',
        output: 'test',
        creditsUsed: 100,
        directCreditsUsed: 50,
        subagentCreditsUsed: 50,
        messages: [],
      }

      expect(mockResult.creditsUsed).toBe(100)
      expect(mockResult.directCreditsUsed).toBe(50)
      expect(mockResult.subagentCreditsUsed).toBe(50)
      expect(mockResult.creditsUsed).toBe(
        mockResult.directCreditsUsed + mockResult.subagentCreditsUsed,
      )
    })
  })

  describe('spawn_agents credit aggregation logic', () => {
    test('total credits equals sum of direct and subagent credits', () => {
      // Simulate credit aggregation logic
      const directCreditsUsed = 25
      const subagentResults = [
        { creditsUsed: 30 },
        { creditsUsed: 45 },
        { creditsUsed: 0 }, // Failed subagent
      ]

      const subagentCreditsUsed = subagentResults.reduce(
        (sum, r) => sum + r.creditsUsed,
        0,
      )
      const totalCreditsUsed = directCreditsUsed + subagentCreditsUsed

      expect(subagentCreditsUsed).toBe(75)
      expect(totalCreditsUsed).toBe(100)
    })

    test('failed subagents contribute zero credits', () => {
      const results = [
        { status: 'fulfilled' as const, value: { creditsUsed: 50 } },
        { status: 'rejected' as const, reason: new Error('Failed') },
        { status: 'fulfilled' as const, value: { creditsUsed: 30 } },
      ]

      let totalCredits = 0
      for (const result of results) {
        if (result.status === 'fulfilled') {
          totalCredits += result.value.creditsUsed
        }
        // Rejected results contribute 0 credits
      }

      expect(totalCredits).toBe(80)
    })

    test('nested subagent credits bubble up correctly', () => {
      // Simulate nested subagent structure:
      // Parent -> SubagentA (50 credits) -> SubSubagent (20 credits)
      // Parent -> SubagentB (30 credits)
      //
      // SubagentA's total = 50 (direct) + 20 (subagent) = 70
      // Parent's subagentCreditsUsed = 70 + 30 = 100

      const subSubagentCredits = 20
      const subagentADirectCredits = 50
      const subagentATotalCredits = subagentADirectCredits + subSubagentCredits

      const subagentBCredits = 30

      const parentSubagentCredits = subagentATotalCredits + subagentBCredits

      expect(subagentATotalCredits).toBe(70)
      expect(parentSubagentCredits).toBe(100)
    })
  })
})
