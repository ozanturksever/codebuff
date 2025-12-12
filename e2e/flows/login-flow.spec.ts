/**
 * End-to-End Login Flow Tests
 * 
 * Tests the complete login flow: CLI → Browser → GitHub OAuth → Callback → CLI
 * 
 * Prerequisites:
 * - Docker must be running
 * - SDK must be built: cd sdk && bun run build
 * - Playwright browsers installed: bunx playwright install chromium
 * - GitHub test credentials configured
 * 
 * Run with: cd e2e && bun run test
 */

import { test, expect } from '@playwright/test'
import { hasRequiredCredentials, logSkipReason } from '../utils/env'

// Check credentials at module load time
const hasCredentials = hasRequiredCredentials()

if (!hasCredentials) {
  logSkipReason('GitHub test credentials not configured (GH_TEST_EMAIL, GH_TEST_PASSWORD)')
}

// Only define tests if credentials are available
if (hasCredentials) {
  test.describe('E2E Login Flow', () => {
    test.describe.configure({ mode: 'serial' }) // Run tests serially

    // Lazy-load the heavy fixtures only when tests actually run
    let testContext: typeof import('../fixtures/test-context') | null = null
    
    test.beforeAll(async () => {
      // Dynamically import the test context (which imports infrastructure)
      testContext = await import('../fixtures/test-context')
      
      const prereqs = testContext.checkPrerequisites()
      if (!prereqs.ready) {
        logSkipReason(prereqs.reason!)
        test.skip(true, prereqs.reason)
      }
    })

    test('first-time user can login via GitHub OAuth', async ({ page }) => {
      test.skip(!testContext, 'Test context not initialized')
    
      const ctx = await testContext!.createE2ETestContext('first-login')
    
      try {
        const { createCLISession, completeOAuth } = ctx

        // 1. Launch CLI without existing credentials
        console.log('[Test] Launching CLI...')
        const cli = await createCLISession()

        // 2. Wait for login prompt - auto-login triggers automatically via CODEBUFF_E2E_NO_BROWSER
        console.log('[Test] Waiting for login prompt (auto-login will trigger)...')
        await cli.waitForText(/Press ENTER|login|sign in/i, { timeout: 30000 })

        // 3. Wait for login URL (auto-triggered after 1 second delay)
        console.log('[Test] Waiting for login URL...')
        const loginUrl = await cli.waitForLoginUrl(30000)
        console.log(`[Test] Got login URL: ${loginUrl}`)

        expect(loginUrl).toContain('auth_code=')

        // 5. Complete OAuth in browser
        console.log('[Test] Starting OAuth flow in browser...')
        await completeOAuth(page, loginUrl)

        // 6. Verify CLI detected successful login
        console.log('[Test] Waiting for CLI to detect login...')
        await cli.waitForText(/directory|welcome|logged in/i, { timeout: 45000 })

        const cliText = await cli.text()
        // CLI should show main interface after successful login
        expect(cliText.toLowerCase()).toMatch(/directory|welcome|logged in/)

        console.log('[Test] Login flow completed successfully!')
      } finally {
        await ctx.infra.cleanup()
      }
    })

    test('CLI remains responsive after login', async ({ page }) => {
      test.skip(!testContext, 'Test context not initialized')
    
      const ctx = await testContext!.createE2ETestContext('responsive')
    
      try {
        const { createCLISession, completeOAuth } = ctx

        // Complete login first (auto-login via CODEBUFF_E2E_NO_BROWSER)
        const cli = await createCLISession()
        await cli.waitForText(/Press ENTER|login|sign in/i, { timeout: 30000 })
        const loginUrl = await cli.waitForLoginUrl(30000)
        await completeOAuth(page, loginUrl)
        await cli.waitForText(/directory/i, { timeout: 45000 })

        // Test that CLI is responsive
        console.log('[Test] Verifying CLI is responsive...')
        await cli.type('hello test')
        await cli.waitForText('hello test', { timeout: 5000 })

        const text = await cli.text()
        expect(text).toContain('hello test')

        console.log('[Test] CLI is responsive after login!')
      } finally {
        await ctx.infra.cleanup()
      }
    })

    test('/usage command works after login', async ({ page }) => {
      test.skip(!testContext, 'Test context not initialized')
    
      const ctx = await testContext!.createE2ETestContext('usage-cmd')
    
      try {
        const { createCLISession, completeOAuth } = ctx

        // Complete login first (auto-login via CODEBUFF_E2E_NO_BROWSER)
        const cli = await createCLISession()
        await cli.waitForText(/Press ENTER|login|sign in/i, { timeout: 30000 })
        const loginUrl = await cli.waitForLoginUrl(30000)
        await completeOAuth(page, loginUrl)
        await cli.waitForText(/directory/i, { timeout: 45000 })

        // Test /usage command
        console.log('[Test] Testing /usage command...')
        await cli.type('/usage')
        await cli.press('enter')

        await cli.waitForText(/credit|usage|balance/i, { timeout: 15000 })

        const text = await cli.text()
        expect(text.toLowerCase()).toMatch(/credit|usage|balance/)

        console.log('[Test] /usage command works!')
      } finally {
        await ctx.infra.cleanup()
      }
    })

    test('logout and re-login flow works', async ({ page }) => {
      test.skip(!testContext, 'Test context not initialized')
    
      const ctx = await testContext!.createE2ETestContext('logout-relogin')
    
      try {
        const { createCLISession, completeOAuth } = ctx

        // Complete initial login (auto-login via CODEBUFF_E2E_NO_BROWSER)
        const cli = await createCLISession()
        await cli.waitForText(/Press ENTER|login|sign in/i, { timeout: 30000 })
        let loginUrl = await cli.waitForLoginUrl(30000)
        await completeOAuth(page, loginUrl)
        await cli.waitForText(/directory/i, { timeout: 45000 })

        // Logout
        console.log('[Test] Testing logout...')
        await cli.type('/logout')
        await cli.press('enter')

        // Wait for logout to complete and login prompt to reappear
        await cli.waitForText(/login|sign in|logged out/i, { timeout: 15000 })

        // Re-login
        console.log('[Test] Re-logging in...')
        await cli.press('enter')
        loginUrl = await cli.waitForLoginUrl(30000)
        await completeOAuth(page, loginUrl)
        await cli.waitForText(/directory/i, { timeout: 45000 })

        const text = await cli.text()
        expect(text.toLowerCase()).toContain('directory')

        console.log('[Test] Logout and re-login flow works!')
      } finally {
        await ctx.infra.cleanup()
      }
    })
  })
} else {
  // No credentials - register a single skipped test to show in the report
  test.describe('E2E Login Flow', () => {
    test.skip(true, 'GitHub test credentials not configured (GH_TEST_EMAIL, GH_TEST_PASSWORD)')
    test('skipped - credentials not configured', () => {})
  })
}
