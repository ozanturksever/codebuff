import { mock } from 'bun:test'

import type {
  TestableDb,
  TestableDbWhereResult,
} from '@codebuff/common/types/contracts/database'
import type { Logger } from '@codebuff/common/types/contracts/logger'

// ============================================================================
// Types
// ============================================================================

/** Callback type for insert operations */
export type InsertCallback = (values: unknown) => Promise<void> | void

/** Callback type for update operations */
export type UpdateCallback = () => Promise<void> | void

/** Callback type for select results */
export type SelectResultsCallback = () => unknown[] | Promise<unknown[]>

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

// ============================================================================
// Insert Mock
// ============================================================================

/**
 * Configuration for mock insert operations.
 */
export interface MockDbInsertConfig {
  /** Callback invoked when values() is called. Defaults to no-op. */
  onValues?: InsertCallback
}

/**
 * Creates a mock database insert function that simulates the pattern:
 * `db.insert(table).values(data)`
 *
 * @example
 * ```ts
 * const mockInsert = createMockDbInsert({
 *   onValues: async (values) => {
 *     // Verify or capture the inserted values
 *     expect(values).toHaveProperty('id')
 *   },
 * })
 *
 * const mockDb = { insert: mockInsert }
 * ```
 */
export function createMockDbInsert(config: MockDbInsertConfig = {}) {
  const { onValues = async () => {} } = config

  return mock(() => ({
    values: mock(async (values: unknown) => {
      await onValues(values)
    }),
  }))
}

// ============================================================================
// Update Mock
// ============================================================================

/**
 * Configuration for mock update operations.
 */
export interface MockDbUpdateConfig {
  /** Callback invoked when where() is called. Defaults to no-op. */
  onWhere?: UpdateCallback
}

/**
 * Creates a mock database update function that simulates the pattern:
 * `db.update(table).set(data).where(condition)`
 *
 * @example
 * ```ts
 * const mockUpdate = createMockDbUpdate({
 *   onWhere: async () => {
 *     // Update completed
 *   },
 * })
 *
 * const mockDb = { update: mockUpdate }
 * ```
 */
export function createMockDbUpdate(config: MockDbUpdateConfig = {}) {
  const { onWhere = async () => {} } = config

  return mock(() => ({
    set: mock(() => ({
      where: mock(async () => {
        await onWhere()
      }),
    })),
  }))
}

// ============================================================================
// Simple Select Mock
// ============================================================================

/**
 * Configuration for mock simple select operations (not batch pattern).
 */
export interface MockDbSimpleSelectConfig {
  /**
   * Results to return from the select query.
   * Can be a static array or a callback for dynamic results.
   */
  results?: unknown[] | SelectResultsCallback
}

/**
 * Creates a mock database select function that simulates the pattern:
 * `db.select().from(table).where(condition).limit(n)`
 *
 * This is for simple queries, not the batch pattern used by createMockDbSelect.
 *
 * @example
 * ```ts
 * const mockSelect = createMockDbSimpleSelect({
 *   results: [{ id: 'user-123', name: 'Test User' }],
 * })
 *
 * const mockDb = { select: mockSelect }
 * ```
 */
export function createMockDbSimpleSelect(config: MockDbSimpleSelectConfig = {}) {
  const { results = [] } = config

  const getResults = async () => {
    if (typeof results === 'function') {
      return results()
    }
    return results
  }

  return mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        limit: mock(async () => getResults()),
        then: mock(async (cb?: ((rows: unknown[]) => unknown) | null) => {
          const data = await getResults()
          return cb?.(data) ?? data
        }),
        orderBy: mock(() => ({
          limit: mock(async () => getResults()),
          then: mock(async (cb?: ((rows: unknown[]) => unknown) | null) => {
            const data = await getResults()
            return cb?.(data) ?? data
          }),
        })),
      })),
      then: mock(async (cb?: ((rows: unknown[]) => unknown) | null) => {
        const data = await getResults()
        return cb?.(data) ?? data
      }),
    })),
  }))
}

// ============================================================================
// Complete Mock Database Factory
// ============================================================================

/**
 * Configuration for creating a complete mock database object.
 */
export interface MockDbFactoryConfig {
  /** Configuration for insert operations */
  insert?: MockDbInsertConfig
  /** Configuration for update operations */
  update?: MockDbUpdateConfig
  /** Configuration for simple select operations */
  select?: MockDbSimpleSelectConfig
}

/**
 * Return type of createMockDb - a complete mock database object.
 * Implements TestableDb for type-safe dependency injection in tests.
 */
