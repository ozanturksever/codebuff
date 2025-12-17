/**
 * Test-only billing database mock fixtures.
 *
 * Provides typed mock factories for billing-related database operations.
 * These helpers create properly-typed mocks without requiring ugly `as unknown as` casts.
 */

import type { Logger } from '../../types/contracts/logger'

// Re-export the test logger for convenience
export { testLogger } from './agent-runtime'

/**
 * Chainable query builder mock - matches Drizzle's query builder pattern
 */
type ChainableQuery<TResult> = {
  from: () => ChainableQuery<TResult>
  where: () => ChainableQuery<TResult>
  orderBy: () => ChainableQuery<TResult>
  limit: () => TResult
  innerJoin: () => ChainableQuery<TResult>
  then: <TNext>(cb: (result: TResult) => TNext) => TNext
}

function createChainableQuery<TResult>(result: TResult): ChainableQuery<TResult> {
  const chain: ChainableQuery<TResult> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => result,
    innerJoin: () => chain,
    then: (cb) => cb(result),
  }
  return chain
}

// ============================================================================
// Grant Credits Mock (packages/billing/src/grant-credits.ts)
// ============================================================================

export interface GrantCreditsMockOptions {
  user: {
    next_quota_reset: Date | null
    auto_topup_enabled: boolean | null
  } | null
}

/**
 * Database connection shape for grant-credits module.
 * Structurally matches BillingDbConn from grant-credits.ts
 */
export interface GrantCreditsDbConn {
  transaction: <T>(callback: (tx: GrantCreditsTx) => Promise<T>) => Promise<T>
  select: () => ChainableQuery<never[]>
}

export interface GrantCreditsTx {
  query: {
    user: {
      findFirst: () => Promise<GrantCreditsMockOptions['user']>
    }
  }
  update: () => { set: () => { where: () => Promise<void> } }
  insert: () => { values: () => Promise<void> }
  select: () => ChainableQuery<never[]>
}

/**
 * Creates a typed mock database for grant-credits tests.
 *
 * @example
 * ```ts
 * const mockDb = createGrantCreditsDbMock({
 *   user: { next_quota_reset: futureDate, auto_topup_enabled: true },
 * })
 *
 * const result = await triggerMonthlyResetAndGrant({
 *   userId: 'user-123',
 *   logger,
 *   conn: mockDb,
 * })
 * ```
 */
export function createGrantCreditsDbMock(
  options: GrantCreditsMockOptions,
): GrantCreditsDbConn {
  const { user } = options

  const createTx = (): GrantCreditsTx => ({
    query: {
      user: {
        findFirst: async () => user,
      },
    },
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve(),
    }),
    select: () => createChainableQuery<never[]>([]),
  })

  return {
    transaction: async (callback) => callback(createTx()),
    select: () => createChainableQuery<never[]>([]),
  }
}

// ============================================================================
// Org Billing Mock (packages/billing/src/org-billing.ts)
// ============================================================================

export interface OrgBillingGrant {
  operation_id: string
  user_id: string
  organization_id: string
  principal: number
  balance: number
  type: 'organization'
  description: string
  priority: number
  expires_at: Date
  created_at: Date
}

export interface OrgBillingMockOptions {
  grants?: OrgBillingGrant[]
  insert?: () => { values: () => Promise<unknown> }
  update?: () => { set: () => { where: () => Promise<unknown> } }
}

/**
 * Database connection shape for org-billing module.
 * Structurally matches OrgBillingDbConn from org-billing.ts
 */
export interface OrgBillingDbConn {
  select: () => {
    from: () => {
      where: () => {
        orderBy: () => OrgBillingGrant[]
      }
    }
  }
  insert: () => { values: () => Promise<unknown> }
  update: () => { set: () => { where: () => Promise<unknown> } }
}

/**
 * Transaction wrapper function type for org-billing.
 */
export type OrgBillingWithTransactionFn = <T>(params: {
  callback: (tx: OrgBillingDbConn) => Promise<T>
  context: Record<string, unknown>
  logger: Logger
}) => Promise<T>

