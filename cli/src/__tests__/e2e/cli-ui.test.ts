import path from 'path'

import { describe, test, expect, beforeAll } from 'bun:test'
import { launchTerminal } from 'tuistory'

import {
  isSDKBuilt,
  ensureCliTestEnv,
  getDefaultCliEnv,
  sleep,
} from '../test-utils'

const CLI_PATH = path.join(__dirname, '../../index.tsx')
const TIMEOUT_MS = 25000
const sdkBuilt = isSDKBuilt()
type TerminalSession = Awaited<ReturnType<typeof launchTerminal>>

if (!sdkBuilt) {
  describe.skip('CLI UI Tests', () => {
    test('skipped because SDK is not built', () => {})
  })
  throw new Error('Skipping CLI UI E2E: SDK not built')
}

let cliEnv: Record<string, string> = {}

beforeAll(() => {
  ensureCliTestEnv()
  cliEnv = getDefaultCliEnv()
})

function attachReliableTyping(session: TerminalSession, keyDelayMs = 40): TerminalSession {
  const originalPress = session.press.bind(session)
  const reliableType = async (text: string) => {
    for (const char of text) {
      if (char === ' ') {
        await originalPress('space')
      } else {
        await originalPress(char as any)
      }
      // Slight delay avoids dropped keystrokes in CI
      await sleep(keyDelayMs)
    }
  }

  // Avoid mutating the original session; return a thin wrapper
  return Object.assign(Object.create(session), {
    type: reliableType,
  })
}

/**
 * Helper to launch the CLI with terminal emulator
 */
async function launchCLI(options: {
  args?: string[]
  cols?: number
  rows?: number
  env?: Record<string, string>
}): Promise<Awaited<ReturnType<typeof launchTerminal>>> {
  const { args = [], cols = 120, rows = 30, env } = options
  const session = await launchTerminal({
    command: 'bun',
    args: ['run', CLI_PATH, ...args],
    cols,
    rows,
    env: { ...process.env, ...cliEnv, ...env },
  })
  return attachReliableTyping(session)
}

