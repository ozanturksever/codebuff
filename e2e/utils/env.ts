/**
 * Environment variable utilities for e2e tests
 */

export interface E2EEnv {
  /** GitHub test account email */
  GH_TEST_EMAIL?: string
  /** GitHub test account password */
  GH_TEST_PASSWORD?: string
  /** GitHub test account TOTP secret for 2FA (base32 encoded) */
  GH_TEST_TOTP_SECRET?: string
  /** Whether running in CI */
  CI?: string
}

/**
 * Get e2e environment variables
 */
export function getE2EEnv(): E2EEnv {
  return {
    GH_TEST_EMAIL: process.env.GH_TEST_EMAIL,
    GH_TEST_PASSWORD: process.env.GH_TEST_PASSWORD,
    GH_TEST_TOTP_SECRET: process.env.GH_TEST_TOTP_SECRET,
    CI: process.env.CI,
  }
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1'
}

/**
 * Check if all required GitHub credentials are present
 */
export function hasRequiredCredentials(): boolean {
  const env = getE2EEnv()
  return !!(env.GH_TEST_EMAIL && env.GH_TEST_PASSWORD)
}

/**
 * Log a skip message for tests that can't run without credentials
 */
export function logSkipReason(reason: string): void {
  console.log(`\n⏭️  Skipping e2e login flow tests: ${reason}\n`)
  console.log('To run these tests, set the following environment variables:')
  console.log('  - GH_TEST_EMAIL: Email for GitHub test account')
  console.log('  - GH_TEST_PASSWORD: Password for GitHub test account\n')
}
