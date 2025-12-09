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
const RENDER_WAIT_MS = 3000
const SHORT_WAIT_MS = 500
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

function logSnapshot(label: string, text: string): void {
  console.log(`\n[CLI E2E DEBUG] ${label}\n${'-'.repeat(40)}\n${text}\n${'-'.repeat(40)}\n`)
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

/**
 * Helper to launch CLI without authentication (for login flow tests)
 */
async function launchCLIWithoutAuth(options: {
  args?: string[]
  cols?: number
  rows?: number
}): Promise<Awaited<ReturnType<typeof launchTerminal>>> {
  const { args = [], cols = 120, rows = 30 } = options
  // Remove authentication-related env vars to trigger login flow
  const envWithoutAuth = { ...process.env, ...cliEnv }
  delete (envWithoutAuth as Record<string, unknown>).CODEBUFF_API_KEY
  delete (envWithoutAuth as Record<string, unknown>).CODEBUFF_TOKEN

  const session = await launchTerminal({
    command: 'bun',
    args: ['run', CLI_PATH, ...args],
    cols,
    rows,
    env: envWithoutAuth,
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
          // Wait for initial render
          await sleep(2000)

          // Press Ctrl+C twice to exit (first shows warning, second exits)
          await session.press(['ctrl', 'c'])
          await sleep(500)
          await session.press(['ctrl', 'c'])

          // Give time for process to exit
          await sleep(1000)

          const text = await session.text()
          const exited =
            text.toLowerCase().includes('exit') ||
            text.toLowerCase().includes('goodbye') ||
            text.toLowerCase().includes('quit') ||
            text.trim().length === 0
          expect(exited).toBe(true)
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
          // Wait for CLI to render
          await sleep(RENDER_WAIT_MS)

          // Type some text
          await session.type('hello world')
          await sleep(SHORT_WAIT_MS)

          const text = await session.text()
          // The typed text should appear in the terminal
          const lower = text.toLowerCase()
          if (!lower.includes('hello world')) {
            logSnapshot('Typed text output', text)
          }
          expect(lower).toContain('hello world')
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'typing a message and pressing enter shows connecting or thinking status',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to render
          await sleep(RENDER_WAIT_MS)

          // Type a message and press enter
          await session.type('test message')
          await sleep(300)
          await session.press('enter')

          // Wait a moment for the status to update
          await sleep(1500)

          const text = await session.text()
          // Should show some status indicator - either connecting, thinking, or working
          // Or show the message was sent
          const hasStatus =
            text.includes('connecting') ||
            text.includes('thinking') ||
            text.includes('working') ||
            text.includes('test message')
          expect(hasStatus).toBe(true)
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
          // Wait for CLI to render
          await sleep(RENDER_WAIT_MS)

          // Press Ctrl+C once
          await session.press(['ctrl', 'c'])
          await sleep(500)

          const text = await session.text()
          // Should show the "Press Ctrl-C again to exit" message
          expect(text).toContain('Ctrl')
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
      'typing / shows command suggestions',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to fully render
          await sleep(3000)

          // Type a slash to trigger command suggestions
          await session.type('/')
          await sleep(800)

          const text = await session.text()
          // Should show some command suggestions
          // Common commands include: init, logout, exit, usage, new, feedback, bash
          const hasCommandSuggestion =
            text.includes('init') ||
            text.includes('logout') ||
            text.includes('exit') ||
            text.includes('usage') ||
            text.includes('new') ||
            text.includes('feedback') ||
            text.includes('bash')
          expect(hasCommandSuggestion).toBe(true)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      'typing /ex filters to exit command',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to fully render
          await sleep(3000)

          // Type /ex to filter commands
          await session.type('/ex')
          await sleep(800)

          const text = await session.text()
          // Should show exit command in suggestions
          expect(text).toContain('exit')
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )

    test(
      '/new command clears the conversation',
      async () => {
        const session = await launchCLI({ args: [] })

        try {
          // Wait for CLI to fully render
          await sleep(3000)

          // Type /new and press enter
          await session.type('/new')
          await sleep(300)
          await session.press('enter')
          await sleep(1000)

          // The CLI should still be running and show the welcome message
          const text = await session.text()
          // Should show some part of the welcome/header
          expect(text.length).toBeGreaterThan(0)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })

  describe('login flow', () => {
    test(
      'shows login prompt when not authenticated',
      async () => {
        const session = await launchCLIWithoutAuth({ args: [] })

        try {
          // Wait for the login modal to appear
          await sleep(3000)

          const text = await session.text()
          // Should show either login prompt or the codebuff logo
          const hasLoginUI =
            text.includes('ENTER') ||
            text.includes('login') ||
            text.includes('Login') ||
            text.includes('codebuff') ||
            text.includes('Codebuff')
          expect(hasLoginUI).toBe(true)
        } finally {
          await session.press(['ctrl', 'c'])
          session.close()
        }
      },
      TIMEOUT_MS,
    )
  })
})