export type MockDb = TestableDb

/**
 * Creates a complete mock database object with insert, update, and select operations.
 *
 * This is the recommended way to create a mock database for testing API routes
 * that perform multiple types of database operations.
 *
 * @example
 * ```ts
 * let mockDb: MockDb
 *
 * beforeEach(() => {
 *   mockDb = createMockDb({
 *     insert: {
 *       onValues: async (values) => console.log('Inserted:', values),
 *     },
 *     update: {
 *       onWhere: async () => console.log('Updated'),
 *     },
 *     select: {
 *       results: [{ id: 'user-123' }],
 *     },
 *   })
 * })
 * ```
 */
export function createMockDb(config: MockDbFactoryConfig = {}): TestableDb {
  // Use type assertion since Mock types don't perfectly match TestableDb
  // but the runtime behavior is correct
  return {
    insert: createMockDbInsert(config.insert),
    update: createMockDbUpdate(config.update),
    select: createMockDbSimpleSelect(config.select) as TestableDb['select'],
  }
}

/**
 * Creates a mock database with insert and update that throw errors.
 * Useful for testing error handling paths.
 *
 * @example
 * ```ts
 * const mockDb = createMockDbWithErrors({
 *   insertError: new Error('Database connection failed'),
 *   selectResults: [{ user_id: 'user-123' }], // Optional: results to return before error
 * })
 * ```
 */
export function createMockDbWithErrors(config: {
  insertError?: Error
  updateError?: Error
  selectError?: Error
  /** Results to return from select queries (before any error is thrown) */
  selectResults?: unknown[]
} = {}): TestableDb {
  const { insertError, updateError, selectError, selectResults = [] } = config

  // Use type assertion since Mock types don't perfectly match TestableDb
  // but the runtime behavior is correct
  return {
    insert: mock(() => ({
      values: mock(async () => {
        if (insertError) throw insertError
      }),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(async () => {
          if (updateError) throw updateError
        }),
      })),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(async () => {
            if (selectError) throw selectError
            return selectResults
          }),
          then: mock(async (cb?: ((rows: unknown[]) => unknown) | null) => {
            if (selectError) throw selectError
            return cb?.(selectResults) ?? selectResults
          }),
          orderBy: mock(() => ({
            limit: mock(async () => {
              if (selectError) throw selectError
              return selectResults
            }),
            then: mock(async (cb?: ((rows: unknown[]) => unknown) | null) => {
              if (selectError) throw selectError
              return cb?.(selectResults) ?? selectResults
            }),
          })),
        })),
        then: mock(async (cb?: ((rows: unknown[]) => unknown) | null) => {
          if (selectError) throw selectError
          return cb?.(selectResults) ?? selectResults
        }),
      })),
    })) as TestableDb['select'],
  }
}

// ============================================================================
// Version Utils Mock Database
// ============================================================================

/**
 * Creates a mock database for version-utils and similar queries that use
 * the pattern: `db.select().from().where().orderBy().limit().then()`
 *
 * This is a simpler mock that doesn't use bun:test mocks, making it
 * type-safe without requiring mock type assertions.
 *
 * @param selectResults - The results to return from select queries
 *
 * @example
 * ```ts
 * const mockDb = createSelectOnlyMockDb([{ major: 1, minor: 2, patch: 3 }])
 *
 * const result = await getLatestAgentVersion({
 *   agentId: 'test-agent',
 *   publisherId: 'test-publisher',
 *   db: mockDb,
 * })
 * ```
 */
export function createSelectOnlyMockDb(selectResults: unknown[]): TestableDb {
  const createWhereResult = (): TestableDbWhereResult => ({
    then: <TResult = unknown[]>(
      onfulfilled?:
        | ((value: unknown[]) => TResult | PromiseLike<TResult>)
        | null
        | undefined,
    ): PromiseLike<TResult> => {
      if (onfulfilled) {
        return Promise.resolve(onfulfilled(selectResults))
      }
      return Promise.resolve(selectResults as unknown as TResult)
    },
    limit: () => Promise.resolve(selectResults),
    orderBy: () => ({
      limit: () => Promise.resolve(selectResults),
    }),
  })

  return {
    insert: () => ({
      values: () => Promise.resolve(),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => createWhereResult(),
      }),
    }),
  }
}

/**
 * @deprecated Use createSelectOnlyMockDb instead. This is an alias for backwards compatibility.
 */
export const createVersionUtilsMockDb = createSelectOnlyMockDb

