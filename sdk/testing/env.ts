/**
 * Test-only SDK env fixtures.
 */

import { createTestBaseEnv } from '@codebuff/common/testing/env-process'

import type { SdkEnv } from '../src/types/env'

/**
 * Create a test SdkEnv with optional overrides.
 * Composes from createTestBaseEnv for DRY.
 */
export const createTestSdkEnv = (
  overrides: Partial<SdkEnv> = {},
): SdkEnv => ({
  ...createTestBaseEnv(),

  // SDK-specific defaults
  CODEBUFF_RG_PATH: undefined,
  CODEBUFF_WASM_DIR: undefined,
  VERBOSE: undefined,
  OVERRIDE_TARGET: undefined,
  OVERRIDE_PLATFORM: undefined,
  OVERRIDE_ARCH: undefined,
  ...overrides,
})
