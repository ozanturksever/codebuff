#!/usr/bin/env bun

import { promises as fs } from 'fs'
import { createRequire } from 'module'
import os from 'os'

import { getProjectFileTree } from '@codebuff/common/project-file-tree'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { CodebuffClient } from '@codebuff/sdk'
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query'
import { Command } from 'commander'
import { cyan, green, red, yellow } from 'picocolors'
import React from 'react'

import { App } from './app'
import { handlePublish } from './commands/publish'
import { initializeApp } from './init/init-app'
import { getProjectRoot, setProjectRoot } from './project-files'
import { initAnalytics } from './utils/analytics'
import { getAuthTokenDetails } from './utils/auth'
import { resetCodebuffClient } from './utils/codebuff-client'
import { AGENT_MODE_TO_ID } from './utils/constants'
import { getCliEnv } from './utils/env'
import { initializeAgentRegistry, loadAgentDefinitions } from './utils/local-agent-registry'
import { clearLogFile, logger } from './utils/logger'
import { shouldShowProjectPicker } from './utils/project-picker'
import { saveRecentProject } from './utils/recent-projects'
import { installProcessCleanupHandlers } from './utils/renderer-cleanup'
import { detectTerminalTheme } from './utils/terminal-color-detection'
import { setOscDetectedTheme } from './utils/theme-system'

import type { AgentMode } from './utils/constants'
import type { FileTreeNode } from '@codebuff/common/util/file'

const require = createRequire(import.meta.url)

function loadPackageVersion(): string {
  const env = getCliEnv()
  if (env.CODEBUFF_CLI_VERSION) {
    return env.CODEBUFF_CLI_VERSION
  }

  try {
    const pkg = require('../package.json') as { version?: string }
    if (pkg.version) {
      return pkg.version
    }
  } catch {
    // Continue to dev fallback
  }

  return 'dev'
}

// Configure TanStack Query's focusManager for terminal environments
// This is required because there's no browser visibility API in terminal apps
// Without this, refetchInterval won't work because TanStack Query thinks the app is "unfocused"
focusManager.setEventListener(() => {
  // No-op: no event listeners in CLI environment (no window focus/visibility events)
  return () => {}
})
focusManager.setFocused(true)

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes - auth tokens don't change frequently
        gcTime: 10 * 60 * 1000, // 10 minutes - keep cached data a bit longer
        retry: false, // Don't retry failed auth queries automatically
        refetchOnWindowFocus: false, // CLI doesn't have window focus
        refetchOnReconnect: true, // Refetch when network reconnects
        refetchOnMount: false, // Don't refetch on every mount
      },
      mutations: {
        retry: 1, // Retry mutations once on failure
      },
    },
  })
}

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