/**
 * Creates a typed mock database for org-billing tests.
 *
 * @example
 * ```ts
 * const mockDb = createOrgBillingDbMock({ grants: mockGrants })
 *
 * const result = await calculateOrganizationUsageAndBalance({
 *   organizationId: 'org-123',
 *   quotaResetDate: new Date(),
 *   now: new Date(),
 *   logger,
 *   conn: mockDb,
 * })
 * ```
 */
export function createOrgBillingDbMock(
  options?: OrgBillingMockOptions,
): OrgBillingDbConn {
  const { grants = [], insert, update } = options ?? {}

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => grants,
        }),
      }),
    }),
    insert:
      insert ??
      (() => ({
        values: () => Promise.resolve(),
      })),
    update:
      update ??
      (() => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      })),
  }
}

/**
 * Creates a mock transaction wrapper that immediately calls the callback.
 *
 * @example
 * ```ts
 * const mockDb = createOrgBillingDbMock({ grants: mockGrants })
 * const mockWithTransaction = createOrgBillingTransactionMock(mockDb)
 *
 * await consumeOrganizationCredits({
 *   organizationId: 'org-123',
 *   creditsToConsume: 100,
 *   logger,
 *   withTransaction: mockWithTransaction,
 * })
 * ```
 */
export function createOrgBillingTransactionMock(
  mockDb: OrgBillingDbConn,
): OrgBillingWithTransactionFn {
  return async ({ callback }) => callback(mockDb)
}

// ============================================================================
// Credit Delegation Mock (packages/billing/src/credit-delegation.ts)
// ============================================================================

export interface UserOrganization {
  orgId: string
  orgName: string
  orgSlug: string
}

export interface OrgRepo {
  repoUrl: string
  repoName: string
  isActive: boolean
}

export interface CreditDelegationMockOptions {
  userOrganizations?: UserOrganization[]
  orgRepos?: OrgRepo[]
}

/**
 * Database connection shape for credit-delegation module.
 * Structurally matches CreditDelegationDbConn from credit-delegation.ts
 */
export interface CreditDelegationDbConn {
  select: (fields: Record<string, unknown>) => {
    from: () => {
      innerJoin?: () => {
        where: () => Promise<UserOrganization[]>
      }
      where: () => Promise<OrgRepo[]>
    }
  }
}

/**
 * Creates a typed mock database for credit-delegation tests.
 * The select function inspects the fields to determine which data to return.
 *
 * @example
 * ```ts
 * const mockDb = createCreditDelegationDbMock({
 *   userOrganizations: [{ orgId: 'org-123', orgName: 'Test Org', orgSlug: 'test-org' }],
 *   orgRepos: [{ repoUrl: 'https://github.com/test/repo', repoName: 'repo', isActive: true }],
 * })
 *
 * const result = await findOrganizationForRepository({
 *   userId: 'user-123',
 *   repositoryUrl: 'https://github.com/test/repo',
 *   logger,
 *   conn: mockDb,
 * })
 * ```
 */
export function createCreditDelegationDbMock(
  options?: CreditDelegationMockOptions,
): CreditDelegationDbConn {
  const { userOrganizations = [], orgRepos = [] } = options ?? {}

  return {
    select: (fields: Record<string, unknown>) => {
      // Return user organizations when querying for orgId/orgName fields
      if ('orgId' in fields && 'orgName' in fields) {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => Promise.resolve(userOrganizations),
            }),
            where: () => Promise.resolve<OrgRepo[]>([]),
          }),
        }
      }

      // Return org repos when querying for repoUrl field
      if ('repoUrl' in fields) {
        return {
          from: () => ({
            where: () => Promise.resolve(orgRepos),
          }),
        }
      }

      // Default: return empty array
      return {
        from: () => ({
          where: () => Promise.resolve<OrgRepo[]>([]),
        }),
      }
    },
  }
}
