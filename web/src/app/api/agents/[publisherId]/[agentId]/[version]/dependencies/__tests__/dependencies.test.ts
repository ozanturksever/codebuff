import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getDependencies } from '../_get'

import {
  createMockDbSelect,
  createMockLogger,
  mockDbSchema,
} from '@codebuff/common/testing/mock-db'

// Mock the db module
const mockDbSelect = mock(() => ({}))

mock.module('@codebuff/internal/db', () => ({
  default: {
    select: mockDbSelect,
  },
}))

mock.module('@codebuff/internal/db/schema', () => mockDbSchema)

describe('/api/agents/[publisherId]/[agentId]/[version]/dependencies GET endpoint', () => {
  let mockLogger: ReturnType<typeof createMockLogger>

  const createMockParams = (overrides: Partial<{ publisherId: string; agentId: string; version: string }> = {}) => {
    return Promise.resolve({
      publisherId: 'test-publisher',
      agentId: 'test-agent',
      version: '1.0.0',
      ...overrides,
    })
  }

  beforeEach(() => {
    mockLogger = createMockLogger()

    // Reset to default empty mock
    mockDbSelect.mockImplementation(createMockDbSelect({ publishers: [], rootAgent: null }))
  })

  describe('Parameter validation', () => {
    test('returns 400 when publisherId is missing', async () => {
      const response = await getDependencies({
        params: createMockParams({ publisherId: '' }),
        logger: mockLogger,
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toEqual({ error: 'Missing required parameters' })
    })

    test('returns 400 when agentId is missing', async () => {
      const response = await getDependencies({
        params: createMockParams({ agentId: '' }),
        logger: mockLogger,
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toEqual({ error: 'Missing required parameters' })
    })

    test('returns 400 when version is missing', async () => {
      const response = await getDependencies({
        params: createMockParams({ version: '' }),
        logger: mockLogger,
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toEqual({ error: 'Missing required parameters' })
    })
  })

  describe('Publisher not found', () => {
    test('returns 404 when publisher does not exist', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [], // No publishers
        rootAgent: null,
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body).toEqual({ error: 'Publisher not found' })
    })
  })

  describe('Agent not found', () => {
    test('returns 404 when agent does not exist', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: null, // No agent
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body).toEqual({ error: 'Agent not found' })
    })
  })

  describe('Agent with no subagents', () => {
    test('returns tree with single node when agent has no spawnableAgents', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: { displayName: 'Test Agent', spawnableAgents: [] },
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.fullId).toBe('test-publisher/test-agent@1.0.0')
      expect(body.root.displayName).toBe('Test Agent')
      expect(body.root.children).toEqual([])
      expect(body.totalAgents).toBe(1)
      expect(body.maxDepth).toBe(0)
      expect(body.hasCycles).toBe(false)
    })

    test('returns tree with single node when spawnableAgents is not an array', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: { displayName: 'Test Agent', spawnableAgents: 'not-an-array' },
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.children).toEqual([])
      expect(body.totalAgents).toBe(1)
    })
  })

  describe('Agent data parsing', () => {
    test('handles agent data as JSON string', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: JSON.stringify({ displayName: 'Parsed Agent', spawnableAgents: [] }),
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.displayName).toBe('Parsed Agent')
    })

    test('uses agentId as displayName when displayName is not provided', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: { spawnableAgents: [] },
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.displayName).toBe('test-agent')
    })

    test('uses name as displayName when displayName is not provided but name is', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: { name: 'Agent Name', spawnableAgents: [] },
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.displayName).toBe('Agent Name')
    })
  })

  describe('Internal server error', () => {
    test('returns 500 when database throws an error', async () => {
      mockDbSelect.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toEqual({ error: 'Internal server error' })
      expect(mockLogger.error).toHaveBeenCalled()
    })

    test('returns 500 when params promise rejects', async () => {
      const response = await getDependencies({
        params: Promise.reject(new Error('Params error')),
        logger: mockLogger,
      })

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toEqual({ error: 'Internal server error' })
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('Agent with subagents', () => {
    test('returns tree with children when agent has spawnableAgents', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: {
            displayName: 'Root Agent',
            spawnableAgents: ['test-publisher/child-agent@1.0.0'],
          },
        },
        childAgents: [{
          id: 'child-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: { displayName: 'Child Agent', spawnableAgents: [] },
        }],
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.displayName).toBe('Root Agent')
      expect(body.root.children).toHaveLength(1)
      expect(body.root.children[0].displayName).toBe('Child Agent')
      expect(body.totalAgents).toBe(2)
      expect(body.maxDepth).toBe(1)
    })

    test('handles unavailable child agents gracefully', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: {
            displayName: 'Root Agent',
            spawnableAgents: ['test-publisher/missing-agent@1.0.0'],
          },
        },
        childAgents: [], // No child agents found
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.children).toHaveLength(1)
      expect(body.root.children[0].isAvailable).toBe(false)
      expect(body.root.children[0].displayName).toBe('missing-agent')
    })
  })

  describe('spawnerPrompt handling', () => {
    test('includes spawnerPrompt in response when present', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: {
            displayName: 'Test Agent',
            spawnerPrompt: 'Use this agent to help with testing',
            spawnableAgents: [],
          },
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.spawnerPrompt).toBe('Use this agent to help with testing')
    })

    test('sets spawnerPrompt to null when not present', async () => {
      mockDbSelect.mockImplementation(createMockDbSelect({
        publishers: [{ id: 'test-publisher' }],
        rootAgent: {
          id: 'test-agent',
          version: '1.0.0',
          publisher_id: 'test-publisher',
          data: { displayName: 'Test Agent', spawnableAgents: [] },
        },
      }))

      const response = await getDependencies({
        params: createMockParams(),
        logger: mockLogger,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.root.spawnerPrompt).toBeNull()
    })
  })
})
