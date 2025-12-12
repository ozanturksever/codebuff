/**
 * CLI session fixture for e2e tests
 * Wraps tuistory with login URL capture capability
 */

import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import { launchTerminal } from 'tuistory'

import type { E2EServer } from './infra'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CLI_PATH = path.join(__dirname, '../../cli/src/index.tsx')

type TerminalSession = Awaited<ReturnType<typeof launchTerminal>>

/**
 * Status written by CLI to coordination file for e2e tests
 */
interface E2ELoginUrlStatus {
  status: 'pending' | 'ready' | 'error'
  loginUrl?: string
  error?: string
  timestamp: number
}

export interface CLISession {
  terminal: TerminalSession
  credentialsDir: string
  e2eUrlFile: string
  /**
   * Wait for CLI to provide a login URL via file-based IPC
   */
  waitForLoginUrl: (timeoutMs?: number) => Promise<string>
  /**
   * Get the current terminal text
   */
  text: () => Promise<string>
  /**
   * Wait for text to appear in terminal
   */
  waitForText: (pattern: string | RegExp, options?: { timeout?: number }) => Promise<void>
  /**
   * Type text into the terminal
   */
  type: (text: string) => Promise<void>
  /**
   * Press a key or key combination
   */
  press: (key: string | string[]) => Promise<void>
  /**
   * Close the CLI session and clean up
   */
  close: () => Promise<void>
}

