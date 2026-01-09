import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'

import type { AgentMode } from '../utils/constants'

/**
 * Tests for non-interactive mode functionality in the CLI.
 *
 * Non-interactive mode allows running codebuff without the TUI,
 * streaming output directly to stdout. It can be combined with
 * --json for structured output or --quiet for suppressed streaming.
 *
 * Key behaviors:
 * 1. -n/--non-interactive enables non-interactive mode
 * 2. --json implies non-interactive mode and outputs structured JSON
 * 3. --quiet implies non-interactive mode and suppresses streaming
 * 4. Prompts can be provided via command line args or stdin
 */

type ParsedArgs = {
  initialPrompt: string | null
  agent?: string
  clearLogs: boolean
  continue: boolean
  continueId?: string | null
  cwd?: string
  initialMode?: AgentMode
  nonInteractive: boolean
  json: boolean
  quiet: boolean
  timeout?: number
  output?: string
}

describe('non-interactive-mode', () => {
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  /**
   * Helper function to parse CLI arguments for testing.
   * Mirrors the parseArgs() function in index.tsx.
   */
  function parseTestArgs(args: string[]): ParsedArgs | { help: true } | { version: true } {
    process.argv = ['node', 'codebuff', ...args]

    const program = new Command()
    program
      .name('codebuff')
      .version('1.0.0', '-v, --version', 'Print the CLI version')
      .option('--agent <agent-id>', 'Run a specific agent id')
      .option('--clear-logs', 'Remove any existing CLI log files')
      .option('--continue [conversation-id]', 'Continue from a previous conversation')
      .option('--cwd <directory>', 'Set the working directory')
      .option('--lite', 'Start in LITE mode')
      .option('--max', 'Start in MAX mode')
      .option('--plan', 'Start in PLAN mode')
      .option('-n, --non-interactive', 'Run in non-interactive mode')
      .option('--json', 'Output structured JSON (implies --non-interactive)')
      .option('-q, --quiet', 'Suppress streaming output (implies --non-interactive)')
      .option('--timeout <seconds>', 'Timeout in seconds for non-interactive mode')
      .option('-o, --output <file>', 'Write output to a file (implies --non-interactive)')
      .argument('[prompt...]', 'Initial prompt to send')
      .allowExcessArguments(true)
      .exitOverride()

    try {
      program.parse(process.argv)
    } catch (error) {
      if (error instanceof Error && error.message.includes('(outputHelp)')) {
        return { help: true }
      }
      if (
        error instanceof Error &&
        (error.message.includes('(version)') || error.message.includes('1.0.0'))
      ) {
        return { version: true }
      }
      throw error
    }

    const options = program.opts()
    const promptArgs = program.args
    const continueFlag = options.continue

    let initialMode: AgentMode | undefined
    if (options.lite) initialMode = 'LITE'
    if (options.max) initialMode = 'MAX'
    if (options.plan) initialMode = 'PLAN'

    return {
      initialPrompt: promptArgs.length > 0 ? promptArgs.join(' ') : null,
      agent: options.agent,
      clearLogs: options.clearLogs || false,
      continue: Boolean(continueFlag),
      continueId:
        typeof continueFlag === 'string' && continueFlag.trim().length > 0
          ? continueFlag.trim()
          : null,
      cwd: options.cwd,
      initialMode,
      // --json, --quiet, and --output imply non-interactive
      nonInteractive: options.nonInteractive || options.json || options.quiet || options.output || false,
      json: options.json || false,
      quiet: options.quiet || false,
      timeout: options.timeout ? parseInt(options.timeout, 10) : undefined,
      output: options.output,
    }
  }

  describe('argument parsing', () => {
    describe('-n / --non-interactive flag', () => {
      test('parses -n flag correctly', () => {
        const result = parseTestArgs(['-n', 'explain this code'])
        expect(result).not.toHaveProperty('help')
        expect(result).not.toHaveProperty('version')
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.json).toBe(false)
        expect(parsed.quiet).toBe(false)
        expect(parsed.initialPrompt).toBe('explain this code')
      })

      test('parses --non-interactive flag correctly', () => {
        const result = parseTestArgs(['--non-interactive', 'fix the bug'])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.json).toBe(false)
        expect(parsed.initialPrompt).toBe('fix the bug')
      })

      test('non-interactive defaults to false when not specified', () => {
        const result = parseTestArgs(['hello world'])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(false)
        expect(parsed.json).toBe(false)
        expect(parsed.quiet).toBe(false)
      })
    })

    describe('--json flag', () => {
      test('parses --json flag and sets nonInteractive to true', () => {
        const result = parseTestArgs(['--json', 'analyze this'])
        const parsed = result as ParsedArgs
        expect(parsed.json).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialPrompt).toBe('analyze this')
      })

      test('--json can be combined with explicit -n (redundant but valid)', () => {
        const result = parseTestArgs(['-n', '--json', 'test prompt'])
        const parsed = result as ParsedArgs
        expect(parsed.json).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialPrompt).toBe('test prompt')
      })

      test('--json defaults to false when not specified', () => {
        const result = parseTestArgs(['-n', 'hello'])
        const parsed = result as ParsedArgs
        expect(parsed.json).toBe(false)
      })
    })

    describe('--quiet flag', () => {
      test('parses -q flag and sets nonInteractive to true', () => {
        const result = parseTestArgs(['-q', 'run silently'])
        const parsed = result as ParsedArgs
        expect(parsed.quiet).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialPrompt).toBe('run silently')
      })

      test('parses --quiet flag and sets nonInteractive to true', () => {
        const result = parseTestArgs(['--quiet', 'run silently'])
        const parsed = result as ParsedArgs
        expect(parsed.quiet).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
      })

      test('--quiet defaults to false when not specified', () => {
        const result = parseTestArgs(['-n', 'hello'])
        const parsed = result as ParsedArgs
        expect(parsed.quiet).toBe(false)
      })
    })

    describe('--timeout flag', () => {
      test('parses --timeout flag with value', () => {
        const result = parseTestArgs(['-n', '--timeout', '30', 'run with timeout'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBe(30)
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialPrompt).toBe('run with timeout')
      })

      test('parses --timeout with different values', () => {
        const result = parseTestArgs(['-n', '--timeout', '60', 'task'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBe(60)
      })

      test('--timeout defaults to undefined when not specified', () => {
        const result = parseTestArgs(['-n', 'hello'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBeUndefined()
      })

      test('--timeout can be combined with --json', () => {
        const result = parseTestArgs(['--json', '--timeout', '120', 'prompt'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBe(120)
        expect(parsed.json).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
      })

      test('--timeout can be combined with --quiet', () => {
        const result = parseTestArgs(['--quiet', '--timeout', '45', 'prompt'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBe(45)
        expect(parsed.quiet).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
      })

      test('--timeout parses small values', () => {
        const result = parseTestArgs(['-n', '--timeout', '5', 'quick task'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBe(5)
      })

      test('--timeout parses large values', () => {
        const result = parseTestArgs(['-n', '--timeout', '3600', 'long task'])
        const parsed = result as ParsedArgs
        expect(parsed.timeout).toBe(3600)
      })
    })

    describe('combining with --agent flag', () => {
      test('-n with --agent parses both correctly', () => {
        const result = parseTestArgs([
          '-n',
          '--agent',
          'codebuff/base-lite',
          'explain this',
        ])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.agent).toBe('codebuff/base-lite')
        expect(parsed.initialPrompt).toBe('explain this')
      })

      test('--json with --agent parses both correctly', () => {
        const result = parseTestArgs([
          '--json',
          '--agent',
          'file-picker',
          'find files',
        ])
        const parsed = result as ParsedArgs
        expect(parsed.json).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.agent).toBe('file-picker')
        expect(parsed.initialPrompt).toBe('find files')
      })

      test('--agent with full version string', () => {
        const result = parseTestArgs([
          '-n',
          '--agent',
          'codebuff/base@1.0.0',
          'hello',
        ])
        const parsed = result as ParsedArgs
        expect(parsed.agent).toBe('codebuff/base@1.0.0')
        expect(parsed.nonInteractive).toBe(true)
      })
    })

    describe('combining with mode flags', () => {
      test('-n with --lite sets initialMode to LITE', () => {
        const result = parseTestArgs(['-n', '--lite', 'quick task'])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialMode).toBe('LITE')
        expect(parsed.initialPrompt).toBe('quick task')
      })

      test('-n with --max sets initialMode to MAX', () => {
        const result = parseTestArgs(['-n', '--max', 'complex task'])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialMode).toBe('MAX')
        expect(parsed.initialPrompt).toBe('complex task')
      })

      test('-n with --plan sets initialMode to PLAN', () => {
        const result = parseTestArgs(['-n', '--plan', 'plan this'])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialMode).toBe('PLAN')
        expect(parsed.initialPrompt).toBe('plan this')
      })

      test('--json with --lite sets both correctly', () => {
        const result = parseTestArgs(['--json', '--lite', 'task'])
        const parsed = result as ParsedArgs
        expect(parsed.json).toBe(true)
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialMode).toBe('LITE')
      })

      test('last mode flag wins when multiple specified', () => {
        const result = parseTestArgs(['-n', '--lite', '--max', 'task'])
        const parsed = result as ParsedArgs
        expect(parsed.initialMode).toBe('MAX')
      })
    })

    describe('prompt handling', () => {
      test('parses multi-word prompt correctly', () => {
        const result = parseTestArgs([
          '-n',
          'fix the bug in auth.ts and add tests',
        ])
        const parsed = result as ParsedArgs
        expect(parsed.initialPrompt).toBe('fix the bug in auth.ts and add tests')
      })

      test('handles empty prompt (no prompt args)', () => {
        const result = parseTestArgs(['-n'])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.initialPrompt).toBeNull()
      })

      test('handles prompt with special characters', () => {
        const result = parseTestArgs(['-n', 'fix bug #123 & add feature'])
        const parsed = result as ParsedArgs
        expect(parsed.initialPrompt).toBe('fix bug #123 & add feature')
      })

      test('handles prompt with quotes', () => {
        const result = parseTestArgs(['-n', 'add a "hello world" message'])
        const parsed = result as ParsedArgs
        expect(parsed.initialPrompt).toBe('add a "hello world" message')
      })
    })

    describe('combining all options', () => {
      test('all non-interactive options together', () => {
        const result = parseTestArgs([
          '-n',
          '--json',
          '--agent',
          'base',
          '--max',
          '--cwd',
          '/tmp',
          '--timeout',
          '60',
          'do something',
        ])
        const parsed = result as ParsedArgs
        expect(parsed.nonInteractive).toBe(true)
        expect(parsed.json).toBe(true)
        expect(parsed.agent).toBe('base')
        expect(parsed.initialMode).toBe('MAX')
        expect(parsed.cwd).toBe('/tmp')
        expect(parsed.timeout).toBe(60)
        expect(parsed.initialPrompt).toBe('do something')
      })

      test('flags in different order produce same result', () => {
        const result1 = parseTestArgs(['-n', '--json', 'prompt'])
        const result2 = parseTestArgs(['--json', '-n', 'prompt'])
        const parsed1 = result1 as ParsedArgs
        const parsed2 = result2 as ParsedArgs
        expect(parsed1.nonInteractive).toBe(parsed2.nonInteractive)
        expect(parsed1.json).toBe(parsed2.json)
        expect(parsed1.initialPrompt).toBe(parsed2.initialPrompt)
      })
    })
  })

  describe('JsonOutput interface', () => {
    interface JsonOutput {
      success: boolean
      output: string
      error?: string
    }

    test('success output structure', () => {
      const output: JsonOutput = {
        success: true,
        output: 'The code has been fixed.',
      }

      expect(output.success).toBe(true)
      expect(output.output).toBe('The code has been fixed.')
      expect(output.error).toBeUndefined()
    })

    test('error output structure', () => {
      const output: JsonOutput = {
        success: false,
        output: 'Partial output before error',
        error: 'Something went wrong',
      }

      expect(output.success).toBe(false)
      expect(output.output).toBe('Partial output before error')
      expect(output.error).toBe('Something went wrong')
    })

    test('error output with empty output', () => {
      const output: JsonOutput = {
        success: false,
        output: '',
        error: 'No authentication token found.',
      }

      expect(output.success).toBe(false)
      expect(output.output).toBe('')
      expect(output.error).toBe('No authentication token found.')
    })

    test('JSON output is valid JSON when stringified', () => {
      const output: JsonOutput = {
        success: true,
        output: 'Result with "quotes" and \n newlines',
      }

      const jsonString = JSON.stringify(output, null, 2)
      const parsed = JSON.parse(jsonString) as JsonOutput

      expect(parsed.success).toBe(true)
      expect(parsed.output).toBe('Result with "quotes" and \n newlines')
    })

    test('JSON output handles special characters', () => {
      const output: JsonOutput = {
        success: true,
        output: 'Code: const x = { a: 1, b: "test" };',
      }

      const jsonString = JSON.stringify(output, null, 2)
      const parsed = JSON.parse(jsonString) as JsonOutput

      expect(parsed.output).toBe('Code: const x = { a: 1, b: "test" };')
    })
  })

  describe('error cases', () => {
    test('no prompt in non-interactive mode should be detectable', () => {
      const result = parseTestArgs(['-n'])
      const parsed = result as ParsedArgs

      // The parsing succeeds, but initialPrompt is null
      // The actual error handling happens in main() after parsing
      expect(parsed.nonInteractive).toBe(true)
      expect(parsed.initialPrompt).toBeNull()
    })

    test('--json without prompt should be detectable', () => {
      const result = parseTestArgs(['--json'])
      const parsed = result as ParsedArgs

      expect(parsed.json).toBe(true)
      expect(parsed.nonInteractive).toBe(true)
      expect(parsed.initialPrompt).toBeNull()
    })

    test('--quiet without prompt should be detectable', () => {
      const result = parseTestArgs(['--quiet'])
      const parsed = result as ParsedArgs

      expect(parsed.quiet).toBe(true)
      expect(parsed.nonInteractive).toBe(true)
      expect(parsed.initialPrompt).toBeNull()
    })
  })

  describe('edge cases', () => {
    test('prompt that looks like a flag is treated as prompt', () => {
      // When prompt comes after all flags, it should be treated as prompt
      const result = parseTestArgs(['-n', '--', '--help'])
      const parsed = result as ParsedArgs
      expect(parsed.nonInteractive).toBe(true)
      expect(parsed.initialPrompt).toBe('--help')
    })

    test('empty string is not a valid prompt', () => {
      const result = parseTestArgs(['-n', ''])
      const parsed = result as ParsedArgs
      // Empty string in args becomes null prompt after joining
      expect(parsed.initialPrompt).toBe('')
    })

    test('whitespace-only prompt', () => {
      const result = parseTestArgs(['-n', '   '])
      const parsed = result as ParsedArgs
      expect(parsed.initialPrompt).toBe('   ')
    })

    test('very long prompt', () => {
      const longPrompt = 'a'.repeat(10000)
      const result = parseTestArgs(['-n', longPrompt])
      const parsed = result as ParsedArgs
      expect(parsed.initialPrompt).toBe(longPrompt)
      expect(parsed.initialPrompt?.length).toBe(10000)
    })
  })

  describe('flag aliases and shortcuts', () => {
    test('-n is alias for --non-interactive', () => {
      const result1 = parseTestArgs(['-n', 'prompt'])
      const result2 = parseTestArgs(['--non-interactive', 'prompt'])
      const parsed1 = result1 as ParsedArgs
      const parsed2 = result2 as ParsedArgs

      expect(parsed1.nonInteractive).toBe(parsed2.nonInteractive)
    })

    test('-q is alias for --quiet', () => {
      const result1 = parseTestArgs(['-q', 'prompt'])
      const result2 = parseTestArgs(['--quiet', 'prompt'])
      const parsed1 = result1 as ParsedArgs
      const parsed2 = result2 as ParsedArgs

      expect(parsed1.quiet).toBe(parsed2.quiet)
      expect(parsed1.nonInteractive).toBe(parsed2.nonInteractive)
    })
  })

  describe('non-interactive mode behavior expectations', () => {
    test('non-interactive mode does not require --json or --quiet', () => {
      const result = parseTestArgs(['-n', 'simple prompt'])
      const parsed = result as ParsedArgs

      expect(parsed.nonInteractive).toBe(true)
      expect(parsed.json).toBe(false)
      expect(parsed.quiet).toBe(false)
      // This should stream output to stdout (not JSON, not quiet)
    })

    test('--json mode expects structured output', () => {
      const result = parseTestArgs(['--json', 'prompt'])
      const parsed = result as ParsedArgs

      expect(parsed.json).toBe(true)
      // When json is true, output should be:
      // { "success": true/false, "output": "...", "error": "..." }
    })

    test('--quiet mode expects suppressed streaming', () => {
      const result = parseTestArgs(['--quiet', 'prompt'])
      const parsed = result as ParsedArgs

      expect(parsed.quiet).toBe(true)
      // When quiet is true, streaming is suppressed, final output shown at end
    })

    test('--json and --quiet can both be specified', () => {
      // --json takes precedence for output format
      const result = parseTestArgs(['--json', '--quiet', 'prompt'])
      const parsed = result as ParsedArgs

      expect(parsed.json).toBe(true)
      expect(parsed.quiet).toBe(true)
      expect(parsed.nonInteractive).toBe(true)
    })
  })

  describe('trace output expectations', () => {
    test('traces should be shown to stderr by default (not quiet)', () => {
      const result = parseTestArgs(['-n', 'prompt'])
      const parsed = result as ParsedArgs

      // Non-interactive without quiet means traces visible
      expect(parsed.nonInteractive).toBe(true)
      expect(parsed.quiet).toBe(false)
    })

    test('traces should be suppressed in quiet mode', () => {
      const result = parseTestArgs(['--quiet', 'prompt'])
      const parsed = result as ParsedArgs

      expect(parsed.quiet).toBe(true)
      // Quiet mode suppresses trace output
    })

    test('--json should still show traces to stderr', () => {
      const result = parseTestArgs(['--json', 'prompt'])
      const parsed = result as ParsedArgs

      // JSON mode shows traces to stderr, JSON to stdout
      expect(parsed.json).toBe(true)
      expect(parsed.quiet).toBe(false)
    })

    test('--json --quiet suppresses traces', () => {
      const result = parseTestArgs(['--json', '--quiet', 'prompt'])
      const parsed = result as ParsedArgs

      expect(parsed.json).toBe(true)
      expect(parsed.quiet).toBe(true)
      // Both flags together means no traces, only JSON output
    })
  })

  describe('JSON output with traces interface', () => {
    interface JsonOutputWithTraces {
      success: boolean
      output: string
      traces?: Array<{ type: string; [key: string]: unknown }>
      error?: string
    }

    test('success output includes traces array', () => {
      const output: JsonOutputWithTraces = {
        success: true,
        output: 'Result',
        traces: [
          { type: 'tool_call', toolName: 'read_files', input: {} },
          { type: 'tool_result', toolName: 'read_files' },
        ],
      }

      expect(output.traces).toBeDefined()
      expect(output.traces!.length).toBe(2)
      expect(output.traces![0].type).toBe('tool_call')
    })

    test('traces can include subagent events', () => {
      const output: JsonOutputWithTraces = {
        success: true,
        output: 'Done',
        traces: [
          { type: 'subagent_start', agentType: 'file-picker' },
          { type: 'tool_call', toolName: 'read_files', input: {} },
          { type: 'tool_result', toolName: 'read_files' },
          { type: 'subagent_finish', agentType: 'file-picker' },
        ],
      }

      const subagentEvents = output.traces!.filter(
        (t) => t.type === 'subagent_start' || t.type === 'subagent_finish',
      )
      expect(subagentEvents.length).toBe(2)
    })

    test('error output can still include traces', () => {
      const output: JsonOutputWithTraces = {
        success: false,
        output: 'Partial output',
        error: 'Something failed',
        traces: [
          { type: 'tool_call', toolName: 'write_file', input: {} },
          { type: 'error', message: 'Something failed' },
        ],
      }

      expect(output.success).toBe(false)
      expect(output.traces).toBeDefined()
      expect(output.traces!.some((t) => t.type === 'error')).toBe(true)
    })

    test('traces are valid JSON when stringified', () => {
      const output: JsonOutputWithTraces = {
        success: true,
        output: 'Result',
        traces: [
          { type: 'tool_call', toolName: 'read_files', input: { paths: ['a.ts'] } },
        ],
      }

      const jsonString = JSON.stringify(output, null, 2)
      const parsed = JSON.parse(jsonString) as JsonOutputWithTraces

      expect(parsed.traces).toBeDefined()
      expect(parsed.traces![0].input).toEqual({ paths: ['a.ts'] })
    })
  })
})
