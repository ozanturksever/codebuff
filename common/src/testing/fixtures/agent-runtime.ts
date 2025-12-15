/**
 * Test-only AgentRuntime dependency fixture.
 *
 * This file intentionally hardcodes dummy values (e.g. API keys) for tests.
 * Do not import from production code.
 */

import { spyOn } from 'bun:test'

import type { AgentTemplate } from '../../types/agent-template'
import type {
  AgentRuntimeDeps,
  AgentRuntimeScopedDeps,
} from '../../types/contracts/agent-runtime'
import type { GetUserInfoFromApiKeyInput, UserColumn } from '../../types/contracts/database'
import type { ClientEnv, CiEnv } from '../../types/contracts/env'
import type { Logger } from '../../types/contracts/logger'

export const testLogger: Logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
}

export const testFetch = async () => {
  throw new Error('fetch not implemented in test runtime')
}
testFetch.preconnect = async () => {
  throw new Error('fetch.preconnect not implemented in test runtime')
}

export const testClientEnv: ClientEnv = {
  NEXT_PUBLIC_CB_ENVIRONMENT: 'test',
  NEXT_PUBLIC_CODEBUFF_APP_URL: 'https://test.codebuff.com',
  NEXT_PUBLIC_SUPPORT_EMAIL: 'support@codebuff.test',
  NEXT_PUBLIC_POSTHOG_API_KEY: 'test-posthog-key',
  NEXT_PUBLIC_POSTHOG_HOST_URL: 'https://test.posthog.com',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL: 'https://test.stripe.com/portal',
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION_ID: undefined,
  NEXT_PUBLIC_WEB_PORT: 3000,
}

export const testCiEnv: CiEnv = {
  CI: undefined,
  GITHUB_ACTIONS: undefined,
  RENDER: undefined,
  IS_PULL_REQUEST: undefined,
  CODEBUFF_GITHUB_TOKEN: undefined,
  CODEBUFF_API_KEY: 'test-api-key',
}

export const TEST_AGENT_RUNTIME_IMPL = Object.freeze<
  AgentRuntimeDeps & AgentRuntimeScopedDeps
>({
  // Environment
  clientEnv: testClientEnv,
  ciEnv: testCiEnv,

  // Database
  getUserInfoFromApiKey: async <T extends UserColumn>({
    fields,
  }: GetUserInfoFromApiKeyInput<T>) => {
    const user = {
      id: 'test-user-id',
      email: 'test-email',
      discord_id: 'test-discord-id',
      referral_code: 'ref-test-code',
      stripe_customer_id: null,
      banned: false,
    } as const

    return Object.fromEntries(fields.map((field) => [field, user[field]])) as {
      [K in T]: (typeof user)[K]
    }
  },
  fetchAgentFromDatabase: async () => null,
  startAgentRun: async () => 'test-agent-run-id',
  finishAgentRun: async () => {},
  addAgentStep: async () => 'test-agent-step-id',

  // Billing
  consumeCreditsWithFallback: async () => {
    throw new Error(
      'consumeCreditsWithFallback not implemented in test runtime',
    )
  },

  // LLM
  promptAiSdkStream: async function* () {
    throw new Error('promptAiSdkStream not implemented in test runtime')
  },
  promptAiSdk: async function () {
    throw new Error('promptAiSdk not implemented in test runtime')
  },
  promptAiSdkStructured: async function () {
    throw new Error('promptAiSdkStructured not implemented in test runtime')
  },

  // Mutable State
  databaseAgentCache: new Map<string, AgentTemplate | null>(),
  liveUserInputRecord: {},
  sessionConnections: {},

  // Analytics
  trackEvent: () => {},

  // Other
  logger: testLogger,
  fetch: testFetch,

  // Scoped deps

  // Database
  handleStepsLogChunk: () => {
    throw new Error('handleStepsLogChunk not implemented in test runtime')
  },
  requestToolCall: () => {
    throw new Error('requestToolCall not implemented in test runtime')
  },
  requestMcpToolData: () => {
    throw new Error('requestMcpToolData not implemented in test runtime')
  },
  requestFiles: () => {
    throw new Error('requestFiles not implemented in test runtime')
  },
  requestOptionalFile: () => {
    throw new Error('requestOptionalFile not implemented in test runtime')
  },
  sendSubagentChunk: () => {
    throw new Error('sendSubagentChunk not implemented in test runtime')
  },
  sendAction: () => {
    throw new Error('sendAction not implemented in test runtime')
  },

  apiKey: 'test-api-key',
})

/**
 * Type for the analytics module to be mocked.
 * Matches the shape of @codebuff/common/analytics.
 */
type AnalyticsModule = {
  initAnalytics: (...args: unknown[]) => void
  trackEvent: (...args: unknown[]) => void
  flushAnalytics?: (...args: unknown[]) => Promise<void>
}

/**
 * Type for the bigquery module to be mocked.
 * Matches the shape of @codebuff/bigquery.
 */
type BigQueryModule = {
  insertTrace: (...args: unknown[]) => Promise<boolean>
}

/**
 * Mocks the analytics module with no-op implementations.
 * Call this in beforeEach or beforeAll in tests that use analytics.
 *
 * @param analyticsModule - The imported analytics module (import * as analytics from '@codebuff/common/analytics')
 *
 * @example
 * ```ts
 * import * as analytics from '@codebuff/common/analytics'
 * import { mockAnalytics } from '@codebuff/common/testing/fixtures/agent-runtime'
 *
 * beforeEach(() => {
 *   mockAnalytics(analytics)
 * })
 * ```
 */
export function mockAnalytics(analyticsModule: AnalyticsModule): void {
  spyOn(analyticsModule, 'initAnalytics').mockImplementation(() => {})
  spyOn(analyticsModule, 'trackEvent').mockImplementation(() => {})
  if (analyticsModule.flushAnalytics) {
    spyOn(analyticsModule, 'flushAnalytics').mockImplementation(() =>
      Promise.resolve(),
    )
  }
}

/**
 * Mocks the bigquery module with no-op implementations.
 * Call this in beforeEach or beforeAll in tests that use bigquery tracing.
 *
 * @param bigqueryModule - The imported bigquery module (import * as bigquery from '@codebuff/bigquery')
 *
 * @example
 * ```ts
 * import * as bigquery from '@codebuff/bigquery'
 * import { mockBigQuery } from '@codebuff/common/testing/fixtures/agent-runtime'
 *
 * beforeEach(() => {
 *   mockBigQuery(bigquery)
 * })
 * ```
 */
export function mockBigQuery(bigqueryModule: BigQueryModule): void {
  spyOn(bigqueryModule, 'insertTrace').mockImplementation(async () => true)
}

/**
 * Mocks the crypto.randomUUID function with a predictable value.
 * Useful for tests that need deterministic UUIDs.
 *
 * @param uuid - The UUID string to return (defaults to a test UUID)
 *
 * @example
 * ```ts
 * import { mockRandomUUID } from '@codebuff/common/testing/fixtures/agent-runtime'
 *
 * beforeEach(() => {
 *   mockRandomUUID()
 * })
 * ```
 */
export function mockRandomUUID(
  uuid: string = 'mock-uuid-0000-0000-0000-000000000000',
): void {
  spyOn(crypto, 'randomUUID').mockImplementation(
    () => uuid as `${string}-${string}-${string}-${string}-${string}`,
  )
}
