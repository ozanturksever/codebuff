import { trackEvent } from '@codebuff/common/analytics'
import { AnalyticsEvent } from '@codebuff/common/constants/analytics-events'
import { GRANT_PRIORITIES } from '@codebuff/common/constants/grant-priorities'
import { DEFAULT_FREE_CREDITS_GRANT } from '@codebuff/common/old-constants'
import type { OptionalFields } from '@codebuff/common/types/function-params'
import { getNextQuotaReset } from '@codebuff/common/util/dates'
import { withRetry } from '@codebuff/common/util/promise'
import db from '@codebuff/internal/db'
import * as schema from '@codebuff/internal/db/schema'
import { logSyncFailure } from '@codebuff/internal/util/sync-failure'
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'

import { generateOperationIdTimestamp } from './utils'

import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { GrantType } from '@codebuff/internal/db/schema'

type CreditGrantSelect = typeof schema.creditLedger.$inferSelect
type DbTransaction = Parameters<typeof db.transaction>[0] extends (
  tx: infer T,
) => any
  ? T
  : never

// Minimal structural type for database connection
// This type is intentionally permissive to allow mock injection in tests
export type BillingDbConn = {
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>
  select: (fields?: any) => any
}

/**
 * Finds the amount of the most recent expired 'free' grant for a user.
 * Finds the amount of the most recent expired 'free' grant for a user,
 * excluding migration grants (operation_id starting with 'migration-').
 * If there is a previous grant, caps the amount at 2000 credits.
 * If no expired 'free' grant is found, returns the default free limit.
 * @param userId The ID of the user.
 * @returns The amount of the last expired free grant (capped at 2000) or the default.
 */
export async function getPreviousFreeGrantAmount(
  params: OptionalFields<
    {
      userId: string
      logger: Logger
      conn: BillingDbConn
    },
    'conn'
  >,
): Promise<number> {
  const { conn = db, ...rest } = params
  const { userId, logger } = rest

  const now = new Date()
  const lastExpiredFreeGrant = await conn
    .select({
      principal: schema.creditLedger.principal,
    })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.user_id, userId),
        eq(schema.creditLedger.type, 'free'),
        lte(schema.creditLedger.expires_at, now), // Grant has expired
      ),
    )
    .orderBy(desc(schema.creditLedger.expires_at)) // Most recent expiry first
    .limit(1)

  if (lastExpiredFreeGrant.length > 0) {
    const amount = lastExpiredFreeGrant[0].principal
    logger.debug(
      { userId, amount },
      'Found previous expired free grant amount.',
    )
    return amount
  } else {
    logger.debug(
      { userId, defaultAmount: DEFAULT_FREE_CREDITS_GRANT },
      'No previous expired free grant found. Using default.',
    )
    return DEFAULT_FREE_CREDITS_GRANT // Default if no previous grant found
  }
}

/**
 * Calculates the total referral bonus credits a user should receive based on
 * their referral history (both as referrer and referred).
 * @param userId The ID of the user.
 * @returns The total referral bonus credits earned.
 */
