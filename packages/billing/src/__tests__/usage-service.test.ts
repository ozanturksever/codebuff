import { afterEach, describe, expect, it, mock } from 'bun:test'

import { getUserUsageData } from '../usage-service'

import type { Logger } from '@codebuff/common/types/contracts/logger'
import type {
  TriggerMonthlyResetFn,
  CheckAutoTopupFn,
  CalculateUsageBalanceFn,
} from '../usage-service'

const logger: Logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
}

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now

const mockBalance = {
  totalRemaining: 1000,
  totalDebt: 0,
  netBalance: 1000,
  breakdown: { free: 500, paid: 500, referral: 0, purchase: 0, admin: 0, organization: 0 },
  principals: { free: 500, paid: 500, referral: 0, purchase: 0, admin: 0, organization: 0 },
}

describe('usage-service', () => {
  afterEach(() => {
    mock.restore()
  })

  describe('getUserUsageData', () => {
    describe('autoTopupEnabled field', () => {
      it('should include autoTopupEnabled: true when triggerMonthlyResetAndGrant returns true', async () => {
        const mockTriggerMonthlyReset: TriggerMonthlyResetFn = async () => ({
          quotaResetDate: futureDate,
          autoTopupEnabled: true,
        })

        const mockCheckAutoTopup: CheckAutoTopupFn = async () => undefined

        const mockCalculateUsageBalance: CalculateUsageBalanceFn = async () => ({
          usageThisCycle: 100,
          balance: mockBalance,
        })

        const result = await getUserUsageData({
          userId: 'user-123',
          logger,
          triggerMonthlyReset: mockTriggerMonthlyReset,
          checkAutoTopup: mockCheckAutoTopup,
          calculateUsageBalance: mockCalculateUsageBalance,
        })

        expect(result.autoTopupEnabled).toBe(true)
        expect(result.usageThisCycle).toBe(100)
        expect(result.balance).toEqual(mockBalance)
        expect(result.nextQuotaReset).toBe(futureDate.toISOString())
      })

      it('should include autoTopupEnabled: false when triggerMonthlyResetAndGrant returns false', async () => {
        const mockTriggerMonthlyReset: TriggerMonthlyResetFn = async () => ({
          quotaResetDate: futureDate,
          autoTopupEnabled: false,
        })

        const mockCheckAutoTopup: CheckAutoTopupFn = async () => undefined

        const mockCalculateUsageBalance: CalculateUsageBalanceFn = async () => ({
          usageThisCycle: 100,
          balance: mockBalance,
        })

        const result = await getUserUsageData({
          userId: 'user-123',
          logger,
          triggerMonthlyReset: mockTriggerMonthlyReset,
          checkAutoTopup: mockCheckAutoTopup,
          calculateUsageBalance: mockCalculateUsageBalance,
        })

        expect(result.autoTopupEnabled).toBe(false)
      })

      it('should include autoTopupTriggered: true when auto top-up was triggered', async () => {
        const mockTriggerMonthlyReset: TriggerMonthlyResetFn = async () => ({
          quotaResetDate: futureDate,
          autoTopupEnabled: true,
        })

        const mockCheckAutoTopup: CheckAutoTopupFn = async () => 500 // Returns amount when triggered

        const mockCalculateUsageBalance: CalculateUsageBalanceFn = async () => ({
          usageThisCycle: 100,
          balance: mockBalance,
        })

        const result = await getUserUsageData({
          userId: 'user-123',
          logger,
          triggerMonthlyReset: mockTriggerMonthlyReset,
          checkAutoTopup: mockCheckAutoTopup,
          calculateUsageBalance: mockCalculateUsageBalance,
        })

        expect(result.autoTopupTriggered).toBe(true)
        expect(result.autoTopupEnabled).toBe(true)
      })

      it('should include autoTopupTriggered: false when auto top-up was not triggered', async () => {
        const mockTriggerMonthlyReset: TriggerMonthlyResetFn = async () => ({
          quotaResetDate: futureDate,
          autoTopupEnabled: true,
        })

        const mockCheckAutoTopup: CheckAutoTopupFn = async () => undefined // Returns undefined when not triggered

        const mockCalculateUsageBalance: CalculateUsageBalanceFn = async () => ({
          usageThisCycle: 100,
          balance: mockBalance,
        })

        const result = await getUserUsageData({
          userId: 'user-123',
          logger,
          triggerMonthlyReset: mockTriggerMonthlyReset,
          checkAutoTopup: mockCheckAutoTopup,
          calculateUsageBalance: mockCalculateUsageBalance,
        })

        expect(result.autoTopupTriggered).toBe(false)
      })

      it('should continue and return data even when auto top-up check fails', async () => {
        const mockTriggerMonthlyReset: TriggerMonthlyResetFn = async () => ({
          quotaResetDate: futureDate,
          autoTopupEnabled: true,
        })

        const mockCheckAutoTopup: CheckAutoTopupFn = async () => {
          throw new Error('Payment failed')
        }

        const mockCalculateUsageBalance: CalculateUsageBalanceFn = async () => ({
          usageThisCycle: 100,
          balance: mockBalance,
        })

        // Should not throw
        const result = await getUserUsageData({
          userId: 'user-123',
          logger,
          triggerMonthlyReset: mockTriggerMonthlyReset,
          checkAutoTopup: mockCheckAutoTopup,
          calculateUsageBalance: mockCalculateUsageBalance,
        })

        expect(result.autoTopupTriggered).toBe(false)
        expect(result.autoTopupEnabled).toBe(true)
        expect(result.balance).toEqual(mockBalance)
      })
    })
  })
})
