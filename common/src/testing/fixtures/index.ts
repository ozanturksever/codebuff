/**
 * Test fixtures barrel file.
 *
 * Re-exports all test fixtures for cleaner imports:
 * @example
 * ```ts
 * import { testLogger, createMockFetch, createGrantCreditsDbMock } from '@codebuff/common/testing/fixtures'
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
  createGrantCreditsDbMock,
  createOrgBillingDbMock,
  createOrgBillingTransactionMock,
  createCreditDelegationDbMock,
  type GrantCreditsMockOptions,
  type GrantCreditsDbConn,
  type GrantCreditsTx,
  type OrgBillingGrant,
  type OrgBillingMockOptions,
  type OrgBillingDbConn,
  type OrgBillingWithTransactionFn,
  type UserOrganization,
  type OrgRepo,
  type CreditDelegationMockOptions,
  type CreditDelegationDbConn,
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
