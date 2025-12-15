import { TEST_AGENT_RUNTIME_IMPL } from '@codebuff/common/testing/impl/agent-runtime'
import {
  createMockFetch,
  createMockFetchError,
} from '@codebuff/common/testing/fixtures'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import { searchWeb } from '../linkup-api'

import type { AgentRuntimeDeps } from '@codebuff/common/types/contracts/agent-runtime'

// Test server env for Linkup API
const testServerEnv = { LINKUP_API_KEY: 'test-api-key' }

describe('Linkup API', () => {
  let agentRuntimeImpl: AgentRuntimeDeps & { serverEnv: typeof testServerEnv }

  beforeEach(() => {
    agentRuntimeImpl = {
      ...TEST_AGENT_RUNTIME_IMPL,
      serverEnv: testServerEnv,
    }
  })

  afterEach(() => {
    mock.restore()
  })

  afterAll(() => {})

  test('should successfully search with basic query', async () => {
    const mockResponse = {
      answer:
        'React is a JavaScript library for building user interfaces. You can learn how to build your first React application by following the official documentation.',
      sources: [
        {
          name: 'React Documentation',
          url: 'https://react.dev',
          snippet:
            'React is a JavaScript library for building user interfaces.',
        },
      ],
    }

    agentRuntimeImpl.fetch = createMockFetch({ json: mockResponse })

    const result = await searchWeb({
      ...agentRuntimeImpl,
      query: 'React tutorial',
    })

    expect(result).toBe(
      'React is a JavaScript library for building user interfaces. You can learn how to build your first React application by following the official documentation.',
    )

    // Verify fetch was called with correct parameters
    expect(agentRuntimeImpl.fetch).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
        body: JSON.stringify({
          q: 'React tutorial',
          depth: 'standard',
          outputType: 'sourcedAnswer',
        }),
      }),
    )
  })

  test('should handle custom depth', async () => {
    const mockResponse = {
      answer:
        'Advanced React patterns include render props, higher-order components, and custom hooks for building reusable and maintainable components.',
      sources: [
        {
          name: 'Advanced React Patterns',
          url: 'https://example.com/advanced-react',
          snippet: 'Deep dive into React patterns and best practices.',
        },
      ],
    }

    agentRuntimeImpl.fetch = createMockFetch({ json: mockResponse })

    const result = await searchWeb({
      ...agentRuntimeImpl,
      query: 'React patterns',
      depth: 'deep',
    })

    expect(result).toBe(
      'Advanced React patterns include render props, higher-order components, and custom hooks for building reusable and maintainable components.',
    )

    // Verify fetch was called with correct parameters
    expect(agentRuntimeImpl.fetch).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/search',
      expect.objectContaining({
        body: JSON.stringify({
          q: 'React patterns',
          depth: 'deep',
          outputType: 'sourcedAnswer',
        }),
      }),
    )
  })

  test('should handle API errors gracefully', async () => {
    agentRuntimeImpl.fetch = createMockFetch({
      status: 500,
      body: 'Internal Server Error',
    })

    const result = await searchWeb({ ...agentRuntimeImpl, query: 'test query' })

    expect(result).toBeNull()
  })

  test('should handle network errors', async () => {
    agentRuntimeImpl.fetch = createMockFetchError(new Error('Network error'))

    const result = await searchWeb({ ...agentRuntimeImpl, query: 'test query' })

    expect(result).toBeNull()
  })

  test('should handle invalid response format', async () => {
    agentRuntimeImpl.fetch = createMockFetch({ json: { invalid: 'format' } })

    const result = await searchWeb({ ...agentRuntimeImpl, query: 'test query' })

    expect(result).toBeNull()
  })

  test('should handle missing answer field', async () => {
    agentRuntimeImpl.fetch = createMockFetch({ json: { sources: [] } })

    const result = await searchWeb({
      ...agentRuntimeImpl,
      query: 'test query',
    })

    expect(result).toBeNull()
  })
  test('should handle empty answer', async () => {
    agentRuntimeImpl.fetch = createMockFetch({
      json: { answer: '', sources: [] },
    })

    const result = await searchWeb({ ...agentRuntimeImpl, query: 'test query' })

    expect(result).toBeNull()
  })

  test('should use default options when none provided', async () => {
    const mockResponse = {
      answer: 'Test answer content',
      sources: [
        { name: 'Test', url: 'https://example.com', snippet: 'Test content' },
      ],
    }

    agentRuntimeImpl.fetch = createMockFetch({ json: mockResponse })

    await searchWeb({ ...agentRuntimeImpl, query: 'test query' })

    // Verify fetch was called with default parameters
    expect(agentRuntimeImpl.fetch).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/search',
      expect.objectContaining({
        body: JSON.stringify({
          q: 'test query',
          depth: 'standard',
          outputType: 'sourcedAnswer',
        }),
      }),
    )
  })

  test('should handle malformed JSON response', async () => {
    agentRuntimeImpl.fetch = createMockFetch({
      body: 'invalid json{',
      headers: { 'Content-Type': 'application/json' },
    })
    agentRuntimeImpl.logger.error = mock(() => {})

    const result = await searchWeb({ ...agentRuntimeImpl, query: 'test query' })

    expect(result).toBeNull()
    // Verify that error logging was called
    expect(agentRuntimeImpl.logger.error).toHaveBeenCalled()
  })

  test('should log detailed error information for 404 responses', async () => {
    const mockErrorResponse =
      'Not Found - The requested endpoint does not exist'
    agentRuntimeImpl.fetch = createMockFetch({
      status: 404,
      body: mockErrorResponse,
      headers: { 'Content-Type': 'text/plain' },
    })

    const result = await searchWeb({
      ...agentRuntimeImpl,
      query: 'test query for 404',
    })

    expect(result).toBeNull()
    // Verify that detailed error logging was called with 404 info
    expect(agentRuntimeImpl.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 404,
        statusText: 'Not Found',
        responseBody: mockErrorResponse,
        requestUrl: 'https://api.linkup.so/v1/search',
        query: 'test query for 404',
      }),
      expect.stringContaining('404'),
    )
  })
})
