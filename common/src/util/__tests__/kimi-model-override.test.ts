import { afterEach, describe, expect, it } from 'bun:test'

import {
  applyKimiModelOverride,
  createKimiFilterState,
  filterKimiInternalTokens,
  filterKimiTokensStreaming,
  isKimiModelOverrideEnabled,
  KIMI_MODEL_ID,
} from '../kimi-model-override'

describe('kimi-model-override', () => {
  describe('isKimiModelOverrideEnabled', () => {
    const originalEnv = process.env.CODEBUFF_USE_KIMI

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CODEBUFF_USE_KIMI
      } else {
        process.env.CODEBUFF_USE_KIMI = originalEnv
      }
    })

    it('returns false when CODEBUFF_USE_KIMI is not set', () => {
      delete process.env.CODEBUFF_USE_KIMI
      expect(isKimiModelOverrideEnabled()).toBe(false)
    })

    it('returns true when CODEBUFF_USE_KIMI is "1"', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(isKimiModelOverrideEnabled()).toBe(true)
    })

    it('returns false when CODEBUFF_USE_KIMI is "0"', () => {
      process.env.CODEBUFF_USE_KIMI = '0'
      expect(isKimiModelOverrideEnabled()).toBe(false)
    })
  })

  describe('applyKimiModelOverride', () => {
    const originalEnv = process.env.CODEBUFF_USE_KIMI

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CODEBUFF_USE_KIMI
      } else {
        process.env.CODEBUFF_USE_KIMI = originalEnv
      }
    })

    it('returns original model when override is disabled', () => {
      delete process.env.CODEBUFF_USE_KIMI
      expect(applyKimiModelOverride('anthropic/claude-sonnet-4.5')).toBe(
        'anthropic/claude-sonnet-4.5',
      )
    })

    it('replaces anthropic models when override is enabled', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(applyKimiModelOverride('anthropic/claude-sonnet-4.5')).toBe(
        KIMI_MODEL_ID,
      )
    })

    it('replaces models containing claude when override is enabled', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(applyKimiModelOverride('claude-sonnet-4')).toBe(KIMI_MODEL_ID)
    })

    it('does not replace non-Claude models', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(applyKimiModelOverride('openai/gpt-4o')).toBe('openai/gpt-4o')
    })
  })

  describe('filterKimiInternalTokens', () => {
    it('removes single Kimi token', () => {
      expect(filterKimiInternalTokens('Hello <|im_start|>world')).toBe(
        'Hello world',
      )
    })

    it('removes multiple Kimi tokens', () => {
      expect(
        filterKimiInternalTokens('<|start|>Hello <|middle|>world<|end|>'),
      ).toBe('Hello world')
    })

    it('removes tool_calls_section tokens', () => {
      expect(
        filterKimiInternalTokens(
          '<|tool_calls_section|>content<|tool_calls_section_end|>',
        ),
      ).toBe('content')
    })

    it('preserves text without Kimi tokens', () => {
      expect(filterKimiInternalTokens('Hello world!')).toBe('Hello world!')
    })

    it('handles empty string', () => {
      expect(filterKimiInternalTokens('')).toBe('')
    })

    it('removes tokens with various content', () => {
      expect(filterKimiInternalTokens('<|assistant|>')).toBe('')
      expect(filterKimiInternalTokens('<|user|>')).toBe('')
      expect(filterKimiInternalTokens('<|system|>')).toBe('')
      expect(filterKimiInternalTokens('<|tool_calls_sectionll_end|>')).toBe('')
    })

    it('preserves normal angle brackets', () => {
      expect(filterKimiInternalTokens('a < b > c')).toBe('a < b > c')
      expect(filterKimiInternalTokens('<html>')).toBe('<html>')
    })
  })

  describe('filterKimiTokensStreaming', () => {
    it('filters complete tokens in single chunk', () => {
      const state = createKimiFilterState()
      const result = filterKimiTokensStreaming('Hello <|token|>world', state)
      expect(result).toBe('Hello world')
    })

    it('handles partial token at chunk boundary', () => {
      const state = createKimiFilterState()

      // First chunk ends with partial token
      const result1 = filterKimiTokensStreaming('Hello <|tok', state)
      expect(result1).toBe('Hello ')

      // Second chunk completes the token
      const result2 = filterKimiTokensStreaming('en|>world', state)
      expect(result2).toBe('world')
    })

    it('handles < at chunk boundary', () => {
      const state = createKimiFilterState()

      // First chunk ends with <
      const result1 = filterKimiTokensStreaming('Hello <', state)
      expect(result1).toBe('Hello ')

      // Second chunk continues with |token|>
      const result2 = filterKimiTokensStreaming('|token|>world', state)
      expect(result2).toBe('world')
    })

    it('handles < followed by non-token content', () => {
      const state = createKimiFilterState()

      // Text with < followed by space is not a Kimi token, should pass through
      const result1 = filterKimiTokensStreaming('a < b', state)
      expect(result1).toBe('a < b')
    })

    it('handles < at end of chunk followed by non-pipe in next chunk', () => {
      const state = createKimiFilterState()

      // First chunk ends with <
      const result1 = filterKimiTokensStreaming('Hello <', state)
      expect(result1).toBe('Hello ')

      // Second chunk starts with space, not |, so the < is released
      const result2 = filterKimiTokensStreaming(' world', state)
      expect(result2).toBe('< world')
    })

    it('handles empty chunks', () => {
      const state = createKimiFilterState()
      expect(filterKimiTokensStreaming('', state)).toBe('')
    })

    it('handles multiple tokens in sequence', () => {
      const state = createKimiFilterState()
      const result = filterKimiTokensStreaming(
        '<|a|><|b|>text<|c|>',
        state,
      )
      expect(result).toBe('text')
    })

    it('streams correctly with small chunks', () => {
      const state = createKimiFilterState()
      const fullText = '<|start|>Hello world<|end|>'
      const results: string[] = []

      // Stream in 3-char chunks
      for (let i = 0; i < fullText.length; i += 3) {
        const chunk = fullText.slice(i, i + 3)
        results.push(filterKimiTokensStreaming(chunk, state))
      }

      expect(results.join('')).toBe('Hello world')
    })
  })
})
