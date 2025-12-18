/**
 * Test-only database mock fixtures.
 *
 * Provides typed mock factories for Drizzle ORM query patterns.
 * These helpers create properly-typed mocks for common query chains.
 */

import { mock } from 'bun:test'

/**
 * Version data returned from agent config queries.
 */
export type VersionRow = {
  major: number | null
  minor: number | null
  patch: number | null
}

/**
 * Creates a mock database for version queries that use the pattern:
 * db.select().from().where().orderBy().limit()
 *
 * @param result - The array of version rows to return from the query
 * @returns A mock database object with the chained query builder pattern
 *
 * @example
 * ```ts
 * const mockDb = createVersionQueryDbMock([{ major: 1, minor: 2, patch: 3 }])
 * const result = await getLatestAgentVersion({ db: mockDb, ... })
 * ```
 */
export function createVersionQueryDbMock<T = VersionRow>(result: T[]) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve(result)),
          })),
        })),
      })),
    })),
  }
}

/**
 * Creates a mock database for existence check queries that use the pattern:
 * db.select().from().where()
 *
 * @param result - The array of rows to return from the query
 * @returns A mock database object with the chained query builder pattern
 *
 * @example
 * ```ts
 * const mockDb = createExistsQueryDbMock([{ id: 'agent-1' }])
 * const exists = await versionExists({ db: mockDb, ... })
 * ```
 */
export function createExistsQueryDbMock<T = { id: string }>(result: T[]) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(result)),
      })),
    })),
  }
}
