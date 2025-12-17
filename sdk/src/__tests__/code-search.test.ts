import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import { describe, expect, it, beforeEach, afterEach, spyOn } from 'bun:test'

import { codeSearchWithSpawn, type SpawnFn } from '../tools/code-search'

import type { Readable } from 'stream'

class MockSpawnedProcess extends EventEmitter {
  stdout: Readable
  stderr: Readable

  constructor() {
    super()
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
  }

  kill(_signal?: NodeJS.Signals | number): boolean {
    return true
  }
}

function createMockChildProcess() {
  return new MockSpawnedProcess()
}

/** Creates a typed mock spawn function that captures calls and returns controlled processes */
function createMockSpawn() {
  let currentProcess = createMockChildProcess()
  const calls: Array<{
    command: Parameters<SpawnFn>[0]
    args: string[]
    options: Parameters<SpawnFn>[2]
  }> = []
  
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args: [...args], options })
    currentProcess = createMockChildProcess()
    return currentProcess
  }
  
  return {
    spawn,
    get process() { return currentProcess },
    get calls() { return calls },
    get lastCall() { return calls[calls.length - 1] },
  }
}

// Helper to create ripgrep JSON match output
function createRgJsonMatch(
  filePath: string,
  lineNumber: number,
  lineText: string,
): string {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: filePath },
      lines: { text: lineText },
      line_number: lineNumber,
    },
  })
}

// Helper to create ripgrep JSON context output (for -A, -B, -C flags)
function createRgJsonContext(
  filePath: string,
  lineNumber: number,
  lineText: string,
): string {
  return JSON.stringify({
    type: 'context',
    data: {
      path: { text: filePath },
      lines: { text: lineText },
      line_number: lineNumber,
    },
  })
}

