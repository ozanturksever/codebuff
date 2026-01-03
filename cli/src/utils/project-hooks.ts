import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getProjectRoot } from '../project-files'
import { logger } from './logger'

import type { SuggestedFollowup } from '../state/chat-store'

/**
 * Configuration for a followup hook command.
 */
export interface FollowupHookConfig {
  /** Command to run when followups are suggested. Receives followups as JSON on stdin. */
  command: string
  /** Optional timeout in milliseconds (default: 5000) */
  timeout?: number
}

/**
 * Project hooks configuration schema.
 * Located at .codebuff/hooks.json in the project root.
 */
export interface ProjectHooksConfig {
  /** Hook that processes suggested followups */
  followupHook?: FollowupHookConfig
}

/**
 * Input format sent to the followup hook command via stdin.
 */
export interface TodoItem {
  task: string
  completed: boolean
}

export interface FileChange {
  path: string
  type: 'created' | 'modified' | 'deleted'
}

export interface FollowupHookContext {
  /** Current todo list with completion status */
  todos: TodoItem[]
  /** Recent file changes made in this conversation */
  recentFileChanges: FileChange[]
  /** Summary of what was just completed (last assistant message) */
  lastAssistantMessage?: string
}

export interface FollowupHookInput {
  followups: SuggestedFollowup[]
  toolCallId: string
  context: FollowupHookContext
}

/**
 * Output format expected from the followup hook command.
 * The command should output JSON to stdout.
 */
export interface FollowupHookOutput {
  /** If set, this prompt will be auto-executed */
  prompt?: string
  /** Optional: modified followups to display (if not auto-executing) */
  followups?: SuggestedFollowup[]
}

const HOOKS_CONFIG_PATH = '.codebuff/hooks.json'
const DEFAULT_TIMEOUT_MS = 5000

/**
 * Load project hooks configuration from .codebuff/hooks.json
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadProjectHooksConfig(): ProjectHooksConfig | null {
  try {
    const projectRoot = getProjectRoot()
    const configPath = path.join(projectRoot, HOOKS_CONFIG_PATH)

    if (!fs.existsSync(configPath)) {
      return null
    }

    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content) as ProjectHooksConfig

    // Validate the config structure
    if (config.followupHook && typeof config.followupHook.command !== 'string') {
      logger.warn('Invalid followupHook.command in hooks.json - must be a string')
      return null
    }

    return config
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      'Error loading project hooks config',
    )
    return null
  }
}

/**
 * Execute the followup hook command with the given followups.
 * Returns the hook's output, or null if the command fails or returns no output.
 */
export async function executeFollowupHook(
  config: FollowupHookConfig,
  input: FollowupHookInput,
): Promise<FollowupHookOutput | null> {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    try {
      const projectRoot = getProjectRoot()
      
      // Parse the command (support shell commands)
      const [cmd, ...args] = config.command.split(/\s+/)
      if (!cmd) {
        logger.warn('Empty followup hook command')
        resolve(null)
        return
      }

      const child = spawn(cmd, args, {
        cwd: projectRoot,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        logger.debug(
          { error: error.message, command: config.command },
          'Followup hook command error',
        )
        resolve(null)
      })

      child.on('close', (code) => {
        if (code !== 0) {
          logger.debug(
            { code, stderr, command: config.command },
            'Followup hook command exited with non-zero code',
          )
          resolve(null)
          return
        }

        // Parse the output
        const trimmedOutput = stdout.trim()
        if (!trimmedOutput) {
          // Empty output means no action
          resolve(null)
          return
        }

        try {
          const output = JSON.parse(trimmedOutput) as FollowupHookOutput
          
          // Validate the output structure
          if (output.prompt !== undefined && typeof output.prompt !== 'string') {
            logger.warn('Invalid followup hook output: prompt must be a string')
            resolve(null)
            return
          }

          resolve(output)
        } catch (parseError) {
          // If it's not JSON, treat the entire output as a prompt
          resolve({ prompt: trimmedOutput })
        }
      })

      // Set up timeout handling
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM')
        logger.debug(
          { timeout, command: config.command },
          'Followup hook command timed out',
        )
        resolve(null)
      }, timeout)

      child.on('close', () => {
        clearTimeout(timeoutId)
      })

      // Write input to stdin and close it
      child.stdin?.write(JSON.stringify(input))
      child.stdin?.end()
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Error executing followup hook',
      )
      resolve(null)
    }
  })
}

/**
 * Check if a project has followup hooks configured.
 */
export function hasFollowupHook(): boolean {
  const config = loadProjectHooksConfig()
  return Boolean(config?.followupHook?.command)
}
