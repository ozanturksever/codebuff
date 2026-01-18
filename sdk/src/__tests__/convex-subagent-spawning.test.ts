import { describe, expect, test, mock, afterEach, beforeEach } from 'bun:test'
import {
  ConvexCodebuffClient,
  getMatchingSpawn,
  validateSpawnPermission,
  buildSystemPrompt,
  buildToolsForApi,
  MAX_SUBAGENT_DEPTH,
  BASE_AGENT_IDS,
} from '../convex'

import type { AgentDefinition } from '@codebuff/common/templates/initial-agents-dir/types/agent-definition'

// Helper to create mock agent definitions
const createMockAgentDef = (
  id: string,
  options: Partial<AgentDefinition> = {},
): AgentDefinition => ({
  id,
  displayName: options.displayName ?? `Mock ${id}`,
  systemPrompt: options.systemPrompt ?? 'You are a helpful assistant.',
  toolNames: options.toolNames ?? ['read_files', 'end_turn'],
  model: options.model ?? 'anthropic/claude-sonnet-4',
  spawnableAgents: options.spawnableAgents,
  ...options,
})

describe('Convex Subagent Spawning', () => {
  describe('getMatchingSpawn', () => {
    describe('exact matches with publisher/agent@version format', () => {
      test('should match exact publisher/agent@version', () => {
        const spawnableAgents = [
          'codebuff/thinker@1.0.0',
          'codebuff/reviewer@2.1.0',
        ]
        const result = getMatchingSpawn(
          spawnableAgents,
          'codebuff/thinker@1.0.0',
        )
        expect(result).toBe('codebuff/thinker@1.0.0')
      })

      test('should not match different versions', () => {
        const spawnableAgents = ['codebuff/thinker@1.0.0']
        const result = getMatchingSpawn(
          spawnableAgents,
          'codebuff/thinker@2.0.0',
        )
        expect(result).toBeNull()
      })

      test('should not match different publishers', () => {
        const spawnableAgents = ['codebuff/thinker@1.0.0']
        const result = getMatchingSpawn(spawnableAgents, 'acme/thinker@1.0.0')
        expect(result).toBeNull()
      })

      test('should not match different agent names', () => {
        const spawnableAgents = ['codebuff/thinker@1.0.0']
        const result = getMatchingSpawn(
          spawnableAgents,
          'codebuff/reviewer@1.0.0',
        )
        expect(result).toBeNull()
      })
    })

    describe('publisher/agent format without version', () => {
      test('should match publisher/agent when child has no version', () => {
        const spawnableAgents = ['codebuff/thinker@1.0.0', 'acme/reviewer']
        const result = getMatchingSpawn(spawnableAgents, 'codebuff/thinker')
        expect(result).toBe('codebuff/thinker@1.0.0')
      })

      test('should match exact publisher/agent without version', () => {
        const spawnableAgents = ['codebuff/thinker', 'acme/reviewer']
        const result = getMatchingSpawn(spawnableAgents, 'codebuff/thinker')
        expect(result).toBe('codebuff/thinker')
      })
    })

    describe('simple agent name format', () => {
      test('should match simple agent name', () => {
        const spawnableAgents = ['thinker', 'reviewer', 'file-picker']
        const result = getMatchingSpawn(spawnableAgents, 'thinker')
        expect(result).toBe('thinker')
      })

      test('should match simple agent name when spawnable has publisher', () => {
        const spawnableAgents = ['codebuff/thinker@1.0.0', 'reviewer']
        const result = getMatchingSpawn(spawnableAgents, 'thinker')
        expect(result).toBe('codebuff/thinker@1.0.0')
      })

      test('should match simple agent name when spawnable has version', () => {
        const spawnableAgents = ['thinker@1.0.0', 'reviewer']
        const result = getMatchingSpawn(spawnableAgents, 'thinker')
        expect(result).toBe('thinker@1.0.0')
      })

      test('should not match when agent name differs', () => {
        const spawnableAgents = ['thinker', 'reviewer']
        const result = getMatchingSpawn(spawnableAgents, 'file-picker')
        expect(result).toBeNull()
      })
    })

    describe('edge cases', () => {
      test('should return null for empty agent ID', () => {
        const spawnableAgents = ['thinker', 'reviewer']
        const result = getMatchingSpawn(spawnableAgents, '')
        expect(result).toBeNull()
      })

      test('should return null when spawnableAgents is empty', () => {
        const spawnableAgents: string[] = []
        const result = getMatchingSpawn(spawnableAgents, 'thinker')
        expect(result).toBeNull()
      })

      test('should handle malformed spawnable agent IDs gracefully', () => {
        const spawnableAgents = ['', 'thinker']
        const result = getMatchingSpawn(spawnableAgents, 'thinker')
        expect(result).toBe('thinker')
      })

      test('should prioritize exact matches over partial matches', () => {
        const spawnableAgents = ['thinker', 'codebuff/thinker@1.0.0']
        const result = getMatchingSpawn(spawnableAgents, 'thinker')
        expect(result).toBe('thinker') // First match wins
      })
    })
  })

  describe('validateSpawnPermission', () => {
    test('should allow base agents to spawn any agent', () => {
      for (const baseAgent of BASE_AGENT_IDS) {
        const result = validateSpawnPermission(baseAgent, [], 'any-agent')
        expect(result).toBe('any-agent')
      }
    })

    test('should allow base agents with publisher prefix to spawn any agent', () => {
      const result = validateSpawnPermission(
        'codebuff/base@1.0.0',
        [],
        'any-agent',
      )
      expect(result).toBe('any-agent')
    })

    test('should allow spawning when agent is in spawnableAgents list', () => {
      const result = validateSpawnPermission(
        'parent-agent',
        ['thinker', 'reviewer'],
        'thinker',
      )
      expect(result).toBe('thinker')
    })

    test('should throw when agent is not in spawnableAgents list', () => {
      expect(() =>
        validateSpawnPermission('parent-agent', ['thinker'], 'reviewer'),
      ).toThrow('is not allowed to spawn child agent')
    })

    test('should throw with informative message including allowed agents', () => {
      expect(() =>
        validateSpawnPermission(
          'parent-agent',
          ['thinker', 'file-picker'],
          'reviewer',
        ),
      ).toThrow('thinker, file-picker')
    })

    test('should return matched agent ID from spawnableAgents', () => {
      const result = validateSpawnPermission(
        'parent-agent',
        ['codebuff/thinker@1.0.0'],
        'thinker',
      )
      expect(result).toBe('codebuff/thinker@1.0.0')
    })
  })

  describe('buildSystemPrompt', () => {
    test('should include default prompt when no agent definition', () => {
      const result = buildSystemPrompt(undefined, {})
      expect(result).toContain('helpful AI assistant')
    })

    test('should include agent system prompt when defined', () => {
      const agentDef = createMockAgentDef('test', {
        systemPrompt: 'You are a code reviewer.',
      })
      const result = buildSystemPrompt(agentDef, {})
      expect(result).toContain('You are a code reviewer.')
    })

    test('should include available files list', () => {
      const projectFiles = {
        'src/index.ts': 'console.log("hello")',
        'package.json': '{}',
      }
      const result = buildSystemPrompt(undefined, projectFiles)
      expect(result).toContain('Project Files')
      // Files are displayed in a hierarchical tree format
      expect(result).toContain('src/')
      expect(result).toContain('index.ts')
      expect(result).toContain('package.json')
    })

    test('should include spawnable agents when defined', () => {
      const agentDef = createMockAgentDef('orchestrator', {
        spawnableAgents: ['thinker', 'reviewer', 'file-picker'],
      })
      const result = buildSystemPrompt(agentDef, {})
      expect(result).toContain('Spawnable Agents')
      expect(result).toContain('thinker')
      expect(result).toContain('reviewer')
      expect(result).toContain('file-picker')
    })

    test('should not include spawnable agents section when empty', () => {
      const agentDef = createMockAgentDef('simple', {
        spawnableAgents: [],
      })
      const result = buildSystemPrompt(agentDef, {})
      expect(result).not.toContain('Spawnable Agents')
    })
  })

  describe('buildToolsForApi', () => {
    test('should always include read_files tool', () => {
      const tools = buildToolsForApi(undefined, [])
      expect(tools).toBeDefined()
      const readFilesTool = tools?.find(
        (t: any) => t.function?.name === 'read_files',
      )
      expect(readFilesTool).toBeDefined()
    })

    test('should always include end_turn tool', () => {
      const tools = buildToolsForApi(undefined, [])
      const endTurnTool = tools?.find(
        (t: any) => t.function?.name === 'end_turn',
      )
      expect(endTurnTool).toBeDefined()
    })

    test('should include spawn_agents tool when agent has spawnableAgents', () => {
      const agentDef = createMockAgentDef('orchestrator', {
        spawnableAgents: ['thinker', 'reviewer'],
      })
      const tools = buildToolsForApi(agentDef, [])
      const spawnAgentsTool = tools?.find(
        (t: any) => t.function?.name === 'spawn_agents',
      )
      expect(spawnAgentsTool).toBeDefined()
      expect(spawnAgentsTool.function.description).toContain('sub-agents')
      expect(spawnAgentsTool.function.parameters.properties.agents).toBeDefined()
    })

    test('should not include spawn_agents tool when spawnableAgents is empty', () => {
      const agentDef = createMockAgentDef('simple', {
        spawnableAgents: [],
      })
      const tools = buildToolsForApi(agentDef, [])
      const spawnAgentsTool = tools?.find(
        (t: any) => t.function?.name === 'spawn_agents',
      )
      expect(spawnAgentsTool).toBeUndefined()
    })

    test('should not include spawn_agents tool when spawnableAgents is undefined', () => {
      const agentDef = createMockAgentDef('simple')
      const tools = buildToolsForApi(agentDef, [])
      const spawnAgentsTool = tools?.find(
        (t: any) => t.function?.name === 'spawn_agents',
      )
      expect(spawnAgentsTool).toBeUndefined()
    })

    test('should include custom tool definitions', () => {
      // buildToolsForApi expects the processed format with inputSchema as JSON Schema object
      // not as a Zod schema (which is what CustomToolDefinition uses before processing)
      const customToolForApi = {
        toolName: 'my_custom_tool',
        description: 'Does something custom',
        inputSchema: { type: 'object', properties: {} },
      }
      const tools = buildToolsForApi(undefined, [customToolForApi as any])
      const customToolDef = tools?.find(
        (t: any) => t.function?.name === 'my_custom_tool',
      )
      expect(customToolDef).toBeDefined()
      expect(customToolDef.function.description).toBe('Does something custom')
    })
  })

  describe('MAX_SUBAGENT_DEPTH', () => {
    test('should be a reasonable positive number', () => {
      expect(MAX_SUBAGENT_DEPTH).toBeGreaterThan(0)
      expect(MAX_SUBAGENT_DEPTH).toBeLessThanOrEqual(10)
    })
  })

  describe('BASE_AGENT_IDS', () => {
    test('should include common base agent types', () => {
      expect(BASE_AGENT_IDS).toContain('base')
      expect(BASE_AGENT_IDS).toContain('base-lite')
      expect(BASE_AGENT_IDS).toContain('base-max')
    })
  })
})