function parseArgs(): ParsedArgs {
  const program = new Command()

  program
    .name('codebuff')
    .description('Codebuff CLI - AI-powered coding assistant')
    .version(loadPackageVersion(), '-v, --version', 'Print the CLI version')
    .option(
      '--agent <agent-id>',
      'Run a specific agent id (skips loading local .agents overrides)',
    )
    .option('--clear-logs', 'Remove any existing CLI log files before starting')
    .option(
      '--continue [conversation-id]',
      'Continue from a previous conversation (optionally specify a conversation id)',
    )
    .option(
      '--cwd <directory>',
      'Set the working directory (default: current directory)',
    )
    .option('--lite', 'Start in LITE mode')
    .option('--max', 'Start in MAX mode')
    .option('--plan', 'Start in PLAN mode')
    .option(
      '-n, --non-interactive',
      'Run in non-interactive mode (no TUI, output streamed to stdout)',
    )
    .option(
      '--json',
      'Output structured JSON (only valid with --non-interactive)',
    )
    .option(
      '-q, --quiet',
      'Suppress streaming output, only show final result (implies --non-interactive)',
    )
    .option(
      '--timeout <seconds>',
      'Timeout in seconds for non-interactive mode (default: no timeout)',
    )
    .option(
      '-o, --output <file>',
      'Write output to a file instead of stdout (implies --non-interactive)',
    )
    .helpOption('-h, --help', 'Show this help message')
    .argument('[prompt...]', 'Initial prompt to send to the agent')
    .allowExcessArguments(true)
    .parse(process.argv)

  const options = program.opts()
  const args = program.args

  const continueFlag = options.continue

  // Determine initial mode from flags (last flag wins if multiple specified)
  let initialMode: AgentMode | undefined
  if (options.lite) initialMode = 'LITE'
  if (options.max) initialMode = 'MAX'
  if (options.plan) initialMode = 'PLAN'

  return {
    initialPrompt: args.length > 0 ? args.join(' ') : null,
    agent: options.agent,
    clearLogs: options.clearLogs || false,
    continue: Boolean(continueFlag),
    continueId:
      typeof continueFlag === 'string' && continueFlag.trim().length > 0
        ? continueFlag.trim()
        : null,
    cwd: options.cwd,
    initialMode,
    nonInteractive: options.nonInteractive || options.json || options.quiet || options.output || false,
    json: options.json || false,
    quiet: options.quiet || false,
    timeout: options.timeout ? parseInt(options.timeout, 10) : undefined,
    output: options.output,
  }
}

// Read from stdin if data is being piped (for non-interactive mode)
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    // If stdin is a TTY (interactive terminal), don't wait for input
    if (process.stdin.isTTY) {
      resolve('')
      return
    }

    let data = ''
    process.stdin.setEncoding('utf8')

    // Set a short timeout to detect if stdin has data
    const timeout = setTimeout(() => {
      resolve('')
    }, 100)

    process.stdin.on('data', (chunk) => {
      clearTimeout(timeout)
      data += chunk
    })
    process.stdin.on('end', () => {
      clearTimeout(timeout)
      resolve(data.trim())
    })

    // Resume stdin to start receiving data
    process.stdin.resume()
  })
}

interface JsonOutput {
  success: boolean
  output: string
  error?: string
}

