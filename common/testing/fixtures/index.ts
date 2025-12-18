/**
 * Test fixtures barrel file.
 *
 * Re-exports all test fixtures for cleaner imports:
 * @example
 * ```ts
 * import { testLogger, createMockFetch, createGrantCreditsStoreMock } from '@codebuff/common/testing/fixtures'
 * ```
 */

// Agent runtime fixtures
export {
  testLogger,
  testFetch,
  testClientEnv,
  testCiEnv,
  TEST_AGENT_RUNTIME_IMPL,
  mockAnalytics,
  mockBigQuery,
  mockRandomUUID,
} from './agent-runtime'

// Billing database mock fixtures
export {
  createGrantCreditsStoreMock,
  createOrgBillingStoreMock,
  createCreditDelegationStoreMock,
  type GrantCreditsMockOptions,
  type GrantCreditsStore,
  type GrantCreditsTxStore,
  type OrgBillingGrant,
  type OrgBillingMockOptions,
  type OrgBillingStore,
  type OrgBillingTxStore,
  type UserOrganization,
  type OrgRepo,
  type CreditDelegationMockOptions,
  type CreditDelegationStore,
} from './billing'

// Database mock fixtures
export {
  createVersionQueryDbMock,
  createExistsQueryDbMock,
  type VersionRow,
} from './database'

// Fetch mock fixtures
export {
  createMockFetch,
  createMockFetchError,
  createMockFetchCustom,
  createMockFetchPartial,
  wrapMockAsFetch,
  type FetchFn,
  type FetchCallFn,
  type MockFetchFn,
  type MockFetchResponseConfig,
} from './fetch'

// Environment fixtures
export { createTestBaseEnv, createTestProcessEnv } from './env-process'
export { createTestCiEnv } from './env-ci'

// Module mocking utilities
export { mockModule, clearMockedModules, type MockResult } from './mock-modules'