describe('ConvexCodebuffClient with subagent support', () => {
  const originalFetch = globalThis.fetch

  const setFetchMock = (mockFetch: ReturnType<typeof mock>) => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('agent definitions with spawnableAgents', () => {
    test('should accept agentDefinitions with spawnableAgents', () => {
      const helperAgent = createMockAgentDef('helper')
      const orchestratorAgent = createMockAgentDef('orchestrator', {
        spawnableAgents: ['helper'],
      })

      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        agentDefinitions: [helperAgent, orchestratorAgent],
      })

      expect(client.options.agentDefinitions).toHaveLength(2)
      expect(client.options.agentDefinitions![1].spawnableAgents).toContain(
        'helper',
      )
    })

    test('should pass agentDefinitions to run options', () => {
      const helperAgent = createMockAgentDef('helper')
      const orchestratorAgent = createMockAgentDef('orchestrator', {
        spawnableAgents: ['helper'],
      })

      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        agentDefinitions: [helperAgent, orchestratorAgent],
      })

      // Verify the options are set correctly
      expect(client.options.agentDefinitions).toEqual([
        helperAgent,
        orchestratorAgent,
      ])
    })
  })

  describe('handleStreamChunk with subagent events', () => {
    test('should accept subagent_start event type', async () => {
      const events: any[] = []
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        handleStreamChunk: async (chunk) => {
          events.push(chunk)
        },
      })

      // Type check - this should compile without errors
      await client.options.handleStreamChunk?.({
        type: 'subagent_start',
        agentId: 'child-123',
        agentType: 'thinker',
        parentAgentId: 'parent-456',
        prompt: 'Think about this',
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('subagent_start')
    })

    test('should accept subagent_chunk event type', async () => {
      const events: any[] = []
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        handleStreamChunk: async (chunk) => {
          events.push(chunk)
        },
      })

      await client.options.handleStreamChunk?.({
        type: 'subagent_chunk',
        agentId: 'child-123',
        agentType: 'thinker',
        chunk: 'Thinking...',
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('subagent_chunk')
      expect(events[0].chunk).toBe('Thinking...')
    })

    test('should accept subagent_finish event type', async () => {
      const events: any[] = []
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        handleStreamChunk: async (chunk) => {
          events.push(chunk)
        },
      })

      await client.options.handleStreamChunk?.({
        type: 'subagent_finish',
        agentId: 'child-123',
        agentType: 'thinker',
        parentAgentId: 'parent-456',
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('subagent_finish')
    })

    test('should still accept plain string chunks', async () => {
      const events: any[] = []
      const client = new ConvexCodebuffClient({
        apiKey: 'test-key',
        handleStreamChunk: async (chunk) => {
          events.push(chunk)
        },
      })

      await client.options.handleStreamChunk?.('Hello, world!')

      expect(events).toHaveLength(1)
      expect(events[0]).toBe('Hello, world!')
    })
  })
})