async function runNonInteractive({
  prompt,
  agent,
  initialMode,
  json,
  quiet,
  timeout,
  outputFile,
}: {
  prompt: string
  agent?: string
  initialMode?: AgentMode
  json: boolean
  quiet: boolean
  timeout?: number
  outputFile?: string
}): Promise<void> {
  const { token: apiKey } = getAuthTokenDetails()

  if (!apiKey) {
    if (json) {
      const jsonOutput: JsonOutput = {
        success: false,
        output: '',
        error: 'No authentication token found. Please run `codebuff` first to authenticate.',
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else {
      console.error(
        'Error: No authentication token found. Please run `codebuff` first to authenticate.',
      )
    }
    process.exit(1)
  }

  // Resolve agent ID from mode or explicit agent
  const agentId = agent ?? (initialMode ? AGENT_MODE_TO_ID[initialMode] : AGENT_MODE_TO_ID.DEFAULT)

  const agentDefinitions = loadAgentDefinitions()
  const client = new CodebuffClient({
    apiKey,
    cwd: getProjectRoot(),
    agentDefinitions,
  })

  let responseText = ''

  // Create abort controller for timeout
  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      abortController.abort(new Error(`Request timed out after ${timeout} seconds`))
    }, timeout * 1000)
  }

  try {
    const { output } = await client.run({
      signal: abortController.signal,
      agent: agentId,
      prompt,
      handleStreamChunk: (chunk) => {
        // Handle streaming text chunks for real-time output
        if (typeof chunk === 'string') {
          responseText += chunk
          // Only stream to stdout when not in JSON, quiet, or output file mode
          if (!json && !quiet && !outputFile) {
            process.stdout.write(chunk)
          }
        }
      },
    })

    // Clear timeout on successful completion
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    // Write output to file if specified
    if (outputFile) {
      const outputContent = json
        ? JSON.stringify(
            {
              success: output.type !== 'error',
              output: responseText,
              ...(output.type === 'error' && { error: output.message }),
            } as JsonOutput,
            null,
            2,
          )
        : responseText

      await fs.writeFile(outputFile, outputContent, 'utf-8')

      if (output.type === 'error') {
        console.error(`Error: ${output.message}`)
        process.exit(1)
      }
    } else if (json) {
      // Output structured JSON
      const jsonOutput: JsonOutput = {
        success: output.type !== 'error',
        output: responseText,
        ...(output.type === 'error' && { error: output.message }),
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
      if (output.type === 'error') {
        process.exit(1)
      }
    } else if (quiet) {
      // Output final result only (no streaming)
      if (responseText) {
        process.stdout.write(responseText)
        if (!responseText.endsWith('\n')) {
          console.log()
        }
      }
      if (output.type === 'error') {
        console.error(`Error: ${output.message}`)
        process.exit(1)
      }
    } else {
      // Ensure we end with a newline
      if (responseText && !responseText.endsWith('\n')) {
        console.log()
      }

      if (output.type === 'error') {
        console.error(`\nError: ${output.message}`)
        process.exit(1)
      }
    }
  } catch (error) {
    // Clear timeout on error
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    const isTimeout = error instanceof Error && error.name === 'AbortError'
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    if (json) {
      const jsonOutput: JsonOutput = {
        success: false,
        output: responseText,
        error: isTimeout ? `Request timed out after ${timeout} seconds` : errorMessage,
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else {
      if (isTimeout) {
        console.error(`Error: Request timed out after ${timeout} seconds`)
      } else {
        console.error('Error running prompt:', errorMessage)
      }
    }
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const {
    initialPrompt,
    agent,
    clearLogs,
    continue: continueChat,
    continueId,
    cwd,
    initialMode,
    nonInteractive,
    json,
    quiet,
    timeout,
    output: outputFile,
  } = parseArgs()

  const isPublishCommand = process.argv.includes('publish')
  const hasAgentOverride = Boolean(agent && agent.trim().length > 0)

  // Handle non-interactive mode early, before TUI/OSC setup for faster startup
  if (nonInteractive) {
    await initializeApp({ cwd })

    // Initialize agent registry for non-interactive mode too
    if (!hasAgentOverride) {
      await initializeAgentRegistry()
    }

    // Get prompt from args or stdin
    let prompt = initialPrompt
    if (!prompt) {
      prompt = await readStdin()
    }

    if (!prompt) {
      if (json) {
        const jsonOutput: JsonOutput = {
          success: false,
          output: '',
          error: 'No prompt provided.',
        }
        console.log(JSON.stringify(jsonOutput, null, 2))
      } else {
        console.error(
          'Error: No prompt provided.\n\n' +
            'Usage: codebuff -n "your prompt here"\n' +
            '   or: echo "your prompt" | codebuff -n',
        )
      }
      process.exit(1)
    }

    await runNonInteractive({ prompt, agent, initialMode, json, quiet, timeout, outputFile })
    process.exit(0)
  }

  // Run OSC theme detection BEFORE anything else for interactive mode.
  // This MUST happen before OpenTUI starts because OSC responses come through stdin,
  // and OpenTUI also listens to stdin. Running detection here ensures stdin is clean.
  if (process.stdin.isTTY && process.platform !== 'win32') {
    try {
      const oscTheme = await detectTerminalTheme()
      if (oscTheme) {
        setOscDetectedTheme(oscTheme)
      }
    } catch {
      // Silently ignore OSC detection failures
    }
  }

  await initializeApp({ cwd })

  // Show project picker only when user starts at the home directory or an ancestor
  const projectRoot = getProjectRoot()
  const homeDir = os.homedir()
  const startCwd = process.cwd()
  const showProjectPicker = shouldShowProjectPicker(startCwd, homeDir)

  // Initialize agent registry (loads user agents via SDK).
  // When --agent is provided, skip local .agents to avoid overrides.
  if (isPublishCommand || !hasAgentOverride) {
    await initializeAgentRegistry()
  }

  // Handle publish command before rendering the app
  if (isPublishCommand) {
    const publishIndex = process.argv.indexOf('publish')
    const agentIds = process.argv.slice(publishIndex + 1)
    const result = await handlePublish(agentIds)

    if (result.success && result.publisherId && result.agents) {
      console.log(green('✅ Successfully published:'))
      for (const agent of result.agents) {
        console.log(
          cyan(
            `  - ${agent.displayName} (${result.publisherId}/${agent.id}@${agent.version})`,
          ),
        )
      }
      process.exit(0)
    } else {
      console.log(red('❌ Publish failed'))
      if (result.error) console.log(red(`Error: ${result.error}`))
      if (result.details) console.log(red(result.details))
      if (result.hint) console.log(yellow(`Hint: ${result.hint}`))
      process.exit(1)
    }
  }

  // Initialize analytics
  try {
    initAnalytics()
  } catch (error) {
    // Analytics initialization is optional - don't fail the app if it errors
    logger.debug(error, 'Failed to initialize analytics')
  }

  if (clearLogs) {
    clearLogFile()
  }

  const queryClient = createQueryClient()

  const AppWithAsyncAuth = () => {
    const [requireAuth, setRequireAuth] = React.useState<boolean | null>(null)
    const [hasInvalidCredentials, setHasInvalidCredentials] =
      React.useState(false)
    const [fileTree, setFileTree] = React.useState<FileTreeNode[]>([])
    const [currentProjectRoot, setCurrentProjectRoot] =
      React.useState(projectRoot)
    const [showProjectPickerScreen, setShowProjectPickerScreen] =
      React.useState(showProjectPicker)

    React.useEffect(() => {
      const apiKey = getAuthTokenDetails().token ?? ''

      if (!apiKey) {
        setRequireAuth(true)
        setHasInvalidCredentials(false)
        return
      }

      setHasInvalidCredentials(true)
      setRequireAuth(false)
    }, [])

    const loadFileTree = React.useCallback(async (root: string) => {
      try {
        if (root) {
          const tree = await getProjectFileTree({
            projectRoot: root,
            fs: fs,
          })
          logger.info({ tree }, 'Loaded file tree')
          setFileTree(tree)
        }
      } catch (error) {
        // Silently fail - fileTree is optional for @ menu
      }
    }, [])

    React.useEffect(() => {
      loadFileTree(currentProjectRoot)
    }, [currentProjectRoot, loadFileTree])

    // Callback for when user selects a new project from the picker
    const handleProjectChange = React.useCallback(
      async (newProjectPath: string) => {
        // Change process working directory
        process.chdir(newProjectPath)
        // Update the project root in the module state
        setProjectRoot(newProjectPath)
        // Reset client to ensure tools use the updated project root
        resetCodebuffClient()
        // Save to recent projects list
        saveRecentProject(newProjectPath)
        // Update local state
        setCurrentProjectRoot(newProjectPath)
        // Reset file tree state to trigger reload
        setFileTree([])
        // Hide the picker and show the chat
        setShowProjectPickerScreen(false)
      },
      [],
    )

    return (
      <App
        initialPrompt={initialPrompt}
        agentId={agent}
        requireAuth={requireAuth}
        hasInvalidCredentials={hasInvalidCredentials}
        fileTree={fileTree}
        continueChat={continueChat}
        continueChatId={continueId ?? undefined}
        initialMode={initialMode}
        showProjectPicker={showProjectPickerScreen}
        onProjectChange={handleProjectChange}
      />
    )
  }

  const renderer = await createCliRenderer({
    backgroundColor: 'transparent',
    exitOnCtrlC: false,
  })
  installProcessCleanupHandlers(renderer)
  createRoot(renderer).render(
    <QueryClientProvider client={queryClient}>
      <AppWithAsyncAuth />
    </QueryClientProvider>,
  )
}

void main()
