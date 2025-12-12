/**
 * GitHub OAuth automation helpers for Playwright
 * Handles logging in via GitHub OAuth in the browser
 */

import type { Page } from '@playwright/test'

import { getE2EEnv } from '../utils/env'
import { generateTOTP } from '../utils/totp'

export interface GitHubCredentials {
  email: string
  password: string
  totpSecret?: string
}

/**
 * Get GitHub test account credentials from environment
 */
export function getGitHubCredentials(): GitHubCredentials | null {
  const env = getE2EEnv()
  
  if (!env.GH_TEST_EMAIL || !env.GH_TEST_PASSWORD) {
    return null
  }

  return {
    email: env.GH_TEST_EMAIL,
    password: env.GH_TEST_PASSWORD,
    totpSecret: env.GH_TEST_TOTP_SECRET,
  }
}

/**
 * Check if GitHub OAuth credentials are available
 */
export function hasGitHubCredentials(): boolean {
  return getGitHubCredentials() !== null
}

/**
 * Complete GitHub OAuth login flow in Playwright browser
 * 
 * @param page - Playwright page instance
 * @param loginUrl - The login URL from CLI (contains auth_code)
 * @param credentials - GitHub account credentials
 */
export async function completeGitHubOAuth(
  page: Page,
  loginUrl: string,
  credentials: GitHubCredentials,
): Promise<void> {
  console.log('[OAuth] Navigating to login URL...')
  await page.goto(loginUrl)

  // Wait for the page to load - either GitHub OAuth or our login page
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  // Check if we're on GitHub's login page
  const isGitHubLogin = page.url().includes('github.com')
  
  if (isGitHubLogin) {
    console.log('[OAuth] On GitHub login page, filling credentials...')
    await fillGitHubLoginForm(page, credentials)
  } else {
    // We might be on our login page with a "Sign in with GitHub" button
    console.log('[OAuth] On Codebuff login page, clicking GitHub sign-in...')
    
    // Look for GitHub sign-in button
    const githubButton = page.getByRole('button', { name: /github/i })
      .or(page.getByText(/sign in with github/i))
      .or(page.getByText(/continue with github/i))
    
    if (await githubButton.isVisible({ timeout: 5000 })) {
      await githubButton.click()
      
      // Wait for redirect to GitHub
      await page.waitForURL(/github\.com/, { timeout: 15000 })
      
      // Fill GitHub login form
      await fillGitHubLoginForm(page, credentials)
    } else {
      throw new Error('Could not find GitHub sign-in button on login page')
    }
  }

  // After OAuth, we should be redirected back to our app
  console.log('[OAuth] Waiting for redirect back to app...')
  await page.waitForURL((url) => !url.hostname.includes('github.com'), { timeout: 30000 })
  
  // Wait for the page to finish loading
  await page.waitForLoadState('networkidle', { timeout: 15000 })
  
  console.log('[OAuth] OAuth flow completed successfully')
}

/**
 * Fill in GitHub's login form
 */
async function fillGitHubLoginForm(
  page: Page,
  credentials: GitHubCredentials,
): Promise<void> {
  // Wait for login form to be visible
  await page.waitForSelector('input[name="login"], input[name="email"]', { timeout: 15000 })

  // Fill email/username
  const loginInput = page.locator('input[name="login"]').or(page.locator('input[name="email"]'))
  await loginInput.fill(credentials.email)

  // Fill password
  const passwordInput = page.locator('input[name="password"]')
  await passwordInput.fill(credentials.password)

  // Click sign in button
  const signInButton = page.getByRole('button', { name: /sign in/i })
    .or(page.locator('input[type="submit"][value*="Sign in" i]'))
  await signInButton.click()

  // Wait for navigation
  await page.waitForLoadState('networkidle', { timeout: 15000 })

  // Check if 2FA is required
  const totpInput = page.locator('input[name="app_otp"], input[name="otp"], input[id="totp"]')
  
  if (await totpInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[OAuth] 2FA required, generating TOTP code...')
    
    if (!credentials.totpSecret) {
      throw new Error('GitHub account requires 2FA but GITHUB_TEST_TOTP_SECRET is not set')
    }

    const totpCode = generateTOTP(credentials.totpSecret)
    await totpInput.fill(totpCode)

    // Some GitHub 2FA forms auto-submit, some need button click
    const verifyButton = page.getByRole('button', { name: /verify/i })
    if (await verifyButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await verifyButton.click()
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 })
  }

  // Check if OAuth authorization is required (first time only)
  const authorizeButton = page.getByRole('button', { name: /authorize/i })
  if (await authorizeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[OAuth] Authorization required, clicking authorize...')
    await authorizeButton.click()
    await page.waitForLoadState('networkidle', { timeout: 15000 })
  }
}
