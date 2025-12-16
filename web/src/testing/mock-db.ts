import { mock } from 'bun:test'

import type { Logger } from '@codebuff/common/types/contracts/logger'

/**
 * Configuration for creating a mock database that simulates
 * the batch querying pattern used in agent-related API routes.
 */
export interface MockDbConfig {
  /** List of publishers to return from the publishers table */
  publishers?: Array<{ id: string }>
  /** The root agent to return, or null if not found */
  rootAgent?: {
    id: string
    version: string
    publisher_id: string
    data: unknown
  } | null
  /** Child agents to return for batch queries */
  childAgents?: Array<{
    id: string
    version: string
    publisher_id: string
    data: unknown
  }>
}

/**
 * Creates a mock database select function that handles the batch querying pattern:
 * 1. First query: fetch ALL publishers (uses .then directly on from())
 * 2. Second query: fetch root agent (with where clause)
 * 3. Subsequent queries: batch queries for child agents (with where and possibly orderBy)
 * 
 * This is designed for testing API routes that use the batch querying pattern
 * like the agent dependencies route.
 * 
 * @example
 * ```ts
 * const mockDbSelect = mock(() => ({}))
 * mock.module('@codebuff/internal/db', () => ({ default: { select: mockDbSelect } }))
 * 
 * // In test:
 * mockDbSelect.mockImplementation(createMockDbSelect({
 *   publishers: [{ id: 'test-publisher' }],
 *   rootAgent: { id: 'test-agent', version: '1.0.0', publisher_id: 'test-publisher', data: {} },
 * }))
 * ```
 */
export function createMockDbSelect(config: MockDbConfig) {
  let queryCount = 0

  return mock(() => ({
    from: mock(() => {
      queryCount++
      const isPublisherTable = queryCount === 1 // First query is always publishers

      if (isPublisherTable) {
        // Publishers query - returns all publishers directly via .then on from()
        return {
          where: mock(() => ({
            then: mock(async (cb: (rows: unknown[]) => unknown) =>
              cb(config.publishers ?? []),
            ),
            orderBy: mock(() => ({
              then: mock(async (cb: (rows: unknown[]) => unknown) => cb([])),
              limit: mock(() => ({
                then: mock(async (cb: (rows: unknown[]) => unknown) => cb([])),
              })),
            })),
          })),
          then: mock(async (cb: (rows: unknown[]) => unknown) =>
            cb(config.publishers ?? []),
          ),
        }
      }

      // Agent queries
      return {
        where: mock(() => ({
          then: mock(async (cb: (rows: unknown[]) => unknown) => {
            if (queryCount === 2) {
              // Root agent query
              return cb(config.rootAgent ? [config.rootAgent] : [])
            }
            // Batch child agent queries
            return cb(config.childAgents ?? [])
          }),
          orderBy: mock(() => ({
            then: mock(async (cb: (rows: unknown[]) => unknown) =>
              cb(config.childAgents ?? []),
            ),
            limit: mock(() => ({
              then: mock(async (cb: (rows: unknown[]) => unknown) =>
                cb(config.childAgents ?? []),
              ),
            })),
          })),
        })),
        then: mock(async (cb: (rows: unknown[]) => unknown) => cb([])),
      }
    }),
  }))
}

/**
 * Creates a mock logger for testing API routes.
 * All methods are mocked and can be asserted against.
 */
export function createMockLogger(): Logger {
  return {
    error: mock(() => {}),
    warn: mock(() => {}),
    info: mock(() => {}),
    debug: mock(() => {}),
  }
}

/**
 * Mock schema for the internal database schema.
 * Use this with mock.module to mock '@codebuff/internal/db/schema'.
 */
export const mockDbSchema = {
  publisher: { id: 'publisher.id' },
  agentConfig: {
    id: 'agentConfig.id',
    version: 'agentConfig.version',
    publisher_id: 'agentConfig.publisher_id',
    major: 'agentConfig.major',
    minor: 'agentConfig.minor',
    patch: 'agentConfig.patch',
    data: 'agentConfig.data',
  },
}