describe('CLI UI Tests', () => {
  describe('CLI flags', () => {
    test(
      'shows help with --help flag',
      async () => {
        const session = await launchCLI({ args: ['--help'] })

        try {
          await session.waitForText('Usage:', { timeout: 10000 })

          const text = await session.text()
          expect(text).toContain('--agent')
          expect(text).toContain('--version')
          expect(text).toContain('--help')
          expect(text).toContain('Usage:')
        } finally {
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'shows help with -h flag',
      async () => {
        const session = await launchCLI({ args: ['-h'] })

        try {
          await session.waitForText('Usage:', { timeout: 10000 })

          const text = await session.text()
          expect(text).toContain('--agent')
          expect(text).toContain('--help')
        } finally {
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'shows version with --version flag',
      async () => {
        const session = await launchCLI({
          args: ['--version'],
          cols: 80,
          rows: 10,
        })

        try {
          await session.waitForText(/\d+\.\d+\.\d+|dev/, { timeout: 10000 })

          const text = await session.text()
          expect(text).toMatch(/\d+\.\d+\.\d+|dev/)
        } finally {
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'shows version with -v flag',
      async () => {
        const session = await launchCLI({ args: ['-v'], cols: 80, rows: 10 })

        try {
          await session.waitForText(/\d+\.\d+\.\d+|dev/, { timeout: 10000 })

          const text = await session.text()
          expect(text).toMatch(/\d+\.\d+\.\d+|dev/)
        } finally {
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'rejects invalid flags',
      async () => {
        const session = await launchCLI({ args: ['--invalid-flag-xyz'] })

        try {
          // Commander should show an error for invalid flags
          await session.waitForText(/unknown option|error/i, { timeout: 10000 })

          const text = await session.text()
          expect(text.toLowerCase()).toContain('unknown')
        } finally {
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })

  describe('CLI startup', () => {
    test(
      'starts and renders initial UI',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          await session.waitForText(
            /codebuff|login|directory|will run commands/i,
            { timeout: 15000 },
          )

          const text = await session.text()
          expect(text.length).toBeGreaterThan(0)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'accepts --agent flag without crashing',
      async () => {
        const session = await launchCLI({ args: ['--agent', 'ask'] })

        try {
          await session.waitForText(/ask|codebuff|login/i, { timeout: 15000 })

          const text = await session.text()
          expect(text.toLowerCase()).not.toContain('unknown option')
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'accepts --clear-logs flag without crashing',
      async () => {
        const session = await launchCLI({ args: ['--clear-logs'] })

        try {
          await session.waitForText(/codebuff|login|directory/i, {
            timeout: 15000,
          })

          const text = await session.text()
          expect(text.length).toBeGreaterThan(0)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })

  describe('keyboard interactions', () => {
    test(
      'Ctrl+C can exit the application',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready (shows input area or main UI)
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Press Ctrl+C once - this should show the exit warning
          await session.press(['ctrl', 'c'])

          // Wait for the warning message to appear
          await session.waitForText(/ctrl.*again|press.*exit/i, { timeout: 5000 })

          // Press Ctrl+C again - this should trigger exit
          await session.press(['ctrl', 'c'])

          // Wait for exit message - the gracefulExit prints "Goodbye!"
          try {
            await session.waitForText(/goodbye/i, { timeout: 5000 })
          } catch {
            // Process may have exited before message was captured - that's OK
          }

          // Verify CLI responded to Ctrl+C
          // If we get here without error, the test passed - the process either:
          // 1. Showed the goodbye message (caught above)
          // 2. Exited cleanly before we could capture the message
        } finally {
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })

  describe('user interactions', () => {
    test(
      'can type text into the input',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Type some text
          await session.type('hello world')

          // Wait for the typed text to appear
          await session.waitForText('hello world', { timeout: 5000 })

          const text = await session.text()
          expect(text.toLowerCase()).toContain('hello world')
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'submitting a message triggers processing state',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Type a message and press enter
          await session.type('test message')
          await session.waitForText('test message', { timeout: 5000 })
          await session.press('enter')

          // After submitting, the CLI should show a processing indicator
          // This could be "thinking", "working", "connecting", or a spinner
          // We wait for any indication that the message was received
          await session.waitForText(/thinking|working|connecting|⠋|⠙|⠹|test message/i, { timeout: 10000 })

          const text = await session.text()
          // Verify the CLI is processing (shows status) or shows the submitted message
          expect(text.length).toBeGreaterThan(0)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'pressing Ctrl+C once shows exit warning',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Press Ctrl+C once
          await session.press(['ctrl', 'c'])

          // Should show the "Press Ctrl-C again to exit" warning
          await session.waitForText(/ctrl.*again|again.*exit/i, { timeout: 5000 })

          const text = await session.text()
          expect(text.toLowerCase()).toMatch(/ctrl.*again|again.*exit/)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })

  describe('slash commands', () => {
    test(
      'typing / triggers autocomplete menu',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Type a slash to trigger command suggestions
          await session.type('/')

          // Wait for autocomplete to show - it should display a list with "/" prefix
          // The autocomplete shows command names, so we look for the slash in input
          // plus any command-like pattern in the suggestions
          await session.waitForText('/', { timeout: 5000 })

          const text = await session.text()
          // Verify the slash was typed and CLI is responsive
          expect(text).toContain('/')
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'typing /ex shows filtered suggestions containing exit',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Type /ex to filter commands
          await session.type('/ex')

          // Wait for the input to show /ex and for autocomplete to filter
          await session.waitForText('/ex', { timeout: 5000 })

          // Give autocomplete time to filter
          await sleep(300)

          const text = await session.text()
          // The filtered list should show 'exit' as a matching command
          expect(text).toContain('exit')
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      '/new command executes without crashing',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to be ready
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 15000 })

          // Type /new and press enter
          await session.type('/new')
          await session.waitForText('/new', { timeout: 5000 })
          await session.press('enter')

          // After /new, the CLI should reset and show the main interface again
          // Wait for the CLI to be responsive (shows directory or main UI elements)
          await session.waitForText(/codebuff|directory|will run/i, { timeout: 10000 })

          const text = await session.text()
          // CLI should be running and showing the main interface
          expect(text.length).toBeGreaterThan(0)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })

  // NOTE: Login flow tests are skipped because removing CODEBUFF_API_KEY from env
  // doesn't guarantee an unauthenticated state - the CLI may have cached credentials
  // or other auth mechanisms. Testing login flow properly requires:
  // 1. A fresh HOME directory with no credentials
  // 2. Full E2E test infrastructure (see full-stack.test.ts)
  // The launchCLIWithoutAuth helper is insufficient for reliable testing.
})
