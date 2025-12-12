/**
 * Combined test context for e2e login flow tests
 * Provides infrastructure, CLI session, and browser helpers
 */

import { test as base, type Page } from '@playwright/test'

import { createE2EInfrastructure, isDockerAvailable, isSDKBuilt, cleanupOrphanedInfrastructure } from './infra'
import { launchCLISession } from './cli-session'
import { completeGitHubOAuth, getGitHubCredentials, hasGitHubCredentials } from './oauth-helpers'

import type { E2EInfrastructure } from './infra'
import type { CLISession } from './cli-session'
import type { GitHubCredentials } from './oauth-helpers'

export interface E2ETestContext {
  infra: E2EInfrastructure
  createCLISession: (args?: string[]) => Promise<CLISession>
  githubCredentials: GitHubCredentials | null
  completeOAuth: (page: Page, loginUrl: string) => Promise<void>
}

// Track if global cleanup has run
let globalCleanupRan = false

/**
 * Create a full e2e test context
 */
export async function createE2ETestContext(testId: string): Promise<E2ETestContext> {
  // Run global cleanup once per process
  if (!globalCleanupRan) {
    globalCleanupRan = true
    cleanupOrphanedInfrastructure()
  }

  // Create infrastructure
  const infra = await createE2EInfrastructure(testId)

  // Track CLI sessions for cleanup
  const sessions: CLISession[] = []

  const createCLISession = async (args: string[] = []): Promise<CLISession> => {
    const session = await launchCLISession({
      server: infra.server,
      args,
    })
    sessions.push(session)
    return session
  }

  const githubCredentials = getGitHubCredentials()

  const completeOAuth = async (page: Page, loginUrl: string): Promise<void> => {
    if (!githubCredentials) {
      throw new Error('GitHub credentials not available')
    }
    await completeGitHubOAuth(page, loginUrl, githubCredentials)
  }

  // Wrap cleanup to also close CLI sessions
  const originalCleanup = infra.cleanup
  infra.cleanup = async () => {
    // Close all CLI sessions
    for (const session of sessions) {
      await session.close()
    }
    // Clean up infrastructure
    await originalCleanup()
  }

  return {
    infra,
    createCLISession,
    githubCredentials,
    completeOAuth,
  }
}

/**
 * Check prerequisites for running e2e login flow tests
 */
export function checkPrerequisites(): { ready: boolean; reason?: string } {
  if (!isDockerAvailable()) {
    return { ready: false, reason: 'Docker is not running' }
  }

  if (!isSDKBuilt()) {
    return { ready: false, reason: 'SDK is not built (run: cd sdk && bun run build)' }
  }

  if (!hasGitHubCredentials()) {
    return { ready: false, reason: 'GitHub test credentials not configured (GH_TEST_EMAIL, GH_TEST_PASSWORD)' }
  }

  return { ready: true }
}

/**
 * Playwright test fixture with e2e context
 */
export const test = base.extend<{ e2eContext: E2ETestContext }>({
  // eslint-disable-next-line no-empty-pattern
  e2eContext: async ({}, use, testInfo) => {
    const testId = `login-${testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 20)}`
    const ctx = await createE2ETestContext(testId)
    
    await use(ctx)
    
    await ctx.infra.cleanup()
  },
})

export { expect } from '@playwright/test'
