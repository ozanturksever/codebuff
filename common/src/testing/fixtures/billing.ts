/**
 * Test-only billing database mock fixtures.
 *
 * Provides typed mock factories for billing-related database operations.
 * These helpers create properly-typed mocks without requiring ugly `as unknown as` casts.
 */

import type { Logger } from '../../types/contracts/logger'

// Re-export the test logger for convenience
export { testLogger } from './agent-runtime'

// ============================================================================
// Grant Credits Mock (packages/billing/src/grant-credits.ts)
// ============================================================================

export interface GrantCreditsMockOptions {
  user: {
    next_quota_reset: Date | null
    auto_topup_enabled: boolean | null
  } | null
  previousExpiredFreeGrantPrincipal?: number | null
  totalReferralBonusCredits?: number
}

export interface CreditLedgerGrant {
  type: 'free' | 'referral' | 'purchase' | 'admin' | 'organization'
  created_at: Date
  expires_at: Date | null
  operation_id: string
  user_id: string
  principal: number
  balance: number
  description: string | null
  priority: number
  org_id: string | null
}

/**
 * Minimal data access interface for grant-credits module.
 * Structurally matches GrantCreditsStore from packages/billing/src/grant-credits.ts
 */
export interface GrantCreditsTxStore {
  getMonthlyResetUser(params: { userId: string }): Promise<GrantCreditsMockOptions['user']>
  updateUserNextQuotaReset(params: {
    userId: string
    nextQuotaReset: Date
  }): Promise<void>
  getMostRecentExpiredFreeGrantPrincipal(params: {
    userId: string
    now: Date
  }): Promise<number | null>
  getTotalReferralBonusCredits(params: { userId: string }): Promise<number>
  listActiveCreditGrants(params: {
    userId: string
    now: Date
  }): Promise<CreditLedgerGrant[]>
  updateCreditLedgerBalance(params: {
    operationId: string
    balance: number
  }): Promise<void>
  insertCreditLedgerEntry(values: Record<string, unknown>): Promise<void>
}

/**
 * Store interface for grant-credits.
 */
export interface GrantCreditsStore extends GrantCreditsTxStore {
  withTransaction<T>(callback: (tx: GrantCreditsTxStore) => Promise<T>): Promise<T>
}

/**
 * Creates a typed mock store for grant-credits tests.
 *
 * @example
 * ```ts
 * const mockStore = createGrantCreditsStoreMock({
 *   user: { next_quota_reset: futureDate, auto_topup_enabled: true },
 * })
 *
 * const result = await triggerMonthlyResetAndGrant({
 *   userId: 'user-123',
 *   logger,
 *   store: mockStore,
 * })
 * ```
 */
export function createGrantCreditsStoreMock(
  options: GrantCreditsMockOptions,
): GrantCreditsStore {
  const {
    user,
    previousExpiredFreeGrantPrincipal = null,
    totalReferralBonusCredits = 0,
  } = options

  const txStore: GrantCreditsTxStore = {
    getMonthlyResetUser: async () => user,
    updateUserNextQuotaReset: async () => {},
    getMostRecentExpiredFreeGrantPrincipal: async () =>
      previousExpiredFreeGrantPrincipal,
    getTotalReferralBonusCredits: async () => totalReferralBonusCredits,
    listActiveCreditGrants: async () => [],
    updateCreditLedgerBalance: async () => {},
    insertCreditLedgerEntry: async () => {},
  }

  return {
    ...txStore,
    withTransaction: async (callback) => callback(txStore),
  }
}

// ============================================================================
// Org Billing Mock (packages/billing/src/org-billing.ts)
// ============================================================================

export interface OrgBillingGrant {
  operation_id: string
  user_id: string
  org_id: string
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
  insertCreditLedgerEntry?: (values: Record<string, unknown>) => Promise<void>
  updateCreditLedgerBalance?: (params: {
    operationId: string
    balance: number
  }) => Promise<void>
}

/**
 * Transaction store interface for org-billing.
 * Structurally matches OrgBillingTxStore from packages/billing/src/org-billing.ts
 */
export interface OrgBillingTxStore {
  listOrderedActiveOrganizationGrants(params: {
    organizationId: string
    now: Date
  }): Promise<OrgBillingGrant[]>
  insertCreditLedgerEntry(values: Record<string, unknown>): Promise<void>
  updateCreditLedgerBalance(params: {
    operationId: string
    balance: number
  }): Promise<void>
}

/**
 * Store interface for org-billing.
 * Structurally matches OrgBillingStore from packages/billing/src/org-billing.ts
 */
export interface OrgBillingStore extends OrgBillingTxStore {
  withTransaction<T>(params: {
    callback: (tx: OrgBillingTxStore) => Promise<T>
    context: Record<string, unknown>
    logger: Logger
  }): Promise<T>
}

/**
 * Creates a typed mock store for org-billing tests.
 *
 * @example
 * ```ts
 * const mockStore = createOrgBillingStoreMock({ grants: mockGrants })
 *
 * const result = await calculateOrganizationUsageAndBalance({
 *   organizationId: 'org-123',
 *   quotaResetDate: new Date(),
 *   now: new Date(),
 *   logger,
 *   store: mockStore,
 * })
 * ```
 */
export function createOrgBillingStoreMock(
  options?: OrgBillingMockOptions,
): OrgBillingStore {
  const { grants = [], insertCreditLedgerEntry, updateCreditLedgerBalance } =
    options ?? {}

  const txStore: OrgBillingTxStore = {
    listOrderedActiveOrganizationGrants: async () => grants,
    insertCreditLedgerEntry:
      insertCreditLedgerEntry ??
      (async () => {
        return
      }),
    updateCreditLedgerBalance: async (params) => {
      await updateCreditLedgerBalance?.(params)
    },
  }

  return {
    ...txStore,
    withTransaction: async ({ callback }) => callback(txStore),
  }
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
 * Minimal data access interface for credit-delegation module.
 * Structurally matches CreditDelegationStore from packages/billing/src/credit-delegation.ts
 */
export interface CreditDelegationStore {
  listUserOrganizations(params: { userId: string }): Promise<UserOrganization[]>
  listActiveOrganizationRepos(params: {
    organizationId: string
  }): Promise<OrgRepo[]>
}

/**
 * Creates a typed mock data store for credit-delegation tests.
 *
 * @example
 * ```ts
 * const mockStore = createCreditDelegationStoreMock({
 *   userOrganizations: [{ orgId: 'org-123', orgName: 'Test Org', orgSlug: 'test-org' }],
 *   orgRepos: [{ repoUrl: 'https://github.com/test/repo', repoName: 'repo', isActive: true }],
 * })
 *
 * const result = await findOrganizationForRepository({
 *   userId: 'user-123',
 *   repositoryUrl: 'https://github.com/test/repo',
 *   logger,
 *   store: mockStore,
 * })
 * ```
 */
export function createCreditDelegationStoreMock(
  options?: CreditDelegationMockOptions,
): CreditDelegationStore {
  const { userOrganizations = [], orgRepos = [] } = options ?? {}

  return {
    listUserOrganizations: async () => userOrganizations,
    listActiveOrganizationRepos: async () => orgRepos.filter((repo) => repo.isActive),
  }
}
