/**
 * E2E Test: Concurrent Streams
 *
 * Tests that multiple concurrent SDK runs maintain separate event streams
 * without interference or data mixing.
 */

import { describe, test, expect, beforeAll } from 'bun:test'

import { CodebuffClient } from '../../src/client'
import {
  EventCollector,
  getApiKey,
  skipIfNoApiKey,
  DEFAULT_AGENT,
  DEFAULT_TIMEOUT,
} from '../utils'

describe('Streaming: Concurrent Streams', () => {
  let client: CodebuffClient

  beforeAll(() => {
    if (skipIfNoApiKey()) return
    client = new CodebuffClient({ apiKey: getApiKey() })
  })

  test(
    'two concurrent runs have independent event streams',
    async () => {
      if (skipIfNoApiKey()) return

      const collector1 = new EventCollector()
      const collector2 = new EventCollector()

      // Run two prompts concurrently with distinctive keywords
      const [result1, result2] = await Promise.all([
        client.run({
          agent: DEFAULT_AGENT,
          prompt: 'Say only the word "ALPHA"',
          handleEvent: collector1.handleEvent,
          handleStreamChunk: collector1.handleStreamChunk,
        }),
        client.run({
          agent: DEFAULT_AGENT,
          prompt: 'Say only the word "BETA"',
          handleEvent: collector2.handleEvent,
          handleStreamChunk: collector2.handleStreamChunk,
        }),
      ])

      // Both should complete successfully
      expect(result1.output.type).not.toBe('error')
      expect(result2.output.type).not.toBe('error')

      // Both should have their own start and finish events
      expect(collector1.hasEventType('start')).toBe(true)
      expect(collector1.hasEventType('finish')).toBe(true)
      expect(collector2.hasEventType('start')).toBe(true)
      expect(collector2.hasEventType('finish')).toBe(true)

      // Verify streams contain expected content and aren't mixed
      const text1 = collector1.getFullStreamText().toUpperCase()
      const text2 = collector2.getFullStreamText().toUpperCase()

      // Each stream should contain its expected keyword
      expect(text1).toContain('ALPHA')
      expect(text2).toContain('BETA')

      // Streams should NOT contain the other stream's keyword (no mixing)
      expect(text1).not.toContain('BETA')
      expect(text2).not.toContain('ALPHA')
    },
    DEFAULT_TIMEOUT * 2,
  )

  test(
    'three concurrent runs all complete without errors',
    async () => {
      if (skipIfNoApiKey()) return

      const collectors = [
        new EventCollector(),
        new EventCollector(),
        new EventCollector(),
      ]

      const prompts = ['Count to 3', 'Name 3 colors', 'List 3 fruits']

      const results = await Promise.all(
        prompts.map((prompt, i) =>
          client.run({
            agent: DEFAULT_AGENT,
            prompt,
            handleEvent: collectors[i].handleEvent,
            handleStreamChunk: collectors[i].handleStreamChunk,
          }),
        ),
      )

      // All should complete
      for (let i = 0; i < results.length; i++) {
        expect(results[i].output.type).not.toBe('error')
        expect(collectors[i].hasEventType('start')).toBe(true)
        expect(collectors[i].hasEventType('finish')).toBe(true)
        expect(collectors[i].errors.length).toBe(0)
      }
    },
    DEFAULT_TIMEOUT * 3,
  )

  test(
    'concurrent runs do not share stream chunks',
    async () => {
      if (skipIfNoApiKey()) return

      const collector1 = new EventCollector()
      const collector2 = new EventCollector()

      await Promise.all([
        client.run({
          agent: DEFAULT_AGENT,
          prompt: 'Write exactly: "FIRST RUN OUTPUT"',
          handleEvent: collector1.handleEvent,
          handleStreamChunk: collector1.handleStreamChunk,
        }),
        client.run({
          agent: DEFAULT_AGENT,
          prompt: 'Write exactly: "SECOND RUN OUTPUT"',
          handleEvent: collector2.handleEvent,
          handleStreamChunk: collector2.handleStreamChunk,
        }),
      ])

      // Each collector should have independent chunks with different content
      // Verify both collectors received content
      expect(collector1.streamChunks.length).toBeGreaterThan(0)
      expect(collector2.streamChunks.length).toBeGreaterThan(0)

      // Get the full text from each stream
      const text1 = collector1.getFullStreamText().toUpperCase()
      const text2 = collector2.getFullStreamText().toUpperCase()

      // Both should have content
      expect(text1.length).toBeGreaterThan(0)
      expect(text2.length).toBeGreaterThan(0)

      // Verify each stream contains its expected keyword
      expect(text1).toContain('FIRST')
      expect(text2).toContain('SECOND')

      // Verify streams are NOT mixed - each should only have its own content
      expect(text1).not.toContain('SECOND')
      expect(text2).not.toContain('FIRST')
    },
    DEFAULT_TIMEOUT * 2,
  )

  test(
    'rapid sequential runs maintain event isolation',
    async () => {
      if (skipIfNoApiKey()) return

      const collectors: EventCollector[] = []

      // Fire off 3 runs in rapid succession
      for (let i = 0; i < 3; i++) {
        const collector = new EventCollector()
        collectors.push(collector)

        const result = await client.run({
          agent: DEFAULT_AGENT,
          prompt: `Say "Run ${i + 1}"`,
          handleEvent: collector.handleEvent,
          handleStreamChunk: collector.handleStreamChunk,
        })

        expect(result.output.type).not.toBe('error')
      }

      // Each should have completed with its own events
      for (const collector of collectors) {
        expect(collector.hasEventType('start')).toBe(true)
        expect(collector.hasEventType('finish')).toBe(true)
      }
    },
    DEFAULT_TIMEOUT * 3,
  )
})
