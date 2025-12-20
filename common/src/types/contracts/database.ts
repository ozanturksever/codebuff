import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type { Logger } from '@codebuff/common/types/contracts/logger'

// ============================================================================
// Database Operations Interface
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal database interface for dependency injection in API routes.
 * Both the real CodebuffPgDatabase and test mocks can satisfy this interface.
 *
 * Uses `any` for table/column parameters to be compatible with Drizzle ORM's
 * specific table types while remaining flexible for mocks.
 */
export interface DbOperations {
  insert: (table: any) => {
    values: (data: any) => PromiseLike<any>
  }
  update: (table: any) => {
    set: (data: any) => {
      where: (condition: any) => PromiseLike<any>
    }
  }
  select: (columns?: any) => {
    from: (table: any) => {
      where: (condition: any) => DbWhereResult
    }
  }
}

/**
 * Result type for where() that supports multiple query patterns:
 * - .limit(n) for simple queries
 * - .orderBy(...).limit(n) for sorted queries
 * - .then() for promise-like resolution
 */
export interface DbWhereResult {
  then: <TResult = any[]>(
    onfulfilled?: ((value: any[]) => TResult | PromiseLike<TResult>) | null | undefined,
  ) => PromiseLike<TResult>
  limit: (n: number) => PromiseLike<any[]>
  orderBy: (...columns: any[]) => {
    limit: (n: number) => PromiseLike<any[]>
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type User = {
  id: string
  email: string
  discord_id: string | null
  referral_code: string | null
  stripe_customer_id: string | null
  banned: boolean
}
export const userColumns = [
  'id',
  'email',
  'discord_id',
  'referral_code',
  'stripe_customer_id',
  'banned',
] as const
export type UserColumn = keyof User
export type GetUserInfoFromApiKeyInput<T extends UserColumn> = {
  apiKey: string
  fields: readonly T[]
  logger: Logger
}
export type GetUserInfoFromApiKeyOutput<T extends UserColumn> = Promise<
  | {
      [K in T]: User[K]
    }
  | null
>
export type GetUserInfoFromApiKeyFn = <T extends UserColumn>(
  params: GetUserInfoFromApiKeyInput<T>,
) => GetUserInfoFromApiKeyOutput<T>

type AgentRun = {
  agent_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}
export type AgentRunColumn = keyof AgentRun
export type GetAgentRunFromIdInput<T extends AgentRunColumn> = {
  runId: string
  userId: string
  fields: readonly T[]
}
export type GetAgentRunFromIdOutput<T extends AgentRunColumn> = Promise<
  | {
      [K in T]: AgentRun[K]
    }
  | null
>
export type GetAgentRunFromIdFn = <T extends AgentRunColumn>(
  params: GetAgentRunFromIdInput<T>,
) => GetAgentRunFromIdOutput<T>

/**
 * Fetch and validate an agent from the database by `publisher/agent-id[@version]` format
 */
export type FetchAgentFromDatabaseFn = (params: {
  apiKey: string
  parsedAgentId: {
    publisherId: string
    agentId: string
    version?: string
  }
  logger: Logger
}) => Promise<AgentTemplate | null>

export type StartAgentRunFn = (params: {
  apiKey: string
  userId?: string
  agentId: string
  ancestorRunIds: string[]
  logger: Logger
}) => Promise<string | null>

export type FinishAgentRunFn = (params: {
  apiKey: string
  userId: string | undefined
  runId: string
  status: 'completed' | 'failed' | 'cancelled'
  totalSteps: number
  directCredits: number
  totalCredits: number
  errorMessage?: string
  logger: Logger
}) => Promise<void>

export type AddAgentStepFn = (params: {
  apiKey: string
  userId: string | undefined
  agentRunId: string
  stepNumber: number
  credits?: number
  childRunIds?: string[]
  messageId: string | null
  status?: 'running' | 'completed' | 'skipped'
  errorMessage?: string
  startTime: Date
  logger: Logger
}) => Promise<string | null>

export type DatabaseAgentCache = Map<string, AgentTemplate | null>

