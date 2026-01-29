/**
 * Kimi model override utilities.
 *
 * This module provides shared logic for applying the Kimi model override
 * when the CODEBUFF_USE_KIMI environment variable is set.
 */

/** The Kimi K2.5 model ID on OpenRouter */
export const KIMI_MODEL_ID = 'moonshotai/kimi-k2.5'

/**
 * Check if Kimi model override is enabled.
 * When enabled, Claude models should be replaced with moonshotai/kimi-k2.5.
 */
export function isKimiModelOverrideEnabled(): boolean {
  return process.env.CODEBUFF_USE_KIMI === '1'
}

/**
 * Apply Kimi model override if enabled.
 * Replaces Claude/Anthropic models with Kimi K2.5.
 */
export function applyKimiModelOverride(model: string): string {
  if (!isKimiModelOverrideEnabled()) {
    return model
  }

  // Replace any Claude/Anthropic model with Kimi
  if (model.startsWith('anthropic/') || model.includes('claude')) {
    return KIMI_MODEL_ID
  }

  return model
}