export interface LaunchCLIOptions {
  server: E2EServer
  args?: string[]
  cols?: number
  rows?: number
  /** API key override - omit or set to undefined to force login flow, or provide a string to use specific key */
  apiKey?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get a unique credentials directory for a session
 */
function getCredentialsDir(sessionId: string): string {
  return path.join(os.tmpdir(), `codebuff-e2e-oauth-${sessionId}`)
}

/**
 * Clean up credentials directory
 */
function cleanupCredentialsDir(credentialsDir: string): void {
  try {
    if (fs.existsSync(credentialsDir)) {
      fs.rmSync(credentialsDir, { recursive: true, force: true })
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Launch CLI session for login flow testing
 * The CLI will print login URLs instead of opening browser when CODEBUFF_E2E_NO_BROWSER=true
 */
export async function launchCLISession(options: LaunchCLIOptions): Promise<CLISession> {
  const { server, args = [], cols = 120, rows = 30 } = options
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const credentialsDir = getCredentialsDir(sessionId)
  const e2eUrlFile = path.join(os.tmpdir(), `codebuff-e2e-url-${sessionId}.json`)

  // Ensure credentials directory exists
  fs.mkdirSync(credentialsDir, { recursive: true })

  // Create config directory structure
  // Note: We use 'manicode-dev' because the CLI reads NEXT_PUBLIC_CB_ENVIRONMENT from
  // .env.local (which is 'dev') before our --env-file overrides take effect.
  // The important thing is that this directory is empty (no credentials.json),
  // which triggers the login flow.
  const configDir = path.join(credentialsDir, '.config', 'manicode-dev')
  fs.mkdirSync(configDir, { recursive: true })

  // Build a minimal environment for CLI to prevent inheriting CODEBUFF_API_KEY from parent
  // Bun inherits process.env from parent, so we must NOT spread it to avoid auth bypass
  // Only include essential system vars and explicitly set test-specific vars
  const essentialVars = ['PATH', 'SHELL', 'TERM', 'USER', 'LANG', 'LC_ALL', 'TMPDIR']
  const cliEnv: Record<string, string> = {}
  
  // Copy only essential system variables
  for (const key of essentialVars) {
    if (process.env[key]) {
      cliEnv[key] = process.env[key] as string
    }
  }
  
  // Set test-specific environment variables
  // All NEXT_PUBLIC_* vars are required by the env schema validation
  Object.assign(cliEnv, {
    // Point CLI to the e2e test server
    NEXT_PUBLIC_CODEBUFF_APP_URL: server.url,
    NEXT_PUBLIC_CODEBUFF_BACKEND_URL: server.backendUrl,
    // Use dev environment (matches what .env.local would normally set)
    NEXT_PUBLIC_CB_ENVIRONMENT: 'dev',
    // Required env vars from clientEnvSchema (use test values or inherit from parent)
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'test@example.com',
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY || 'test-posthog-key',
    NEXT_PUBLIC_POSTHOG_HOST_URL: process.env.NEXT_PUBLIC_POSTHOG_HOST_URL || 'https://app.posthog.com',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder',
    NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL: process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL || 'https://billing.stripe.com/test',
    NEXT_PUBLIC_WEB_PORT: process.env.NEXT_PUBLIC_WEB_PORT || '3011',
    // Override HOME to use isolated credentials directory
    HOME: credentialsDir,
    XDG_CONFIG_HOME: path.join(credentialsDir, '.config'),
    // Disable browser opening - use file-based IPC instead  
    CODEBUFF_E2E_NO_BROWSER: 'true',
    // File for login URL coordination (file-based IPC)
    CODEBUFF_E2E_URL_FILE: e2eUrlFile,
    // Disable file logs
    CODEBUFF_DISABLE_FILE_LOGS: 'true',
  })
  
  // Handle API key based on options:
  // - apiKey undefined: don't set CODEBUFF_API_KEY at all to force login flow
  // - apiKey string: use the provided API key (valid or invalid for testing)
  if (options.apiKey !== undefined) {
    cliEnv.CODEBUFF_API_KEY = options.apiKey
  }
  // When apiKey is undefined, we simply don't include CODEBUFF_API_KEY in the env

  // Launch CLI with tuistory
  // IMPORTANT: Run from credentialsDir (which has no .env.local) to prevent
  // Bun from loading .env.local from project root which contains CODEBUFF_API_KEY
  // CLI_PATH is absolute so it will still find the source files
  const terminal = await launchTerminal({
    command: 'bun',
    args: ['run', CLI_PATH, ...args],
    cols,
    rows,
    env: cliEnv,
    cwd: credentialsDir, // Run from isolated dir to prevent .env.local loading
  })

  // Create reliable typing helper
  const originalPress = terminal.press.bind(terminal)
  const reliableType = async (text: string) => {
    for (const char of text) {
      if (char === ' ') {
        await originalPress('space')
      } else {
        await originalPress(char as any)
      }
      await sleep(35)
    }
  }

  const session: CLISession = {
    terminal,
    credentialsDir,
    e2eUrlFile,

    async waitForLoginUrl(timeoutMs = 30000): Promise<string> {
      const startTime = Date.now()

      while (Date.now() - startTime < timeoutMs) {
        // Check file-based IPC for login URL
        if (fs.existsSync(e2eUrlFile)) {
          try {
            const content = fs.readFileSync(e2eUrlFile, 'utf8')
            const status: E2ELoginUrlStatus = JSON.parse(content)
            
            if (status.status === 'ready' && status.loginUrl) {
              return status.loginUrl
            }
            
            if (status.status === 'error') {
              throw new Error(`Login URL fetch failed: ${status.error || 'Unknown error'}`)
            }
            
            // status === 'pending' - keep waiting
          } catch (err) {
            // JSON parse error - file might be partially written, keep waiting
            if (err instanceof SyntaxError) {
              await sleep(100)
              continue
            }
            throw err
          }
        }
        await sleep(500)
      }

      // On timeout, try to get CLI output for debugging
      const cliText = await terminal.text()
      throw new Error(
        `Timed out waiting for login URL after ${timeoutMs}ms.\n` +
        `Coordination file: ${e2eUrlFile}\n` +
        `File exists: ${fs.existsSync(e2eUrlFile)}\n` +
        `CLI output (last 500 chars): ${cliText.slice(-500)}`
      )
    },

    async text(): Promise<string> {
      return terminal.text()
    },

    async waitForText(pattern: string | RegExp, options?: { timeout?: number }): Promise<void> {
      await terminal.waitForText(pattern, options)
    },

    async type(text: string): Promise<void> {
      await reliableType(text)
    },

    async press(key: string | string[]): Promise<void> {
      await originalPress(key as any)
    },

    async close(): Promise<void> {
      try {
        await originalPress(['ctrl', 'c'])
        await sleep(300)
        await originalPress(['ctrl', 'c'])
        await sleep(500)
      } catch {
        // Ignore errors during shutdown
      } finally {
        terminal.close()
        cleanupCredentialsDir(credentialsDir)
        // Clean up the e2e URL coordination file
        try {
          if (fs.existsSync(e2eUrlFile)) {
            fs.unlinkSync(e2eUrlFile)
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  }

  return session
}