describe('codeSearch', () => {
  let mockSpawn: ReturnType<typeof createMockSpawn>

  type CodeSearchOutput = Awaited<ReturnType<typeof codeSearchWithSpawn>>
  type CodeSearchValue = CodeSearchOutput[0]['value']

  function assertHasStdout(
    value: CodeSearchValue,
  ): asserts value is Extract<CodeSearchValue, { stdout: string }> {
    if (!('stdout' in value)) {
      throw new Error(
        `Expected stdout but got errorMessage: ${value.errorMessage}`,
      )
    }
  }

  function assertHasErrorMessage(
    value: CodeSearchValue,
  ): asserts value is Extract<CodeSearchValue, { errorMessage: string }> {
    if (!('errorMessage' in value)) {
      throw new Error('Expected errorMessage')
    }
  }

  beforeEach(() => {
    mockSpawn = createMockSpawn()
  })

  afterEach(() => {})

  describe('basic search', () => {
    it('should parse standard ripgrep output without context flags', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
      })

      // Simulate ripgrep JSON output
      const output = [
        createRgJsonMatch('file1.ts', 1, 'import foo from "bar"'),
        createRgJsonMatch('file1.ts', 5, 'import { baz } from "qux"'),
        createRgJsonMatch('file2.ts', 10, 'import React from "react"'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      expect(result[0].type).toBe('json')
      const value = result[0].value
      assertHasStdout(value)
      expect(value.stdout).toContain('file1.ts:')
      expect(value.stdout).toContain('file2.ts:')
    })
  })

  describe('context flags handling', () => {
    it('should correctly parse output with -A flag (after context)', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import.*env',
        flags: '-A 2',
      })

      // Ripgrep JSON output with -A 2 includes match + 2 context lines after
      const output = [
        createRgJsonMatch('test.ts', 1, 'import { env } from "./config"'),
        createRgJsonContext('test.ts', 2, 'const apiUrl = env.API_URL'),
        createRgJsonContext('test.ts', 3, 'const apiKey = env.API_KEY'),
        createRgJsonMatch('other.ts', 5, 'import env from "process"'),
        createRgJsonContext('other.ts', 6, 'const nodeEnv = env.NODE_ENV'),
        createRgJsonContext('other.ts', 7, 'const port = env.PORT'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      expect(result[0].type).toBe('json')
      const value = result[0].value
      assertHasStdout(value)

      // Should contain match lines
      expect(value.stdout).toContain('import { env } from "./config"')
      expect(value.stdout).toContain('import env from "process"')

      // Should contain context lines
      expect(value.stdout).toContain('const apiUrl = env.API_URL')
      expect(value.stdout).toContain('const apiKey = env.API_KEY')
      expect(value.stdout).toContain('const nodeEnv = env.NODE_ENV')
      expect(value.stdout).toContain('const port = env.PORT')
    })

    it('should correctly parse output with -B flag (before context)', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'export',
        flags: '-B 2',
      })

      // Ripgrep JSON output with -B 2 includes 2 context lines before + match
      const output = [
        createRgJsonContext('app.ts', 1, 'import React from "react"'),
        createRgJsonContext('app.ts', 2, ''),
        createRgJsonMatch('app.ts', 3, 'export const main = () => {}'),
        createRgJsonContext('utils.ts', 8, 'function validateInput(x: string) {'),
        createRgJsonContext('utils.ts', 9, '  return x.length > 0'),
        createRgJsonMatch('utils.ts', 10, 'export function helper() {}'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should contain match lines
      expect(value.stdout).toContain('export const main = () => {}')
      expect(value.stdout).toContain('export function helper() {}')

      // Should contain before context lines
      expect(value.stdout).toContain('import React from "react"')
      expect(value.stdout).toContain('function validateInput(x: string) {')
      expect(value.stdout).toContain('return x.length > 0')
    })

    it('should correctly parse output with -C flag (context before and after)', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'TODO',
        flags: '-C 1',
      })

      // Ripgrep JSON output with -C 1 includes 1 line before + match + 1 line after
      const output = [
        createRgJsonContext('code.ts', 5, 'function processData() {'),
        createRgJsonMatch('code.ts', 6, '  // TODO: implement this'),
        createRgJsonContext('code.ts', 7, '  return null'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should contain match line
      expect(value.stdout).toContain('TODO: implement this')

      // Should contain context lines before and after
      expect(value.stdout).toContain('function processData() {')
      expect(value.stdout).toContain('return null')
    })

    it('should handle -A flag with multiple matches in same file', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
        flags: '-A 1',
      })

      const output = [
        createRgJsonMatch('file.ts', 1, 'import foo from "foo"'),
        createRgJsonContext('file.ts', 2, 'import bar from "bar"'),
        createRgJsonMatch('file.ts', 3, 'import baz from "baz"'),
        createRgJsonContext('file.ts', 4, ''),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should contain all matches
      expect(value.stdout).toContain('import foo from "foo"')
      expect(value.stdout).toContain('import baz from "baz"')

      // Context line appears as both context and match
      expect(value.stdout).toContain('import bar from "bar"')
    })

    it('should handle -B flag at start of file', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
        flags: '-B 2',
      })

      // First line match has no before context
      const output = createRgJsonMatch('file.ts', 1, 'import foo from "foo"')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should still work with match at file start
      expect(value.stdout).toContain('import foo from "foo"')
    })

    it('should skip separator lines between result groups', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        flags: '-A 1',
      })

      const output = [
        createRgJsonMatch('file1.ts', 1, 'test line'),
        createRgJsonMatch('file2.ts', 5, 'another test'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should not contain '--' separator
      expect(value.stdout).not.toContain('--')
    })
  })

  describe('edge cases with context lines', () => {
    it('should handle filenames with hyphens correctly', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
        flags: '-A 1',
      })

      const output = [
        createRgJsonMatch('my-file.ts', 1, 'import foo'),
        createRgJsonMatch('other-file.ts', 5, 'import bar'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Files are formatted with filename on its own line followed by content
      expect(value.stdout).toContain('my-file.ts:')
      expect(value.stdout).toContain('import foo')
      expect(value.stdout).toContain('other-file.ts:')
      expect(value.stdout).toContain('import bar')
    })

    it('should handle filenames with multiple hyphens and underscores', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        flags: '-A 1',
      })

      const output = createRgJsonMatch(
        'my-complex_file-name.ts',
        10,
        'test content',
      )

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should parse correctly despite multiple hyphens in filename
      expect(value.stdout).toContain('my-complex_file-name.ts:')
      expect(value.stdout).toContain('test content')
    })

    it('should not accumulate entire file content (regression test)', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import.*env',
        flags: '-A 2',
        maxOutputStringLength: 20000,
      })

      const output = [
        createRgJsonMatch('large-file.ts', 5, 'import { env } from "config"'),
        createRgJsonMatch('other.ts', 1, 'import env'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Output should be reasonably sized, not including entire file
      expect(value.stdout.length).toBeLessThan(2000)

      // Should still contain the matches
      expect(value.stdout).toContain('large-file.ts:')
      expect(value.stdout).toContain('other.ts:')
    })
  })

  describe('result limiting with context lines', () => {
    it('should respect maxResults per file with context lines', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        flags: '-A 1',
        maxResults: 2,
      })

      const output = [
        createRgJsonMatch('file.ts', 1, 'test 1'),
        createRgJsonContext('file.ts', 2, 'context 1'),
        createRgJsonMatch('file.ts', 5, 'test 2'),
        createRgJsonContext('file.ts', 6, 'context 2'),
        createRgJsonMatch('file.ts', 10, 'test 3'),
        createRgJsonContext('file.ts', 11, 'context 3'),
        createRgJsonMatch('file.ts', 15, 'test 4'),
        createRgJsonContext('file.ts', 16, 'context 4'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should be limited to 2 match results per file (context lines don't count toward limit)
      // Count how many 'test' matches are in the output
      const testMatches = (value.stdout.match(/test \d/g) || []).length
      expect(testMatches).toBeLessThanOrEqual(2)
      expect(value.stdout).toContain('Results limited')

      // Should still include context lines for the matches that are shown
      if (value.stdout.includes('test 1')) {
        expect(value.stdout).toContain('context 1')
      }
      if (value.stdout.includes('test 2')) {
        expect(value.stdout).toContain('context 2')
      }
    })

    it('should respect globalMaxResults with context lines', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        flags: '-A 1',
        globalMaxResults: 3,
      })

      const output = [
        createRgJsonMatch('file1.ts', 1, 'test 1'),
        createRgJsonContext('file1.ts', 2, 'context 1'),
        createRgJsonMatch('file1.ts', 5, 'test 2'),
        createRgJsonContext('file1.ts', 6, 'context 2'),
        createRgJsonMatch('file2.ts', 1, 'test 3'),
        createRgJsonContext('file2.ts', 2, 'context 3'),
        createRgJsonMatch('file2.ts', 5, 'test 4'),
        createRgJsonContext('file2.ts', 6, 'context 4'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should be limited globally to 3 match results (context lines don't count)
      const matches = (value.stdout.match(/test \d/g) || []).length
      expect(matches).toBeLessThanOrEqual(3)
      // Check for either 'Global limit' message or truncation indicator
      const hasLimitMessage =
        value.stdout.includes('Global limit') ||
        value.stdout.includes('Results limited')
      expect(hasLimitMessage).toBe(true)
    })

    it('should not count context lines toward maxResults limit', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'match',
        flags: '-A 2 -B 2',
        maxResults: 1,
      })

      const output = [
        createRgJsonContext('file.ts', 1, 'context before 1'),
        createRgJsonContext('file.ts', 2, 'context before 2'),
        createRgJsonMatch('file.ts', 3, 'match line'),
        createRgJsonContext('file.ts', 4, 'context after 1'),
        createRgJsonContext('file.ts', 5, 'context after 2'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should include the match
      expect(value.stdout).toContain('match line')

      // Should include all context lines even though maxResults is 1
      expect(value.stdout).toContain('context before 1')
      expect(value.stdout).toContain('context before 2')
      expect(value.stdout).toContain('context after 1')
      expect(value.stdout).toContain('context after 2')
    })
  })

  describe('malformed output handling', () => {
    it('should skip lines without separator', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
      })

      const output = [
        createRgJsonMatch('file.ts', 1, 'valid line'),
        'malformed line without proper JSON',
        createRgJsonMatch('file.ts', 2, 'another valid line'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should still process valid lines
      expect(value.stdout).toContain('valid line')
      expect(value.stdout).toContain('another valid line')
    })

    it('should handle empty output', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'nonexistent',
      })

      mockSpawn.process.stdout.emit('data', Buffer.from(''))
      mockSpawn.process.emit('close', 1)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // formatCodeSearchOutput returns 'No results' for empty input
      expect(value.stdout).toBe('No results')
    })
  })

  describe('bug fixes validation', () => {
    it('should handle patterns starting with hyphen (regression test)', async () => {
      // Bug: Patterns starting with '-' were misparsed as flags
      // Fix: Added '--' separator before pattern in args
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: '-foo',
      })

      const output = createRgJsonMatch('file.ts', 1, 'const x = -foo')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      expect(value.stdout).toContain('file.ts:')
      expect(value.stdout).toContain('-foo')
    })

    it('should strip trailing newlines from line text (regression test)', async () => {
      // Bug: JSON lineText includes trailing \n, causing blank lines
      // Fix: Strip \r?\n from lineText
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
      })

      // Simulate ripgrep JSON with trailing newlines in lineText
      const output = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'file.ts' },
          lines: { text: 'import foo from "bar"\n' }, // trailing newline
          line_number: 1,
        },
      })

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should not have double newlines or blank lines
      expect(value.stdout).not.toContain('\n\n\n')
      expect(value.stdout).toContain('import foo')
    })

    it('should process multiple JSON objects in remainder at close (regression test)', async () => {
      // Bug: Only processed one JSON object in remainder
      // Fix: Loop through all complete lines in remainder
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
      })

      // Send partial JSON chunks that will be completed in remainder
      const match1 = createRgJsonMatch('file1.ts', 1, 'test 1')
      const match2 = createRgJsonMatch('file2.ts', 2, 'test 2')
      const match3 = createRgJsonMatch('file3.ts', 3, 'test 3')

      // Send as one chunk without trailing newline to simulate remainder scenario
      const output = `${match1}\n${match2}\n${match3}`

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // All three matches should be processed
      expect(value.stdout).toContain('file1.ts:')
      expect(value.stdout).toContain('file2.ts:')
      expect(value.stdout).toContain('file3.ts:')
    })

    it('should enforce output size limit during streaming (regression test)', async () => {
      // Bug: Output size only checked at end, could exceed limit
      // Fix: Check estimatedOutputLen during streaming and stop early
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        maxOutputStringLength: 500, // Small limit
      })

      // Generate many matches that would exceed the limit
      const matches: string[] = []
      for (let i = 0; i < 50; i++) {
        matches.push(
          createRgJsonMatch('file.ts', i, `test line ${i} with some content`),
        )
      }
      const output = matches.join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      // Process won't get to close because it should kill early
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should have stopped early and included size limit message
      expect(value.stdout).toContain('Output size limit reached')
      expect(value.message).toContain('Stopped early')
    })

    it('should handle non-UTF8 paths using path.bytes (regression test)', async () => {
      // Bug: Only handled path.text, not path.bytes for non-UTF8 paths
      // Fix: Check both path.text and path.bytes
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
      })

      // Simulate ripgrep JSON with path.bytes instead of path.text
      const output = JSON.stringify({
        type: 'match',
        data: {
          path: { bytes: 'file-with-bytes.ts' }, // Using bytes field
          lines: { text: 'test content' },
          line_number: 1,
        },
      })

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)

      // Should handle path.bytes
      expect(value.stdout).toContain('file-with-bytes.ts:')
      expect(value.stdout).toContain('test content')
    })
  })

  describe('glob pattern handling', () => {
    it('should handle -g flag with glob patterns like *.ts', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
        flags: '-g *.ts',
      })

      const output = [
        createRgJsonMatch('file.ts', 1, 'import foo from "bar"'),
        createRgJsonMatch('file.ts', 5, 'import { baz } from "qux"'),
      ].join('\n')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      expect(result[0].type).toBe('json')
      const value = result[0].value
      assertHasStdout(value)
      expect(value.stdout).toContain('file.ts:')

      // Verify the args passed to spawn include the glob flag correctly
      expect(mockSpawn.calls.length).toBeGreaterThan(0)
      const spawnArgs = mockSpawn.lastCall.args
      expect(spawnArgs).toContain('-g')
      expect(spawnArgs).toContain('*.ts')
    })

    it('should handle -g flag with multiple glob patterns', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
        flags: '-g *.ts -g *.tsx',
      })

      const output = createRgJsonMatch('file.tsx', 1, 'import React from "react"')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      expect(result[0].type).toBe('json')
      const value = result[0].value
      assertHasStdout(value)
      expect(value.stdout).toContain('file.tsx:')

      // Verify both glob patterns are passed correctly
      const spawnArgs = mockSpawn.lastCall.args
      // Should have two -g flags, each followed by its pattern
      const gFlagIndices = spawnArgs
        .map((arg, i) => (arg === '-g' ? i : -1))
        .filter((i) => i !== -1)
      expect(gFlagIndices.length).toBe(2)
      expect(spawnArgs[gFlagIndices[0] + 1]).toBe('*.ts')
      expect(spawnArgs[gFlagIndices[1] + 1]).toBe('*.tsx')
    })

    it('should not deduplicate flag-argument pairs', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'import',
        flags: '-g *.ts -i -g *.tsx',
      })

      const output = createRgJsonMatch('file.tsx', 1, 'import React from "react"')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      await searchPromise

      // Verify flags are preserved in order without deduplication
      const spawnArgs = mockSpawn.lastCall.args
      const flagsSection = spawnArgs.slice(0, spawnArgs.indexOf('--'))
      expect(flagsSection).toContain('-g')
      expect(flagsSection).toContain('*.ts')
      expect(flagsSection).toContain('-i')
      expect(flagsSection).toContain('*.tsx')

      // Count -g flags - should be 2, not deduplicated to 1
      const gCount = flagsSection.filter((arg) => arg === '-g').length
      expect(gCount).toBe(2)
    })
  })

  describe('timeout handling', () => {
    it('should timeout after specified seconds', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        timeoutSeconds: 1,
      })

      // Don't emit any data or close event to simulate hanging
      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Manually trigger the timeout by emitting close
      mockSpawn.process.emit('close', null)

      const result = await searchPromise
      const value = result[0].value
      assertHasErrorMessage(value)

      expect(value.errorMessage).toContain('timed out')
    })
  })

  describe('cwd parameter handling', () => {
    it('should handle cwd: "." correctly', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        cwd: '.',
      })

      const output = createRgJsonMatch('file.ts', 1, 'test content')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)
      expect(value.stdout).toContain('file.ts:')
      expect(value.stdout).toContain('test content')

      // Verify spawn was called with correct cwd
      expect(mockSpawn.calls.length).toBeGreaterThan(0)
      const spawnOptions = mockSpawn.lastCall.options
      // When cwd is '.', it should resolve to the project root
      expect(spawnOptions.cwd).toBe('/test/project')
    })

    it('should handle cwd: "subdir" correctly', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        cwd: 'subdir',
      })

      const output = createRgJsonMatch('file.ts', 1, 'test content')

      mockSpawn.process.stdout.emit('data', Buffer.from(output))
      mockSpawn.process.emit('close', 0)

      const result = await searchPromise
      const value = result[0].value
      assertHasStdout(value)
      expect(value.stdout).toContain('file.ts:')

      // Verify spawn was called with correct cwd
      expect(mockSpawn.calls.length).toBeGreaterThan(0)
      const spawnOptions = mockSpawn.lastCall.options
      expect(spawnOptions.cwd).toBe('/test/project/subdir')
    })

    it('should reject cwd outside project directory', async () => {
      const searchPromise = codeSearchWithSpawn(mockSpawn.spawn, {
        projectPath: '/test/project',
        pattern: 'test',
        cwd: '../outside',
      })

      const result = await searchPromise
      const value = result[0].value
      assertHasErrorMessage(value)

      expect(value.errorMessage).toContain('outside the project directory')
    })
  })
})
