import { describe, test, expect, afterEach } from 'bun:test'

import { applyKimiModelOverride } from '@codebuff/common/util/kimi-model-override'

describe('model-provider', () => {
  describe('applyKimiModelOverride', () => {
    const originalEnv = { ...process.env }

    afterEach(() => {
      // Restore original env
      Object.keys(process.env).forEach((key) => {
        if (!(key in originalEnv)) {
          delete process.env[key]
        }
      })
      Object.assign(process.env, originalEnv)
    })

    test('returns original model when CODEBUFF_USE_KIMI is not set', () => {
      delete process.env.CODEBUFF_USE_KIMI
      expect(applyKimiModelOverride('anthropic/claude-sonnet-4.5')).toBe(
        'anthropic/claude-sonnet-4.5',
      )
    })

    test('replaces anthropic/ models with Kimi when enabled', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(applyKimiModelOverride('anthropic/claude-sonnet-4.5')).toBe(
        'moonshotai/kimi-k2.5',
      )
      expect(applyKimiModelOverride('anthropic/claude-opus-4.1')).toBe(
        'moonshotai/kimi-k2.5',
      )
      expect(applyKimiModelOverride('anthropic/claude-3.5-haiku')).toBe(
        'moonshotai/kimi-k2.5',
      )
    })

    test('replaces models containing "claude" with Kimi when enabled', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(applyKimiModelOverride('claude-sonnet-4')).toBe(
        'moonshotai/kimi-k2.5',
      )
    })

    test('does not replace non-Claude models when enabled', () => {
      process.env.CODEBUFF_USE_KIMI = '1'
      expect(applyKimiModelOverride('openai/gpt-4o')).toBe('openai/gpt-4o')
      expect(applyKimiModelOverride('google/gemini-2.5-pro')).toBe(
        'google/gemini-2.5-pro',
      )
      expect(applyKimiModelOverride('x-ai/grok-4')).toBe('x-ai/grok-4')
    })

    test('does not replace models when CODEBUFF_USE_KIMI is "0"', () => {
      process.env.CODEBUFF_USE_KIMI = '0'
      expect(applyKimiModelOverride('anthropic/claude-sonnet-4.5')).toBe(
        'anthropic/claude-sonnet-4.5',
      )
    })
  })
})
