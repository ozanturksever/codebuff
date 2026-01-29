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

/**
 * Regex pattern to match Kimi's internal special tokens.
 * These tokens follow the format <|...|> and are used internally by Kimi
 * for things like tool call sections, message boundaries, etc.
 * Examples: <|tool_calls_section|>, <|im_start|>, <|im_end|>
 */
const KIMI_INTERNAL_TOKEN_PATTERN = /<\|[^|>]*\|>/g

/**
 * Filter out Kimi's internal special tokens from text.
 * These tokens leak through when using Kimi via OpenRouter because
 * Kimi's tool calling format isn't properly supported.
 *
 * @param text - The text to filter
 * @returns The text with Kimi internal tokens removed
 */
export function filterKimiInternalTokens(text: string): string {
  return text.replace(KIMI_INTERNAL_TOKEN_PATTERN, '')
}

/**
 * State for streaming Kimi token filtering.
 * Tracks partial tokens that may be split across chunk boundaries.
 */
export type KimiFilterState = {
  /** Buffer for holding potential partial token at chunk boundary */
  buffer: string
}

/**
 * Creates initial state for Kimi token filtering in streaming mode.
 */
export function createKimiFilterState(): KimiFilterState {
  return { buffer: '' }
}

/**
 * Filter Kimi internal tokens from a streaming chunk.
 * Handles partial tokens that may be split across chunk boundaries.
 *
 * @param chunk - The incoming text chunk
 * @param state - Mutable filter state (updated in place)
 * @returns The filtered text
 */
export function filterKimiTokensStreaming(
  chunk: string,
  state: KimiFilterState,
): string {
  if (!chunk && !state.buffer) {
    return ''
  }

  // Combine buffer with new chunk
  let text = state.buffer + chunk
  state.buffer = ''

  // First, remove any complete Kimi tokens
  text = text.replace(KIMI_INTERNAL_TOKEN_PATTERN, '')

  // Check if we might have a partial token at the end
  // A partial token starts with '<|' but doesn't have the closing '|>'
  const partialStart = text.lastIndexOf('<|')
  if (partialStart !== -1) {
    // Check if there's a closing '|>' after the '<|'
    const afterStart = text.slice(partialStart)
    if (!afterStart.includes('|>')) {
      // This could be a partial token - buffer it
      state.buffer = afterStart
      text = text.slice(0, partialStart)
    }
  }

  // Also check for just '<' at the very end (could be start of '<|')
  // Only buffer if it's actually at the end (no content after it)
  if (text.length > 0 && text[text.length - 1] === '<') {
    state.buffer = '<' + state.buffer
    text = text.slice(0, -1)
  }

  return text
}
