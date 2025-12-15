import { afterEach, describe, expect, it, mock } from 'bun:test'

import {
  createGrantCreditsDbMock,
  testLogger,
} from '@codebuff/common/testing/fixtures'

import { triggerMonthlyResetAndGrant } from '../grant-credits'

const logger = testLogger

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
// pastDate removed - unused

describe('grant-credits', () => {
  afterEach(() => {
    mock.restore()
  })

  describe('triggerMonthlyResetAndGrant', () => {
    describe('autoTopupEnabled return value', () => {
      it('should return autoTopupEnabled: true when user has auto_topup_enabled: true', async () => {
        const mockDb = createGrantCreditsDbMock({
          user: {
            next_quota_reset: futureDate,
            auto_topup_enabled: true,
          },
        })

        const result = await triggerMonthlyResetAndGrant({
          userId: 'user-123',
          logger,
          conn: mockDb,
        })

        expect(result.autoTopupEnabled).toBe(true)
        expect(result.quotaResetDate).toEqual(futureDate)
      })

      it('should return autoTopupEnabled: false when user has auto_topup_enabled: false', async () => {
        const mockDb = createGrantCreditsDbMock({
          user: {
            next_quota_reset: futureDate,
            auto_topup_enabled: false,
          },
        })

        const result = await triggerMonthlyResetAndGrant({
          userId: 'user-123',
          logger,
          conn: mockDb,
        })

        expect(result.autoTopupEnabled).toBe(false)
      })

      it('should default autoTopupEnabled to false when user has auto_topup_enabled: null', async () => {
        const mockDb = createGrantCreditsDbMock({
          user: {
            next_quota_reset: futureDate,
            auto_topup_enabled: null,
          },
        })

        const result = await triggerMonthlyResetAndGrant({
          userId: 'user-123',
          logger,
          conn: mockDb,
        })

        expect(result.autoTopupEnabled).toBe(false)
      })

      it('should throw error when user is not found', async () => {
        const mockDb = createGrantCreditsDbMock({
          user: null,
        })

        await expect(
          triggerMonthlyResetAndGrant({
            userId: 'nonexistent-user',
            logger,
            conn: mockDb,
          }),
        ).rejects.toThrow('User nonexistent-user not found')
      })
    })

    describe('quota reset behavior', () => {
      it('should return existing reset date when it is in the future', async () => {
        const mockDb = createGrantCreditsDbMock({
          user: {
            next_quota_reset: futureDate,
            auto_topup_enabled: false,
          },
        })

        const result = await triggerMonthlyResetAndGrant({
          userId: 'user-123',
          logger,
          conn: mockDb,
        })

        expect(result.quotaResetDate).toEqual(futureDate)
      })
    })
  })
})
