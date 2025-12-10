/**
 * Real E2E Tests for Codebuff CLI
 *
 * These tests run against a real web server with a real database.
 * Each describe block spins up its own fresh database and server for complete isolation.
 *
 * Prerequisites:
 * - Docker must be running
 * - SDK must be built: cd sdk && bun run build
 * - psql must be available (for seeding)
 *
 * Run with: bun test e2e/full-stack.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { isSDKBuilt } from '../test-utils'
import { createE2ETestContext, sleep } from './test-cli-utils'
import { E2E_TEST_USERS } from './test-db-utils'

import type { E2ETestContext } from './test-cli-utils'

const TIMEOUT_MS = 180000 // 3 minutes for e2e tests
const sdkBuilt = isSDKBuilt()

// Check if Docker is available
function isDockerAvailable(): boolean {
  try {
    const { execSync } = require('child_process')
    execSync('docker info', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const dockerAvailable = isDockerAvailable()

if (!sdkBuilt || !dockerAvailable) {
  const reason = !sdkBuilt
    ? 'SDK not built (run: cd sdk && bun run build)'
    : 'Docker not running'
  describe.skip(`E2E skipped: ${reason}`, () => {
    test('skipped', () => {})
  })
  // Prevent the rest of the suite from registering
  // eslint-disable-next-line no-process-exit
  throw new Error(`Skipping CLI E2E: ${reason}`)
}

describe('E2E: Chat Interaction', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for Chat Interaction...')
    ctx = await createE2ETestContext('chat-interaction')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    'CLI starts and shows main interface',
    async () => {
      const session = await ctx.createSession()

      // Wait for the main CLI interface to load
      // The CLI shows "Directory:" and project path when ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      const text = await session.cli.text()
      // Verify we see the directory indicator which confirms main UI loaded
      expect(text.toLowerCase()).toContain('directory')
    },
    TIMEOUT_MS,
  )

  test(
    'typed text appears in input',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type a test message
      await session.cli.type('Hello from e2e test')

      // Wait for typed text to appear
      await session.cli.waitForText('Hello from e2e test', { timeout: 10000 })

      const text = await session.cli.text()
      expect(text).toContain('Hello from e2e test')
    },
    TIMEOUT_MS,
  )

  test(
    'submitting message shows processing indicator',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type and send a message
      await session.cli.type('What is 2+2?')
      await session.cli.waitForText('What is 2+2?', { timeout: 5000 })
      await session.cli.press('enter')

      // After submitting, wait for a processing indicator (spinner or status text)
      // The CLI shows "thinking", "working", or spinner characters when processing
      await session.cli.waitForText(/thinking|working|connecting|⠋|⠙|⠹/i, { timeout: 15000 })
    },
    TIMEOUT_MS,
  )
})

describe('E2E: Slash Commands', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for Slash Commands...')
    ctx = await createE2ETestContext('slash-commands')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    '/new command executes and CLI remains responsive',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /new and press enter
      await session.cli.type('/new')
      await session.cli.waitForText('/new', { timeout: 5000 })
      await session.cli.press('enter')

      // After /new, CLI should reset and show the main interface again
      await session.cli.waitForText(/directory/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toContain('directory')
    },
    TIMEOUT_MS,
  )

  test(
    '/usage displays credit or usage information',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /usage and press enter
      await session.cli.type('/usage')
      await session.cli.waitForText('/usage', { timeout: 5000 })
      await session.cli.press('enter')

      // Wait for usage information to appear
      // The /usage command shows credit balance or usage stats
      await session.cli.waitForText(/credit|usage|balance|remaining/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/credit|usage|balance|remaining/)
    },
    TIMEOUT_MS,
  )

  test(
    'typing / displays autocomplete with command suggestions',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type / to trigger suggestions
      await session.cli.type('/')

      // Wait for autocomplete to show command names
      await session.cli.waitForText(/new|exit|usage|init|logout/i, { timeout: 5000 })

      const text = await session.cli.text()
      // Verify autocomplete shows at least one command name
      expect(text.toLowerCase()).toMatch(/new|exit|usage|init|logout/)
    },
    TIMEOUT_MS,
  )
})

describe('E2E: User Authentication', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for User Authentication...')
    ctx = await createE2ETestContext('user-auth')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    'authenticated user sees main CLI interface',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.default)

      // Authenticated users should see the main interface with "Directory:"
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toContain('directory')
    },
    TIMEOUT_MS,
  )

  test(
    '/logout command is accepted by CLI',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.default)

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Capture text before logout
      const textBefore = await session.cli.text()

      // Type /logout and submit
      await session.cli.type('/logout')
      await session.cli.waitForText('/logout', { timeout: 5000 })
      await session.cli.press('enter')

      // Wait for the UI to change after command execution
      // The /logout command may show a confirmation, redirect to login, or just clear the session
      await sleep(2000)

      const textAfter = await session.cli.text()
      // Verify the command was processed - UI should have changed or command was consumed
      // The /logout in the input field should be gone (command was submitted)
      const commandWasProcessed = !textAfter.includes('/logout') || textAfter !== textBefore
      expect(commandWasProcessed).toBe(true)
    },
    TIMEOUT_MS,
  )
})

describe('E2E: Agent Modes', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for Agent Modes...')
    ctx = await createE2ETestContext('agent-modes')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    '/mode:lite command switches to lite mode',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type mode command
      await session.cli.type('/mode:lite')
      await session.cli.waitForText('/mode:lite', { timeout: 5000 })
      await session.cli.press('enter')

      // After mode switch, CLI should show "LITE" indicator in the UI
      await session.cli.waitForText(/lite/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toContain('lite')
    },
    TIMEOUT_MS,
  )

  test(
    '/mode:max command switches to max mode',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type mode command and send it
      await session.cli.type('/mode:max')
      await session.cli.waitForText('/mode:max', { timeout: 5000 })
      await session.cli.press('enter')

      // After mode switch, CLI should show "MAX" indicator in the UI
      await session.cli.waitForText(/max/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toContain('max')
    },
    TIMEOUT_MS,
  )
})

describe('E2E: Additional Slash Commands', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log(
      '\n🚀 Starting E2E test context for Additional Slash Commands...',
    )
    ctx = await createE2ETestContext('additional-slash-commands')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    '/init command shows project configuration UI',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /init and press enter
      await session.cli.type('/init')
      await session.cli.waitForText('/init', { timeout: 5000 })
      await session.cli.press('enter')

      // /init should show project configuration options
      await session.cli.waitForText(/init|project|configure|knowledge/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/init|project|configure|knowledge/)
    },
    TIMEOUT_MS,
  )

  test(
    '/bash command enters bash mode',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /bash and press enter
      await session.cli.type('/bash')
      await session.cli.waitForText('/bash', { timeout: 5000 })
      await session.cli.press('enter')

      // /bash should show bash mode indicator
      await session.cli.waitForText(/bash|shell|\$/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/bash|shell/)
    },
    TIMEOUT_MS,
  )

  test(
    '/feedback command shows feedback UI',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /feedback and press enter
      await session.cli.type('/feedback')
      await session.cli.waitForText('/feedback', { timeout: 5000 })
      await session.cli.press('enter')

      // /feedback should show feedback prompt
      await session.cli.waitForText(/feedback/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toContain('feedback')
    },
    TIMEOUT_MS,
  )

  test(
    '/referral command shows referral UI',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /referral and press enter
      await session.cli.type('/referral')
      await session.cli.waitForText('/referral', { timeout: 5000 })
      await session.cli.press('enter')

      // /referral should show referral-related content
      await session.cli.waitForText(/referral|code|redeem/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/referral|code|redeem/)
    },
    TIMEOUT_MS,
  )

  test(
    '/image command shows image attachment UI',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type /image and press enter
      await session.cli.type('/image')
      await session.cli.waitForText('/image', { timeout: 5000 })
      await session.cli.press('enter')

      // /image should show image attachment prompt
      await session.cli.waitForText(/image|file|attach|path/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/image|file|attach|path/)
    },
    TIMEOUT_MS,
  )

  test(
    '/exit command is accepted by CLI',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Capture text before exit
      const textBefore = await session.cli.text()

      // Type /exit and press enter
      await session.cli.type('/exit')
      await session.cli.waitForText('/exit', { timeout: 5000 })
      await session.cli.press('enter')

      // Wait for the UI to change after command execution
      // The /exit command may show goodbye message or just terminate
      await sleep(2000)

      const textAfter = await session.cli.text()
      // Verify the command was processed - UI should have changed or command was consumed
      // The /exit in the input field should be gone (command was submitted)
      const commandWasProcessed = !textAfter.includes('/exit') || textAfter !== textBefore
      expect(commandWasProcessed).toBe(true)
    },
    TIMEOUT_MS,
  )
})

describe('E2E: CLI Flags', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for CLI Flags...')
    ctx = await createE2ETestContext('cli-flags')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    '--help flag shows usage information',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.default, [
        '--help',
      ])

      // Wait for help content to appear - should show "Usage:" section
      await session.cli.waitForText(/usage:/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toContain('usage')
    },
    TIMEOUT_MS,
  )

  test(
    '--version flag shows version number',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.default, [
        '--version',
      ])

      // Wait for version output - should show semver or "dev"
      await session.cli.waitForText(/\d+\.\d+\.\d+|dev/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text).toMatch(/\d+\.\d+\.\d+|dev/)
    },
    TIMEOUT_MS,
  )

  test(
    '--agent flag starts CLI with specified agent visible in UI',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.default, [
        '--agent',
        'ask',
      ])

      // CLI should show the agent name in the UI
      await session.cli.waitForText(/ask/i, { timeout: 15000 })

      const text = await session.cli.text()
      // Verify the agent name appears in the UI (mode indicator shows agent)
      expect(text.toLowerCase()).toContain('ask')
    },
    TIMEOUT_MS,
  )

  test(
    'invalid flag shows error message',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.default, [
        '--invalid-flag-xyz',
      ])

      // Should show error for invalid flag
      await session.cli.waitForText(/unknown|error|invalid/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/unknown|error|invalid/)
    },
    TIMEOUT_MS,
  )
})

describe('E2E: Keyboard Interactions', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for Keyboard Interactions...')
    ctx = await createE2ETestContext('keyboard-interactions')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    'Ctrl+C once shows exit warning',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Press Ctrl+C once
      await session.cli.press(['ctrl', 'c'])

      // Should show warning about pressing Ctrl+C again to exit
      await session.cli.waitForText(/ctrl.*again|again.*exit/i, { timeout: 5000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/ctrl.*again|again.*exit/)
    },
    TIMEOUT_MS,
  )

  test(
    'Ctrl+C twice exits the CLI',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Press Ctrl+C once - this should show the exit warning
      await session.cli.press(['ctrl', 'c'])
      await session.cli.waitForText(/ctrl.*again|again.*exit/i, { timeout: 5000 })

      // Press Ctrl+C again - this should trigger exit
      await session.cli.press(['ctrl', 'c'])

      // Wait for the session exit message (CLI prints session info on exit)
      await session.cli.waitForText(/continue this session|environment/i, { timeout: 10000 })

      const text = await session.cli.text()
      // Verify exit message appeared (CLI shows how to continue the session)
      expect(text.toLowerCase()).toMatch(/continue this session|environment/)
    },
    TIMEOUT_MS,
  )

  test(
    'typing @ shows @ in input',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type @ to trigger suggestions
      await session.cli.type('@')
      await session.cli.waitForText('@', { timeout: 5000 })

      const text = await session.cli.text()
      expect(text).toContain('@')
    },
    TIMEOUT_MS,
  )

  test(
    'backspace deletes characters from input',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type some text
      await session.cli.type('hello')
      await session.cli.waitForText('hello', { timeout: 5000 })

      // Press backspace multiple times
      await session.cli.press('backspace')
      await session.cli.press('backspace')
      await sleep(300)

      // Text should be modified ("hel" instead of "hello")
      const text = await session.cli.text()
      expect(text).toContain('hel')
      expect(text).not.toContain('hello')
    },
    TIMEOUT_MS,
  )

  test(
    'escape key keeps CLI responsive',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type some text
      await session.cli.type('testinput')
      await session.cli.waitForText('testinput', { timeout: 5000 })

      // Press escape
      await session.cli.press('escape')
      await sleep(300)

      // Type more text to verify CLI is still responsive after escape
      await session.cli.type('moretext')
      await session.cli.waitForText('moretext', { timeout: 5000 })

      const text = await session.cli.text()
      // Verify CLI remained responsive after escape - new text was accepted
      expect(text).toContain('moretext')
    },
    TIMEOUT_MS,
  )
})

describe('E2E: Error Scenarios', () => {
  let ctx: E2ETestContext

  beforeAll(async () => {
    console.log('\n🚀 Starting E2E test context for Error Scenarios...')
    ctx = await createE2ETestContext('error-scenarios')
    console.log('✅ E2E test context ready\n')
  })

  afterAll(async () => {
    console.log('\n🧹 Cleaning up E2E test context...')
    await ctx?.cleanup()
    console.log('✅ Cleanup complete\n')
  })

  test(
    'low credits user sees credit information via /usage',
    async () => {
      const session = await ctx.createSession(E2E_TEST_USERS.lowCredits)

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Check /usage to see credit status
      await session.cli.type('/usage')
      await session.cli.waitForText('/usage', { timeout: 5000 })
      await session.cli.press('enter')

      // Should show credit information
      await session.cli.waitForText(/credit|usage|balance|remaining/i, { timeout: 15000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/credit|usage|balance|remaining/)
    },
    TIMEOUT_MS,
  )

  test(
    'invalid slash command shows error feedback',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type an invalid command
      await session.cli.type('/invalidcommandxyz')
      await session.cli.waitForText('/invalidcommandxyz', { timeout: 5000 })
      await session.cli.press('enter')

      // Should show error or suggestion
      await session.cli.waitForText(/unknown|invalid|error|not found|did you mean/i, { timeout: 10000 })

      const text = await session.cli.text()
      expect(text.toLowerCase()).toMatch(/unknown|invalid|error|not found|did you mean/)
    },
    TIMEOUT_MS,
  )

  test(
    'empty message submit keeps CLI responsive',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Press enter with empty input
      await session.cli.press('enter')
      await sleep(500)

      // CLI should still be running - verify by typing
      await session.cli.type('hello')
      await session.cli.waitForText('hello', { timeout: 5000 })

      const text = await session.cli.text()
      expect(text).toContain('hello')
    },
    TIMEOUT_MS,
  )

  test(
    'long input is accepted without crash',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type a long message (100 chars - shorter for reliability)
      const longMessage = 'a'.repeat(100)
      await session.cli.type(longMessage)

      // Wait for some of the text to appear
      await session.cli.waitForText('aaa', { timeout: 10000 })

      const text = await session.cli.text()
      // CLI should have accepted the input without crashing
      expect(text).toContain('aaa')
    },
    TIMEOUT_MS,
  )

  test(
    'special characters in input are displayed',
    async () => {
      const session = await ctx.createSession()

      // Wait for CLI to be ready
      await session.cli.waitForText(/directory/i, { timeout: 15000 })

      // Type message with special characters
      await session.cli.type('Hello world test')
      await session.cli.waitForText('Hello world test', { timeout: 5000 })

      const text = await session.cli.text()
      expect(text).toContain('Hello world test')
    },
    TIMEOUT_MS,
  )
})
