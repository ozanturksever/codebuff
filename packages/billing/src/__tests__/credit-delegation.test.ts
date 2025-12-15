import { afterEach, describe, expect, it, mock } from 'bun:test'

import {
  createCreditDelegationDbMock,
  testLogger,
} from '@codebuff/common/testing/fixtures'

import {
  consumeCreditsWithDelegation,
  findOrganizationForRepository,
} from '../credit-delegation'

describe('Credit Delegation', () => {
  const logger = testLogger

  afterEach(() => {
    mock.restore()
  })

  describe('findOrganizationForRepository', () => {
    it('should find organization for matching repository', async () => {
      const mockDb = createCreditDelegationDbMock({
        userOrganizations: [
          {
            orgId: 'org-123',
            orgName: 'CodebuffAI',
            orgSlug: 'codebuffai',
          },
        ],
        orgRepos: [
          {
            repoUrl: 'https://github.com/codebuffai/codebuff',
            repoName: 'codebuff',
            isActive: true,
          },
        ],
      })

      const userId = 'user-123'
      const repositoryUrl = 'https://github.com/codebuffai/codebuff'

      const result = await findOrganizationForRepository({
        userId,
        repositoryUrl,
        logger,
        conn: mockDb,
      })

      expect(result.found).toBe(true)
      expect(result.organizationId).toBe('org-123')
      expect(result.organizationName).toBe('CodebuffAI')
    })

    it('should return not found for non-matching repository', async () => {
      const mockDb = createCreditDelegationDbMock({
        userOrganizations: [
          {
            orgId: 'org-123',
            orgName: 'CodebuffAI',
            orgSlug: 'codebuffai',
          },
        ],
        orgRepos: [
          {
            repoUrl: 'https://github.com/codebuffai/codebuff',
            repoName: 'codebuff',
            isActive: true,
          },
        ],
      })

      const userId = 'user-123'
      const repositoryUrl = 'https://github.com/other/repo'

      const result = await findOrganizationForRepository({
        userId,
        repositoryUrl,
        logger,
        conn: mockDb,
      })

      expect(result.found).toBe(false)
    })

    it('should return not found when user has no organizations', async () => {
      const mockDb = createCreditDelegationDbMock({
        userOrganizations: [],
        orgRepos: [],
      })

      const userId = 'user-123'
      const repositoryUrl = 'https://github.com/some/repo'

      const result = await findOrganizationForRepository({
        userId,
        repositoryUrl,
        logger,
        conn: mockDb,
      })

      expect(result.found).toBe(false)
    })
  })

  describe('consumeCreditsWithDelegation', () => {
    it('should fail when no repository URL provided', async () => {
      const mockDb = createCreditDelegationDbMock()

      const userId = 'user-123'
      const repositoryUrl = null
      const creditsToConsume = 100

      const result = await consumeCreditsWithDelegation({
        userId,
        repositoryUrl,
        creditsToConsume,
        logger,
        conn: mockDb,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('No repository URL provided')
    })

    it('should fail when no organization found for repository', async () => {
      const mockDb = createCreditDelegationDbMock({
        userOrganizations: [],
        orgRepos: [],
      })

      const userId = 'user-123'
      const repositoryUrl = 'https://github.com/other/repo'
      const creditsToConsume = 100

      const result = await consumeCreditsWithDelegation({
        userId,
        repositoryUrl,
        creditsToConsume,
        logger,
        conn: mockDb,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('No organization found for repository')
    })
  })
})