export async function calculateTotalReferralBonus(
  params: OptionalFields<
    {
      userId: string
      logger: Logger
      conn: BillingDbConn
    },
    'conn'
  >,
): Promise<number> {
  const { conn = db, ...rest } = params
  const { userId, logger } = rest

  try {
    const result = await conn
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${schema.referral.credits}), 0)`,
      })
      .from(schema.referral)
      .where(
        or(
          eq(schema.referral.referrer_id, userId),
          eq(schema.referral.referred_id, userId),
        ),
      )

    const totalBonus = parseInt(result[0]?.totalCredits ?? '0')
    logger.debug({ userId, totalBonus }, 'Calculated total referral bonus.')
    return totalBonus
  } catch (error) {
    logger.error(
      { userId, error },
      'Error calculating total referral bonus. Returning 0.',
    )
    return 0
  }
}

/**
 * Core grant operation that can be part of a larger transaction.
 */
export async function grantCreditOperation(params: {
  userId: string
  amount: number
  type: GrantType
  description: string
  expiresAt: Date | null
  operationId: string
  tx?: DbTransaction
  logger: Logger
}) {
  const {
    userId,
    amount,
    type,
    description,
    expiresAt,
    operationId,
    tx,
    logger,
  } = params

  const dbClient = tx || db

  const now = new Date()

  // If the grant already exists, we can safely ignore this error since
  // the operation is idempotent - the grant was already created successfully
  const isUniqueConstraintError = (error: any): boolean => {
    return (
      error.code === '23505' ||
      (error.message && error.message.includes('already exists'))
    )
  }

  // First check for any negative balances
  const negativeGrants = await dbClient
    .select()
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.user_id, userId),
        or(
          isNull(schema.creditLedger.expires_at),
          gt(schema.creditLedger.expires_at, now),
        ),
      ),
    )
    .then((grants) => grants.filter((g) => g.balance < 0))

  if (negativeGrants.length > 0) {
    const totalDebt = negativeGrants.reduce(
      (sum, g) => sum + Math.abs(g.balance),
      0,
    )
    for (const grant of negativeGrants) {
      await dbClient
        .update(schema.creditLedger)
        .set({ balance: 0 })
        .where(eq(schema.creditLedger.operation_id, grant.operation_id))
    }
    const remainingAmount = Math.max(0, amount - totalDebt)
    if (remainingAmount > 0) {
      try {
        await dbClient.insert(schema.creditLedger).values({
          operation_id: operationId,
          user_id: userId,
          principal: amount,
          balance: remainingAmount,
          type,
          description:
            totalDebt > 0
              ? `${description} (${totalDebt} credits used to clear existing debt)`
              : description,
          priority: GRANT_PRIORITIES[type],
          expires_at: expiresAt,
          created_at: now,
        })
      } catch (error: any) {
        if (isUniqueConstraintError(error)) {
          logger.info(
            { userId, operationId, type, amount },
            'Skipping duplicate credit grant due to idempotency check',
          )
          return
        }
        throw error
      }
    }
  } else {
    // No debt - create grant normally
    try {
      await dbClient.insert(schema.creditLedger).values({
        operation_id: operationId,
        user_id: userId,
        principal: amount,
        balance: amount,
        type,
        description,
        priority: GRANT_PRIORITIES[type],
        expires_at: expiresAt,
        created_at: now,
      })
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        logger.info(
          { userId, operationId, type, amount },
          'Skipping duplicate credit grant due to idempotency check',
        )
        return
      }
      throw error
    }
  }

  trackEvent({
    event: AnalyticsEvent.CREDIT_GRANT,
    userId,
    properties: {
      operationId,
      type,
      description,
      amount,
      expiresAt,
    },
    logger,
  })

  logger.info(
    { userId, operationId, type, amount, expiresAt },
    'Created new credit grant',
  )
}

/**
 * Processes a credit grant request with retries and failure logging.
 * Used for standalone credit grants that need retry logic and failure tracking.
 */
export async function processAndGrantCredit(params: {
  userId: string
  amount: number
  type: GrantType
  description: string
  expiresAt: Date | null
  operationId: string
  logger: Logger
}): Promise<void> {
  const { operationId, logger } = params

  try {
    await withRetry(() => grantCreditOperation(params), {
      maxRetries: 3,
      retryIf: () => true,
      onRetry: (error, attempt) => {
        logger.warn(
          { operationId, attempt, error },
          `processAndGrantCredit retry ${attempt}`,
        )
      },
    })
  } catch (error: any) {
    await logSyncFailure({
      id: operationId,
      errorMessage: error.message,
      provider: 'internal',
      logger,
    })
    logger.error(
      { operationId, error },
      'processAndGrantCredit failed after retries, logged to sync_failure',
    )
    throw error
  }
}

/**
 * Revokes credits from a specific grant by operation ID.
 * This sets the balance to 0 and updates the description to indicate a refund.
 *
 * @param operationId The operation ID of the grant to revoke
 * @param reason The reason for revoking the credits (e.g. refund)
 * @returns true if the grant was found and revoked, false otherwise
 */
export async function revokeGrantByOperationId(params: {
  operationId: string
  reason: string
  logger: Logger
}): Promise<boolean> {
  const { operationId, reason, logger } = params

  return await db.transaction(async (tx) => {
    const grant = await tx.query.creditLedger.findFirst({
      where: eq(schema.creditLedger.operation_id, operationId),
    })

    if (!grant) {
      logger.warn({ operationId }, 'Attempted to revoke non-existent grant')
      return false
    }

    if (grant.balance < 0) {
      logger.warn(
        { operationId, currentBalance: grant.balance },
        'Cannot revoke grant with negative balance - user has already spent these credits',
      )
      return false
    }

    await tx
      .update(schema.creditLedger)
      .set({
        principal: 0,
        balance: 0,
        description: `${grant.description} (Revoked: ${reason})`,
      })
      .where(eq(schema.creditLedger.operation_id, operationId))

    logger.info(
      {
        operationId,
        userId: grant.user_id,
        revokedAmount: grant.balance,
        reason,
      },
      'Revoked credit grant',
    )

    return true
  })
}

/**
 * Checks if a user's quota needs to be reset, and if so:
 * 1. Calculates their new monthly grant amount
 * 2. Issues the grant with the appropriate expiry
 * 3. Updates their next_quota_reset date
 * All of this is done in a single transaction to ensure consistency.
 *
 * @param userId The ID of the user
 * @returns The effective quota reset date (either existing or new)
 */
export type MonthlyResetResult = {
  quotaResetDate: Date
  autoTopupEnabled: boolean
}

export async function triggerMonthlyResetAndGrant(
  params: OptionalFields<
    {
      userId: string
      logger: Logger
      conn: BillingDbConn
    },
    'conn'
  >,
): Promise<MonthlyResetResult> {
  const { conn = db, ...rest } = params
  const { userId, logger } = rest

  return await conn.transaction(async (tx) => {
    const now = new Date()

    // Get user's current reset date and auto top-up status
    const user = await tx.query.user.findFirst({
      where: eq(schema.user.id, userId),
      columns: {
        next_quota_reset: true,
        auto_topup_enabled: true,
      },
    })

    if (!user) {
      throw new Error(`User ${userId} not found`)
    }

    const autoTopupEnabled = user.auto_topup_enabled ?? false
    const currentResetDate = user.next_quota_reset

    // If reset date is in the future, no action needed
    if (currentResetDate && currentResetDate > now) {
      return { quotaResetDate: currentResetDate, autoTopupEnabled }
    }

    // Calculate new reset date
    const newResetDate = getNextQuotaReset(currentResetDate)

    // Calculate grant amounts separately
    const [freeGrantAmount, referralBonus] = await Promise.all([
      getPreviousFreeGrantAmount({ ...rest, conn }),
      calculateTotalReferralBonus({ ...rest, conn }),
    ])

    // Generate a deterministic operation ID based on userId and reset date to minute precision
    const timestamp = generateOperationIdTimestamp(newResetDate)
    const freeOperationId = `free-${userId}-${timestamp}`
    const referralOperationId = `referral-${userId}-${timestamp}`

    // Update the user's next reset date
    await tx
      .update(schema.user)
      .set({ next_quota_reset: newResetDate })
      .where(eq(schema.user.id, userId))

    // Always grant free credits - use grantCreditOperation with tx to keep everything in the same transaction
    await grantCreditOperation({
      ...rest,
      amount: freeGrantAmount,
      type: 'free',
      description: 'Monthly free credits',
      expiresAt: newResetDate, // Free credits expire at next reset
      operationId: freeOperationId,
      tx,
    })

    // Only grant referral credits if there are any
    if (referralBonus > 0) {
      await grantCreditOperation({
        ...rest,
        amount: referralBonus,
        type: 'referral',
        description: 'Monthly referral bonus',
        expiresAt: newResetDate, // Referral credits expire at next reset
        operationId: referralOperationId,
        tx,
      })
    }

    logger.info(
      {
        userId,
        freeOperationId,
        referralOperationId,
        freeGrantAmount,
        referralBonus,
        newResetDate,
        previousResetDate: currentResetDate,
      },
      'Processed monthly credit grants and reset',
    )

    return { quotaResetDate: newResetDate, autoTopupEnabled }
  })
}
