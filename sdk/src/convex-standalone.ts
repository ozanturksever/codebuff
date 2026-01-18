/**
 * Standalone Convex-compatible Codebuff client.
 *
 * This module provides a completely standalone SDK for Convex that:
 * - Does NOT import from @codebuff/agent-runtime (avoids tree-sitter)
 * - Makes direct HTTP calls to the Codebuff API
 * - Implements a minimal agent loop for tool handling
 *
 * ## Convex Runtime Limitations
 *
 * Convex's sandboxed Node.js runtime has these restrictions:
 * - No WASM modules (web-tree-sitter won't work)
 * - No file system access (fs module unavailable)
 * - No child_process (can't spawn terminals or run commands)
 *
 * As a result, this SDK:
 * - Skips token scoring (no parsed symbol analysis)
 * - Requires projectFiles to be passed explicitly
 * - Provides read_subtree tool to help agents navigate code structure
 *
 * Usage:
 * ```ts
 * import { ConvexCodebuffClient } from '@fatagnus/codebuff/convex'
 *
 * const client = new ConvexCodebuffClient({
 *   apiKey: 'your-api-key',
 *   projectFiles: { 'src/index.ts': 'console.log("hello")' },
 * })
 *
 * const result = await client.run({
 *   agent: 'base',
 *   prompt: 'Explain this code',
 * })
 * ```
 */

import { MAX_AGENT_STEPS_DEFAULT } from '@codebuff/common/constants/agents'
import { generateCompactId } from '@codebuff/common/util/string'

import { WEBSITE_URL } from './constants'
import {
  convexInitialSessionState,
  convexApplyOverridesToSessionState,
} from './convex-session-state'
import {
  getErrorStatusCode,
  createAuthError,
  createNetworkError,
  createHttpError,
} from './error-utils'
import {
  MAX_RETRIES_PER_MESSAGE,
  RETRY_BACKOFF_BASE_DELAY_MS,
  RETRY_BACKOFF_MAX_DELAY_MS,
} from './retry-config'

import type { CustomToolDefinition } from './custom-tool'
import type { ConvexRunState } from './convex-session-state'
import type { AgentDefinition } from '@codebuff/common/templates/initial-agents-dir/types/agent-definition'
import type {
  PublishedToolName,
  ToolName,
} from '@codebuff/common/tools/constants'
import type {
  ClientToolCall,
  ClientToolName,
  CodebuffToolOutput,
  PublishedClientToolName,
} from '@codebuff/common/tools/list'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { CodebuffFileSystem } from '@codebuff/common/types/filesystem'
import type {
  Message,
  ToolMessage,
  AssistantMessage,
  UserMessage,
} from '@codebuff/common/types/messages/codebuff-message'
import type {
  ImagePart,
  TextPart,
  ToolResultOutput,
} from '@codebuff/common/types/messages/content-part'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { SessionState } from '@codebuff/common/types/session-state'
import type { CodebuffSpawn } from '@codebuff/common/types/spawn'

// Re-export types that don't require Node.js built-ins
export type * from '@codebuff/common/types/json'
export type * from '@codebuff/common/types/messages/codebuff-message'
export type * from '@codebuff/common/types/messages/data-content'
export type * from '@codebuff/common/types/print-mode'
export type {
  TextPart,
  ImagePart,
} from '@codebuff/common/types/messages/content-part'
export type { AgentDefinition } from '@codebuff/common/templates/initial-agents-dir/types/agent-definition'
export type { ToolName } from '@codebuff/common/tools/constants'
export type {
  ClientToolCall,
  ClientToolName,
  CodebuffToolOutput,
} from '@codebuff/common/tools/list'
export * from './custom-tool'
export * from './convex-session-state'
export * from './constants'

// Error utilities (don't require Node.js built-ins)
export {
  isRetryableStatusCode,
  getErrorStatusCode,
  sanitizeErrorMessage,
  RETRYABLE_STATUS_CODES,
  createHttpError,
  createAuthError,
  createForbiddenError,
  createPaymentRequiredError,
  createServerError,
  createNetworkError,
} from './error-utils'
export type { HttpError } from './error-utils'

// Retry configuration constants
export {
  MAX_RETRIES_PER_MESSAGE,
  RETRY_BACKOFF_BASE_DELAY_MS,
  RETRY_BACKOFF_MAX_DELAY_MS,
  RECONNECTION_MESSAGE_DURATION_MS,
  RECONNECTION_RETRY_DELAY_MS,
} from './retry-config'

export type { CodebuffFileSystem } from '@codebuff/common/types/filesystem'

/**
 * Error thrown when a tool that requires Node.js built-ins is called in Convex
 */
export class ConvexUnsupportedToolError extends Error {
  constructor(toolName: string, reason: string) {
    super(
      `Tool "${toolName}" is not supported in Convex runtime: ${reason}. ` +
        `Either provide an override via overrideTools, or modify your agent to not use this tool.`,
    )
    this.name = 'ConvexUnsupportedToolError'
  }
}

export type ImageContent = {
  type: 'image'
  image: string // base64 encoded
  mediaType: string
}

export type TextContent = {
  type: 'text'
  text: string
}

export type MessageContent = TextContent | ImageContent

export type ConvexRunOptions = {
  agent: string | AgentDefinition
  prompt: string
  /** Content array for multimodal messages (text + images) */
  content?: MessageContent[]
  params?: Record<string, unknown>
  previousRun?: ConvexRunState
  extraToolResults?: ToolMessage[]
  signal?: AbortSignal
}

/**
 * Maximum depth for nested subagent spawning to prevent infinite recursion
 */
export const MAX_SUBAGENT_DEPTH = 5

export type ConvexClientOptions = {
  apiKey: string

  /**
   * Project files as a plain object. Keys are file paths, values are file contents.
   * Required in Convex since there's no file system access.
   */
  projectFiles?: Record<string, string>
  knowledgeFiles?: Record<string, string>
  agentDefinitions?: AgentDefinition[]
  maxAgentSteps?: number

  handleEvent?: (event: PrintModeEvent) => void | Promise<void>
  handleStreamChunk?: (
    chunk:
      | string
      | {
          type: 'subagent_chunk'
          agentId: string
          agentType: string
          chunk: string
        }
      | {
          type: 'subagent_start'
          agentId: string
          agentType: string
          parentAgentId?: string
          prompt?: string
        }
      | {
          type: 'subagent_finish'
          agentId: string
          agentType: string
          parentAgentId?: string
        }
      | {
          type: 'reasoning_chunk'
          agentId: string
          ancestorRunIds: string[]
          chunk: string
        },
  ) => void | Promise<void>

  /**
   * Override tools with custom implementations.
   * In Convex, you MUST provide overrides for file operations if you need them,
   * since there's no file system access.
   */
  overrideTools?: Partial<
    {
      [K in ClientToolName & PublishedToolName]: (
        input: ClientToolCall<K>['input'],
      ) => Promise<CodebuffToolOutput<K>>
    } & {
      read_files: (input: {
        filePaths: string[]
      }) => Promise<Record<string, string | null>>
    }
  >
  customToolDefinitions?: CustomToolDefinition[]

  logger?: Logger
}

// ============================================================================
// Standalone Utilities (no agent-runtime imports)
// ============================================================================

/**
 * Build user message content from prompt, params, and content parts.
 * Reimplemented locally to avoid agent-runtime import.
 */
function buildUserMessageContent(
  prompt?: string,
  params?: Record<string, unknown>,
  content?: (TextPart | ImagePart)[],
): (TextPart | ImagePart)[] {
  const parts: (TextPart | ImagePart)[] = []

  // Add existing content parts
  if (content && content.length > 0) {
    parts.push(...content)
  }

  // Build text content from prompt and params
  let textContent = ''
  if (prompt) {
    textContent += `<user_message>\n${prompt}\n</user_message>`
  }
  if (params && Object.keys(params).length > 0) {
    textContent += `\n\n<params>\n${JSON.stringify(params, null, 2)}\n</params>`
  }

  if (textContent) {
    parts.push({ type: 'text', text: textContent })
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

/**
 * Wraps content for user messages, ensuring text is wrapped in <user_message> tags.
 */
const wrapContentForUserMessage = (
  content?: (TextPart | ImagePart)[],
): (TextPart | ImagePart)[] | undefined => {
  if (!content || content.length === 0) {
    return content
  }
  return buildUserMessageContent(undefined, undefined, content)
}

/**
 * Create a user message.
 */
function userMessage(content: string | (TextPart | ImagePart)[]): UserMessage {
  const contentArray: (TextPart | ImagePart)[] =
    typeof content === 'string' ? [{ type: 'text', text: content }] : content
  return {
    role: 'user',
    content: contentArray,
    sentAt: Date.now(),
  }
}

/**
 * Create an assistant message.
 */
function assistantMessage(content: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    sentAt: Date.now(),
  }
}

/**
 * Wrap text in system tags for message content.
 */
function withSystemTags(text: string): string {
  return `<system>${text}</system>`
}

/**
 * Filter out unfinished tool calls from message history.
 * This prevents the spawned agent from seeing tool calls that don't have
 * corresponding tool responses, which would throw errors in the API.
 */
export function filterUnfinishedToolCalls(messages: Message[]): Message[] {
  // Collect all tool call IDs that have corresponding tool results
  const completedToolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'tool') {
      completedToolCallIds.add(msg.toolCallId)
    }
  }

  // Filter messages to remove incomplete tool calls from assistant messages
  return messages.map((msg) => {
    if (msg.role !== 'assistant') {
      return msg
    }

    // Filter out tool-call content parts that don't have matching tool results
    const filteredContent = msg.content.filter((part) => {
      if (part.type === 'tool-call') {
        return completedToolCallIds.has((part as any).toolCallId)
      }
      return true
    })

    // If all content was filtered out, skip this message entirely
    if (filteredContent.length === 0) {
      return null
    }

    return {
      ...msg,
      content: filteredContent,
    }
  }).filter((msg): msg is Message => msg !== null)
}

const createAbortError = (signal?: AbortSignal) => {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Stub file system for Convex that throws clear errors.
 */
const createConvexStubFs = (): CodebuffFileSystem => ({
  readFile: async () => {
    throw new ConvexUnsupportedToolError(
      'read_files',
      'File system access is not available in Convex. Provide projectFiles in options or override read_files tool.',
    )
  },
  writeFile: async () => {
    throw new ConvexUnsupportedToolError(
      'write_file',
      'File system access is not available in Convex. Provide an override for write_file tool.',
    )
  },
  readdir: async () => {
    throw new ConvexUnsupportedToolError(
      'list_directory',
      'File system access is not available in Convex.',
    )
  },
  stat: async () => {
    throw new ConvexUnsupportedToolError(
      'stat',
      'File system access is not available in Convex.',
    )
  },
  mkdir: async () => {
    throw new ConvexUnsupportedToolError(
      'mkdir',
      'File system access is not available in Convex.',
    )
  },
})

/**
 * Stub spawn for Convex that throws clear errors
 */
const createConvexStubSpawn = (): CodebuffSpawn => {
  return (() => {
    throw new ConvexUnsupportedToolError(
      'run_terminal_command',
      'child_process is not available in Convex runtime',
    )
  }) as unknown as CodebuffSpawn
}

// ============================================================================
// Direct HTTP API Calls (no AI SDK or agent-runtime)
// ============================================================================

type UserColumn = 'id' | 'email' | 'discord_id' | 'stripe_customer_id' | 'banned'

/**
 * Fetch with retry logic for transient errors.
 */
async function fetchWithRetry(
  url: URL | string,
  options: RequestInit,
  logger?: Logger,
): Promise<Response> {
  let lastError: Error | null = null
  let backoffDelay = RETRY_BACKOFF_BASE_DELAY_MS

  for (let attempt = 0; attempt <= MAX_RETRIES_PER_MESSAGE; attempt++) {
    try {
      const response = await fetch(url, options)

      if (response.ok || response.status < 500) {
        return response
      }

      if (attempt < MAX_RETRIES_PER_MESSAGE) {
        logger?.warn(
          { status: response.status, attempt: attempt + 1, url: String(url) },
          `Retryable HTTP error, retrying in ${backoffDelay}ms`,
        )
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        backoffDelay = Math.min(backoffDelay * 2, RETRY_BACKOFF_MAX_DELAY_MS)
      } else {
        return response
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < MAX_RETRIES_PER_MESSAGE) {
        logger?.warn(
          { error: lastError.message, attempt: attempt + 1, url: String(url) },
          `Network error, retrying in ${backoffDelay}ms`,
        )
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        backoffDelay = Math.min(backoffDelay * 2, RETRY_BACKOFF_MAX_DELAY_MS)
      }
    }
  }

  throw lastError ?? new Error('Request failed after retries')
}

/**
 * Get user info from API key.
 */
async function getUserInfoFromApiKey(
  apiKey: string,
  fields: UserColumn[],
  logger?: Logger,
): Promise<{ id: string } | null> {
  const urlParams = new URLSearchParams({ fields: fields.join(',') })
  const url = new URL(`/api/v1/me?${urlParams}`, WEBSITE_URL)

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      logger,
    )

    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      return null
    }

    if (!response.ok) {
      throw createHttpError('Request failed', response.status)
    }

    return await response.json()
  } catch (error) {
    logger?.error({ error }, 'getUserInfoFromApiKey error')
    throw error
  }
}

/**
 * Start an agent run.
 */
async function startAgentRun(
  apiKey: string,
  agentId: string,
  ancestorRunIds: string[],
  logger?: Logger,
): Promise<string | null> {
  const url = new URL('/api/v1/agent-runs', WEBSITE_URL)

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'START',
          agentId,
          ancestorRunIds,
        }),
      },
      logger,
    )

    if (!response.ok) {
      logger?.error({ status: response.status }, 'startAgentRun request failed')
      return null
    }

    const responseBody = await response.json()
    return responseBody?.runId ?? null
  } catch (error) {
    logger?.error({ error }, 'startAgentRun error')
    return null
  }
}

/**
 * Finish an agent run.
 */
async function finishAgentRun(
  apiKey: string,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  totalSteps: number,
  directCredits: number,
  totalCredits: number,
  logger?: Logger,
): Promise<void> {
  const url = new URL('/api/v1/agent-runs', WEBSITE_URL)

  try {
    await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'FINISH',
          runId,
          status,
          totalSteps,
          directCredits,
          totalCredits,
        }),
      },
      logger,
    )
  } catch (error) {
    logger?.error({ error }, 'finishAgentRun error')
  }
}

/**
 * Convert messages to OpenAI-compatible format for the chat completions API.
 */
function convertToOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
): any[] {
  const openaiMessages: any[] = []

  // Add system message first
  if (systemPrompt) {
    openaiMessages.push({
      role: 'system',
      content: systemPrompt,
    })
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      openaiMessages.push({
        role: 'system',
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((c) => c.text).join('\n\n'),
      })
    } else if (msg.role === 'user') {
      const content: any[] = []
      for (const part of msg.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text })
        } else if (part.type === 'image') {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${part.mediaType};base64,${part.image}`,
            },
          })
        }
      }
      openaiMessages.push({
        role: 'user',
        content: content.length === 1 && content[0].type === 'text'
          ? content[0].text
          : content,
      })
    } else if (msg.role === 'assistant') {
      const textContent = msg.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as any).text)
        .join('')
      const toolCalls = msg.content
        .filter((c) => c.type === 'tool-call')
        .map((c: any) => ({
          id: c.toolCallId,
          type: 'function',
          function: {
            name: c.toolName,
            arguments: JSON.stringify(c.input),
          },
        }))

      const assistantMsg: any = { role: 'assistant' }
      if (textContent) {
        assistantMsg.content = textContent
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
      }
      openaiMessages.push(assistantMsg)
    } else if (msg.role === 'tool') {
      openaiMessages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: JSON.stringify(
          msg.content.length === 1
            ? (msg.content[0] as any).value
            : msg.content.map((c: any) => c.value),
        ),
      })
    }
  }

  return openaiMessages
}

/**
 * Call the chat completions API with streaming.
 */
async function* streamChatCompletion(
  apiKey: string,
  runId: string,
  model: string,
  messages: any[],
  tools: any[] | undefined,
  signal?: AbortSignal,
): AsyncGenerator<{
  type: 'text' | 'tool_call' | 'done'
  content?: string
  toolCall?: {
    id: string
    name: string
    arguments: string
  }
}> {
  const url = new URL('/api/v1/chat/completions', WEBSITE_URL)

  const body: any = {
    model,
    messages,
    stream: true,
    codebuff_metadata: {
      run_id: runId,
    },
  }

  if (tools && tools.length > 0) {
    body.tools = tools
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw createHttpError(
      `Chat completion failed: ${response.status} ${errorText}`,
      response.status,
    )
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const toolCallAccumulators: Record<
    number,
    { id: string; name: string; arguments: string }
  > = {}

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()

        if (data === '[DONE]') {
          // Emit accumulated tool calls
          for (const toolCall of Object.values(toolCallAccumulators)) {
            yield { type: 'tool_call', toolCall }
          }
          yield { type: 'done' }
          return
        }

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const delta = choice.delta
          if (delta?.content) {
            yield { type: 'text', content: delta.content }
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0
              if (!toolCallAccumulators[index]) {
                toolCallAccumulators[index] = {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  arguments: '',
                }
              }
              if (tc.id) {
                toolCallAccumulators[index].id = tc.id
              }
              if (tc.function?.name) {
                toolCallAccumulators[index].name = tc.function.name
              }
              if (tc.function?.arguments) {
                toolCallAccumulators[index].arguments += tc.function.arguments
              }
            }
          }

          if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
            // Emit accumulated tool calls
            for (const toolCall of Object.values(toolCallAccumulators)) {
              if (toolCall.name) {
                yield { type: 'tool_call', toolCall }
              }
            }
            yield { type: 'done' }
            return
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ============================================================================
// Tool Handling
// ============================================================================

/**
 * Read files from projectFiles or override.
 */
async function readFiles({
  filePaths,
  override,
  projectFiles,
}: {
  filePaths: string[]
  override?: NonNullable<
    Required<ConvexClientOptions>['overrideTools']['read_files']
  >
  projectFiles?: Record<string, string>
}) {
  if (override) {
    return await override({ filePaths })
  }

  const result: Record<string, string | null> = {}
  for (const filePath of filePaths) {
    result[filePath] = projectFiles?.[filePath] ?? null
  }
  return result
}

/**
 * Generate a hierarchical file tree string from project files.
 * This is used in the system prompt to help agents understand project structure
 * when token scoring is unavailable (Convex runtime limitation).
 */
function generateFileTreeString(projectFiles: Record<string, string>): string {
  const filePaths = Object.keys(projectFiles).sort()
  if (filePaths.length === 0) return '(no files)'

  // Build tree structure
  const tree: Record<string, any> = {}
  for (const filePath of filePaths) {
    const parts = filePath.split('/')
    let current = tree
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (i === parts.length - 1) {
        // It's a file
        current[part] = null
      } else {
        // It's a directory
        if (!current[part]) current[part] = {}
        current = current[part]
      }
    }
  }

  // Render tree to string
  function renderTree(node: Record<string, any>, prefix: string = ''): string[] {
    const lines: string[] = []
    const entries = Object.entries(node).sort(([a, aVal], [b, bVal]) => {
      // Directories first, then files
      const aIsDir = aVal !== null
      const bIsDir = bVal !== null
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
      return a.localeCompare(b)
    })

    for (let i = 0; i < entries.length; i++) {
      const [name, value] = entries[i]
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const childPrefix = isLast ? '    ' : '│   '

      if (value === null) {
        // File
        lines.push(prefix + connector + name)
      } else {
        // Directory
        lines.push(prefix + connector + name + '/')
        lines.push(...renderTree(value, prefix + childPrefix))
      }
    }
    return lines
  }

  return renderTree(tree).join('\n')
}

/**
 * Read a subtree of files matching a path prefix.
 * This tool helps agents explore project structure when token scoring is unavailable.
 */
function readSubtree({
  paths,
  projectFiles,
  maxFiles = 20,
}: {
  paths: string[]
  projectFiles: Record<string, string>
  maxFiles?: number
}): { tree: string; files: Record<string, string | null> } {
  const allFilePaths = Object.keys(projectFiles).sort()
  const matchingFiles: string[] = []

  for (const path of paths) {
    // Find files that match the path (either exact match or prefix match for directories)
    for (const filePath of allFilePaths) {
      if (filePath === path || filePath.startsWith(path + '/') || filePath.startsWith(path)) {
        if (!matchingFiles.includes(filePath)) {
          matchingFiles.push(filePath)
        }
      }
    }
  }

  // Build a mini tree from matching files
  const matchingProjectFiles: Record<string, string> = {}
  const truncated = matchingFiles.length > maxFiles
  const filesToInclude = matchingFiles.slice(0, maxFiles)

  for (const filePath of filesToInclude) {
    matchingProjectFiles[filePath] = projectFiles[filePath]
  }

  const tree = generateFileTreeString(matchingProjectFiles)
  const treeWithNote = truncated
    ? tree + `\n\n(showing ${maxFiles} of ${matchingFiles.length} files)`
    : tree

  // Return file contents too for convenience
  const files: Record<string, string | null> = {}
  for (const filePath of filesToInclude) {
    files[filePath] = projectFiles[filePath] ?? null
  }

  return { tree: treeWithNote, files }
}

/**
 * Checks if a parent agent is allowed to spawn a child agent.
 * Returns the matching spawnable agent ID or null if not allowed.
 */
export function getMatchingSpawn(
  spawnableAgents: string[],
  childAgentId: string,
): string | null {
  // Extract parts from the child agent ID
  const childParts = childAgentId.split('/')
  const childAgentName = childParts.length > 1 ? childParts[1]?.split('@')[0] : childAgentId.split('@')[0]
  const childVersion = childAgentId.includes('@') ? childAgentId.split('@')[1] : undefined
  const childPublisher = childParts.length > 1 ? childParts[0] : undefined

  for (const spawnableAgent of spawnableAgents) {
    const spawnableParts = spawnableAgent.split('/')
    const spawnableAgentName = spawnableParts.length > 1 ? spawnableParts[1]?.split('@')[0] : spawnableAgent.split('@')[0]
    const spawnableVersion = spawnableAgent.includes('@') ? spawnableAgent.split('@')[1] : undefined
    const spawnablePublisher = spawnableParts.length > 1 ? spawnableParts[0] : undefined

    // Exact match
    if (spawnableAgent === childAgentId) {
      return spawnableAgent
    }

    // Match by agent name only (no version/publisher specified in request)
    if (!childVersion && !childPublisher && spawnableAgentName === childAgentName) {
      return spawnableAgent
    }

    // Match with same publisher and agent name (version may differ)
    if (childPublisher && spawnablePublisher === childPublisher && spawnableAgentName === childAgentName) {
      if (!childVersion || spawnableVersion === childVersion) {
        return spawnableAgent
      }
    }
  }

  return null
}

/**
 * Base agent IDs that are allowed to spawn any agent
 */
export const BASE_AGENT_IDS = ['base', 'base-lite', 'base-max', 'base-experimental']

/**
 * Validates that a parent agent is allowed to spawn the requested child agent.
 */
export function validateSpawnPermission(
  parentAgentId: string,
  parentSpawnableAgents: string[],
  childAgentId: string,
): string {
  // Base agents can spawn any agent
  const parentBaseName = parentAgentId.split('/').pop()?.split('@')[0] ?? parentAgentId
  if (BASE_AGENT_IDS.includes(parentBaseName)) {
    return childAgentId
  }

  const matchedAgent = getMatchingSpawn(parentSpawnableAgents, childAgentId)
  if (!matchedAgent) {
    throw new Error(
      `Agent "${parentAgentId}" is not allowed to spawn child agent "${childAgentId}". ` +
      `Allowed spawnable agents: ${parentSpawnableAgents.join(', ') || 'none'}`,
    )
  }

  return matchedAgent
}

/**
 * Result from handling a tool call, includes output and any credits used
 */
type ToolCallResult = {
  output: ToolResultOutput[]
  /** Credits used by this tool call (e.g., from spawned subagents) */
  creditsUsed: number
}

/**
 * Context for handling tool calls, includes subagent execution capability
 */
type ToolCallContext = {
  toolName: string
  input: any
  overrides: NonNullable<ConvexClientOptions['overrideTools']>
  customToolDefinitions: Record<string, CustomToolDefinition>
  projectFiles?: Record<string, string>
  // Subagent spawning context
  parentAgentId: string
  parentAgentDefinition?: AgentDefinition
  agentDefinitions: AgentDefinition[]
  apiKey: string
  runId: string
  maxAgentSteps: number
  currentDepth: number
  handleStreamChunk?: ConvexClientOptions['handleStreamChunk']
  handleEvent?: ConvexClientOptions['handleEvent']
  logger?: Logger
  signal?: AbortSignal
  /**
   * Current message history of the parent agent.
   * Used to pass context to subagents when includeMessageHistory is true.
   */
  parentMessageHistory?: Message[]
}

/**
 * Handle a tool call in Convex environment.
 * Returns both the tool output and any credits used (e.g., from subagents).
 */
async function handleToolCall(
  context: ToolCallContext,
): Promise<ToolCallResult> {
  const {
    toolName,
    input,
    overrides,
    customToolDefinitions,
    projectFiles,
  } = context

  // Check for custom tool handler
  const customToolHandler = customToolDefinitions[toolName]
  if (customToolHandler) {
    return { output: await customToolHandler.execute(input), creditsUsed: 0 }
  }

  // Check for override
  let override = (overrides as any)[toolName]
  if (!override && toolName === 'str_replace') {
    override = (overrides as any)['write_file']
  }

  if (override) {
    return { output: await override(input), creditsUsed: 0 }
  }

  // Handle built-in tools
  switch (toolName) {
    case 'end_turn':
      return { output: [{ type: 'json', value: { message: 'Turn ended.' } }], creditsUsed: 0 }

    case 'read_files': {
      const files = await readFiles({
        filePaths: input.paths || input.filePaths || [],
        override: overrides.read_files,
        projectFiles,
      })
      return { output: [{ type: 'json', value: files }], creditsUsed: 0 }
    }

    case 'read_subtree': {
      // read_subtree helps agents explore project structure when token scoring is unavailable
      const result = readSubtree({
        paths: input.paths || [],
        projectFiles: projectFiles ?? {},
        maxFiles: input.maxFiles ?? 20,
      })
      return { output: [{ type: 'json', value: result }], creditsUsed: 0 }
    }

    case 'spawn_agents': {
      return await handleSpawnAgents(context)
    }

    case 'write_file':
    case 'str_replace':
      throw new ConvexUnsupportedToolError(
        toolName,
        'File system write operations require an override in Convex',
      )

    case 'run_terminal_command':
      throw new ConvexUnsupportedToolError(
        'run_terminal_command',
        'child_process is not available in Convex runtime',
      )

    case 'code_search':
      throw new ConvexUnsupportedToolError(
        'code_search',
        'ripgrep/code search requires file system and process spawning',
      )

    case 'list_directory':
      throw new ConvexUnsupportedToolError(
        'list_directory',
        'File system access is not available in Convex',
      )

    case 'glob':
      throw new ConvexUnsupportedToolError(
        'glob',
        'File system access is not available in Convex',
      )

    case 'run_file_change_hooks':
      return {
        output: [{
          type: 'json',
          value: { message: 'File change hooks are not supported in Convex mode' },
        }],
        creditsUsed: 0,
      }

    default:
      throw new Error(
        `Tool not implemented in Convex SDK: ${toolName}. ` +
          `Please provide an override or modify your agent to not use this tool.`,
      )
  }
}

/**
 * Handle the spawn_agents tool call.
 * Spawns multiple subagents in parallel and returns their results.
 * Aggregates credits from all subagent runs.
 */
async function handleSpawnAgents(
  context: ToolCallContext,
): Promise<ToolCallResult> {
  const {
    input,
    parentAgentId,
    parentAgentDefinition,
    agentDefinitions,
    apiKey,
    runId,
    maxAgentSteps,
    currentDepth,
    projectFiles,
    overrides,
    customToolDefinitions,
    handleStreamChunk,
    handleEvent,
    logger,
    signal,
  } = context

  const agents = input.agents as Array<{
    agent_type: string
    prompt?: string
    params?: Record<string, unknown>
  }>

  if (!Array.isArray(agents)) {
    throw new Error('spawn_agents requires an "agents" array parameter')
  }

  // Check depth limit
  if (currentDepth >= MAX_SUBAGENT_DEPTH) {
    return {
      output: [{
        type: 'json',
        value: {
          errorMessage: `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) exceeded. Cannot spawn more subagents.`,
        },
      }],
      creditsUsed: 0,
    }
  }

  const parentSpawnableAgents = parentAgentDefinition?.spawnableAgents ?? []

  // Spawn all agents in parallel
  const results = await Promise.allSettled(
    agents.map(async ({ agent_type: agentTypeStr, prompt, params: spawnParams }) => {
      // Validate spawn permission
      const validatedAgentType = validateSpawnPermission(
        parentAgentId,
        parentSpawnableAgents,
        agentTypeStr,
      )

      // Find the agent definition
      const childAgentDef = agentDefinitions.find(
        (a) => a.id === agentTypeStr || a.id === validatedAgentType,
      )

      if (!childAgentDef) {
        throw new Error(
          `Agent definition for "${agentTypeStr}" not found. ` +
          `Make sure to include it in the agentDefinitions option.`,
        )
      }

      const childAgentId = generateCompactId()

      // Notify about subagent start
      if (handleStreamChunk) {
        await handleStreamChunk({
          type: 'subagent_start',
          agentId: childAgentId,
          agentType: childAgentDef.id,
          parentAgentId,
          prompt,
        })
      }

      // Build inherited message history for subagent if includeMessageHistory is true
      let inheritedMessageHistory: Message[] | undefined
      if (childAgentDef.includeMessageHistory) {
        // Get parent's current message history from context
        // We need to filter out unfinished tool calls to prevent API errors
        inheritedMessageHistory = filterUnfinishedToolCalls(
          context.parentMessageHistory ?? [],
        )
        // Add a spawn notification message
        inheritedMessageHistory.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: withSystemTags(`Subagent ${childAgentDef.id} has been spawned.`),
            },
          ],
          tags: ['SUBAGENT_SPAWN'],
        } as UserMessage)
      }

      // Execute the subagent
      const result = await executeAgentLoop({
        apiKey,
        runId,
        agentId: childAgentId,
        agentDefinition: childAgentDef,
        agentDefinitions,
        projectFiles: projectFiles ?? {},
        maxAgentSteps: Math.min(maxAgentSteps, MAX_AGENT_STEPS_DEFAULT),
        prompt: prompt ?? '',
        params: spawnParams,
        currentDepth: currentDepth + 1,
        overrideTools: overrides,
        customToolDefinitions,
        inheritedMessageHistory,
        handleStreamChunk: handleStreamChunk
          ? async (chunk) => {
              // Forward chunks with subagent metadata
              if (typeof chunk === 'string') {
                await handleStreamChunk({
                  type: 'subagent_chunk',
                  agentId: childAgentId,
                  agentType: childAgentDef.id,
                  chunk,
                })
              } else {
                await handleStreamChunk(chunk)
              }
            }
          : undefined,
        handleEvent,
        logger,
        signal,
      })

      // Notify about subagent finish
      if (handleStreamChunk) {
        await handleStreamChunk({
          type: 'subagent_finish',
          agentId: childAgentId,
          agentType: childAgentDef.id,
          parentAgentId,
        })
      }

      return {
        agentType: childAgentDef.id,
        agentName: childAgentDef.displayName ?? childAgentDef.id,
        output: result.output,
        creditsUsed: result.creditsUsed,
      }
    }),
  )

  // Aggregate credits from all successful subagent runs
  let totalSubagentCredits = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      totalSubagentCredits += result.value.creditsUsed
    }
    // Failed subagents contribute 0 credits
  }

  // Format results
  const reports = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      const { agentType, agentName, output, creditsUsed } = result.value
      return {
        agentName,
        agentType,
        value: output,
        creditsUsed, // Include per-subagent credits in the report
      }
    } else {
      const agentTypeStr = agents[index].agent_type
      return {
        agentType: agentTypeStr,
        agentName: agentTypeStr,
        value: { errorMessage: `Error spawning agent: ${result.reason}` },
        creditsUsed: 0,
      }
    }
  })

  return {
    output: [{ type: 'json', value: reports }],
    creditsUsed: totalSubagentCredits,
  }
}

// ============================================================================
// Agent Execution Loop
// ============================================================================

type ExecuteAgentLoopOptions = {
  apiKey: string
  runId: string
  agentId: string
  agentDefinition: AgentDefinition
  agentDefinitions: AgentDefinition[]
  projectFiles: Record<string, string>
  maxAgentSteps: number
  prompt: string
  params?: Record<string, unknown>
  currentDepth: number
  overrideTools?: ConvexClientOptions['overrideTools']
  customToolDefinitions?: Record<string, CustomToolDefinition>
  handleStreamChunk?: ConvexClientOptions['handleStreamChunk']
  handleEvent?: ConvexClientOptions['handleEvent']
  logger?: Logger
  signal?: AbortSignal
  /**
   * Message history inherited from the parent agent.
   * Only provided when the agent's includeMessageHistory option is true.
   */
  inheritedMessageHistory?: Message[]
}

export type ExecuteAgentLoopResult = {
  response: string
  output: any
  /** Total credits used (direct + subagent) */
  creditsUsed: number
  /** Credits used directly by this agent's LLM calls */
  directCreditsUsed: number
  /** Credits used by spawned subagents */
  subagentCreditsUsed: number
  messages: Message[]
}

/**
 * Executes an agent loop (used for both main runs and subagent runs).
 * This is the core execution engine for the Convex runtime.
 */
async function executeAgentLoop(
  options: ExecuteAgentLoopOptions,
): Promise<ExecuteAgentLoopResult> {
  const {
    apiKey,
    runId,
    agentId,
    agentDefinition,
    agentDefinitions,
    projectFiles,
    maxAgentSteps,
    prompt,
    params,
    currentDepth,
    overrideTools = {},
    customToolDefinitions = {},
    handleStreamChunk,
    handleEvent,
    logger,
    signal,
    inheritedMessageHistory,
  } = options

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agentDefinition, projectFiles)
  const tools = buildToolsForApi(agentDefinition, Object.values(customToolDefinitions))
  const model = agentDefinition.model || 'anthropic/claude-sonnet-4'

  // Initialize messages with inherited history if provided
  const messages: Message[] = inheritedMessageHistory ? [...inheritedMessageHistory] : []

  // Add user message
  if (prompt || params) {
    messages.push(
      userMessage(buildUserMessageContent(prompt, params, undefined)),
    )
  }

  let totalSteps = 0
  let directCreditsUsed = 0
  let subagentCreditsUsed = 0
  let fullResponse = ''

  // Agent loop
  while (totalSteps < maxAgentSteps) {
    if (signal?.aborted) {
      break
    }

    totalSteps++
    const openaiMessages = convertToOpenAIMessages(messages, systemPrompt)

    let stepResponse = ''
    const toolCalls: { id: string; name: string; arguments: string }[] = []

    // Stream the response
    for await (const chunk of streamChatCompletion(
      apiKey,
      runId,
      model,
      openaiMessages,
      tools,
      signal,
    )) {
      if (chunk.type === 'text' && chunk.content) {
        stepResponse += chunk.content
        fullResponse += chunk.content
        if (handleStreamChunk) {
          await handleStreamChunk(chunk.content)
        }
      } else if (chunk.type === 'tool_call' && chunk.toolCall) {
        toolCalls.push(chunk.toolCall)
      } else if (chunk.type === 'done') {
        break
      }
    }

    // Add assistant message to history
    if (stepResponse || toolCalls.length > 0) {
      const assistantContent: any[] = []
      if (stepResponse) {
        assistantContent.push({ type: 'text', text: stepResponse })
      }
      for (const tc of toolCalls) {
        assistantContent.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.name,
          input: JSON.parse(tc.arguments || '{}'),
        })
      }
      messages.push({
        role: 'assistant',
        content: assistantContent,
        sentAt: Date.now(),
      } as AssistantMessage)
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      break
    }

    // Check for end_turn
    const hasEndTurn = toolCalls.some(
      (tc) => tc.name === 'end_turn' || tc.name === 'task_completed',
    )

    // Handle tool calls
    for (const tc of toolCalls) {
      if (tc.name === 'end_turn' || tc.name === 'task_completed') {
        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: 'json', value: { message: 'Turn ended.' } }],
        } as ToolMessage)
        continue
      }

      try {
        const input = JSON.parse(tc.arguments || '{}')
        const toolResult = await handleToolCall({
          toolName: tc.name,
          input,
          overrides: overrideTools,
          customToolDefinitions,
          projectFiles,
          // Subagent context
          parentAgentId: agentId,
          parentAgentDefinition: agentDefinition,
          agentDefinitions,
          apiKey,
          runId,
          maxAgentSteps,
          currentDepth,
          handleStreamChunk,
          handleEvent,
          logger,
          signal,
          // Pass current message history for subagents that need it
          parentMessageHistory: messages,
        })

        // Aggregate credits from tool calls (e.g., spawn_agents)
        subagentCreditsUsed += toolResult.creditsUsed

        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          content: toolResult.output,
        } as ToolMessage)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: 'json', value: { errorMessage } }],
        } as ToolMessage)
      }
    }

    if (hasEndTurn) {
      break
    }
  }

  const totalCreditsUsed = directCreditsUsed + subagentCreditsUsed

  return {
    response: fullResponse,
    output: fullResponse || 'Agent completed.',
    creditsUsed: totalCreditsUsed,
    directCreditsUsed,
    subagentCreditsUsed,
    messages,
  }
}

// ============================================================================
// Main Run Function
// ============================================================================

type ConvexRunExecutionOptions = ConvexRunOptions &
  ConvexClientOptions & {
    fingerprintId: string
  }

/**
 * Build a system prompt for Convex agents.
 *
 * Note: In Convex, token scoring (parsed symbol analysis) is unavailable because
 * web-tree-sitter requires WASM which isn't supported in Convex's runtime.
 * To compensate, we provide:
 * 1. A hierarchical file tree visualization in the system prompt
 * 2. A read_subtree tool for exploring directory structure
 */
export function buildSystemPrompt(
  agentDefinition: AgentDefinition | undefined,
  projectFiles: Record<string, string>,
): string {
  const parts: string[] = []

  // Add agent's system prompt if defined
  if (agentDefinition?.systemPrompt) {
    parts.push(agentDefinition.systemPrompt)
  } else {
    parts.push(
      'You are a helpful AI assistant. Answer the user\'s questions accurately and helpfully.',
    )
  }

  // Add file context with hierarchical tree structure
  const fileList = Object.keys(projectFiles)
  if (fileList.length > 0) {
    const fileTree = generateFileTreeString(projectFiles)
    parts.push(
      `# Project Files\n\n` +
      `The following ${fileList.length} file(s) are available in this project:\n\n` +
      '```\n' + fileTree + '\n```\n\n' +
      `Use the \`read_files\` tool to read file contents. ` +
      `Use the \`read_subtree\` tool to explore a directory and see its files.`
    )
  } else {
    parts.push(
      `# Project Files\n\n` +
      `No project files were provided. If you need to work with files, ` +
      `ask the user to provide the relevant code.`
    )
  }

  // Add spawnable agents info if any
  if (agentDefinition?.spawnableAgents && agentDefinition.spawnableAgents.length > 0) {
    parts.push(
      `# Spawnable Agents\n\n` +
      `You can spawn the following agents using the spawn_agents tool:\n` +
      agentDefinition.spawnableAgents.map((a) => `- ${a}`).join('\n'),
    )
  }

  return parts.join('\n\n')
}

/**
 * Build tools array for the API.
 *
 * In Convex, we include read_subtree by default to help agents navigate
 * project structure since token scoring is unavailable.
 */
export function buildToolsForApi(
  agentDefinition: AgentDefinition | undefined,
  customToolDefinitions: CustomToolDefinition[],
): any[] | undefined {
  const tools: any[] = []

  // Add read_files tool
  tools.push({
    type: 'function',
    function: {
      name: 'read_files',
      description: 'Read the contents of one or more files',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths to read',
          },
        },
        required: ['paths'],
      },
    },
  })

  // Add read_subtree tool - helps agents explore project structure
  // This is especially useful in Convex where token scoring is unavailable
  tools.push({
    type: 'function',
    function: {
      name: 'read_subtree',
      description:
        'Explore a directory subtree to see its file structure and contents. ' +
        'Useful for understanding project organization before reading specific files.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of directory or file paths to explore. ' +
              'Each path will match files that start with that prefix.',
          },
          maxFiles: {
            type: 'number',
            description:
              'Maximum number of files to return (default: 20). ' +
              'Use a smaller number for large directories.',
          },
        },
        required: ['paths'],
      },
    },
  })

  // Add end_turn tool
  tools.push({
    type: 'function',
    function: {
      name: 'end_turn',
      description: 'End your turn when you have completed the task',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  })

  // Add spawn_agents tool if agent has spawnableAgents
  if (agentDefinition?.spawnableAgents && agentDefinition.spawnableAgents.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'spawn_agents',
        description: 'Spawn one or more sub-agents to help complete the task. Agents run in parallel.',
        parameters: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              description: 'Array of agents to spawn',
              items: {
                type: 'object',
                properties: {
                  agent_type: {
                    type: 'string',
                    description: 'The type/ID of the agent to spawn',
                  },
                  prompt: {
                    type: 'string',
                    description: 'The prompt to send to the agent',
                  },
                  params: {
                    type: 'object',
                    description: 'Optional parameters to pass to the agent',
                  },
                },
                required: ['agent_type'],
              },
            },
          },
          required: ['agents'],
        },
      },
    })
  }

  // Add custom tools
  for (const tool of customToolDefinitions) {
    tools.push({
      type: 'function',
      function: {
        name: tool.toolName,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })
  }

  return tools.length > 0 ? tools : undefined
}

/**
 * Run an agent in Convex-compatible mode.
 */
export async function run(
  options: ConvexRunExecutionOptions,
): Promise<ConvexRunState> {
  const {
    apiKey,
    fingerprintId,
    projectFiles = {},
    knowledgeFiles,
    agentDefinitions = [],
    maxAgentSteps = MAX_AGENT_STEPS_DEFAULT,
    handleEvent,
    handleStreamChunk,
    overrideTools = {},
    customToolDefinitions = [],
    logger,
    agent,
    prompt,
    content,
    params,
    previousRun,
    extraToolResults,
    signal,
  } = options

  if (signal?.aborted) {
    return {
      sessionState: previousRun?.sessionState,
      output: {
        type: 'error',
        message: createAbortError(signal).message,
      },
    }
  }

  // Get agent definition
  let agentDefinition: AgentDefinition | undefined
  let agentId: string

  if (typeof agent !== 'string') {
    agentDefinition = agent
    agentId = agent.id
  } else {
    agentId = agent
    agentDefinition = agentDefinitions.find((a) => a.id === agent)
  }

  // Initialize or restore session state
  let sessionState: SessionState
  if (previousRun?.sessionState) {
    sessionState = await convexApplyOverridesToSessionState(
      undefined,
      previousRun.sessionState,
      {
        knowledgeFiles,
        agentDefinitions,
        customToolDefinitions,
        projectFiles,
        maxAgentSteps,
      },
    )
  } else {
    sessionState = await convexInitialSessionState({
      cwd: undefined,
      knowledgeFiles,
      agentDefinitions,
      customToolDefinitions,
      projectFiles,
      maxAgentSteps,
      fs: createConvexStubFs(),
      spawn: createConvexStubSpawn(),
      logger,
    })
  }

  // Verify API key
  const userInfo = await getUserInfoFromApiKey(apiKey, ['id'], logger)
  if (!userInfo) {
    return {
      sessionState,
      output: {
        type: 'error',
        message: 'Authentication failed: Invalid API key or user not found',
      },
    }
  }

  // Start agent run
  const runId = await startAgentRun(
    apiKey,
    agentId,
    sessionState.mainAgentState.ancestorRunIds,
    logger,
  )
  if (!runId) {
    return {
      sessionState,
      output: {
        type: 'error',
        message: 'Failed to start agent run',
      },
    }
  }

  sessionState.mainAgentState.runId = runId

  // Build initial messages from session state
  const initialMessages: Message[] = [...sessionState.mainAgentState.messageHistory]

  // Add extra tool results if provided
  if (extraToolResults && extraToolResults.length > 0) {
    initialMessages.push(...extraToolResults)
  }

  // Custom tool definitions as a map
  const customToolDefsMap: Record<string, CustomToolDefinition> =
    Object.fromEntries(customToolDefinitions.map((d) => [d.toolName, d]))

  // Build user prompt
  const preparedContent = wrapContentForUserMessage(content)
  const userPrompt = prompt || ''

  // Add the initial user message if we have content
  if (userPrompt || preparedContent) {
    initialMessages.push(
      userMessage(buildUserMessageContent(userPrompt, params, preparedContent)),
    )
  }

  const mainAgentId = generateCompactId()

  try {
    // Send start event
    if (handleEvent) {
      await handleEvent({
        type: 'start',
        agentId: mainAgentId,
        model: agentDefinition?.model || 'anthropic/claude-sonnet-4',
        messageHistoryLength: initialMessages.length,
      })
    }

    // Create a default agent definition if none provided
    const effectiveAgentDef: AgentDefinition = agentDefinition ?? {
      id: agentId,
      displayName: agentId,
      systemPrompt: 'You are a helpful AI assistant.',
      toolNames: ['read_files', 'end_turn'],
      model: 'anthropic/claude-sonnet-4',
    }

    // Execute the agent loop
    const result = await executeAgentLoop({
      apiKey,
      runId,
      agentId: mainAgentId,
      agentDefinition: effectiveAgentDef,
      agentDefinitions,
      projectFiles,
      maxAgentSteps,
      prompt: '', // Already added to initial messages
      params: undefined,
      currentDepth: 0,
      overrideTools,
      customToolDefinitions: customToolDefsMap,
      handleStreamChunk,
      handleEvent,
      logger,
      signal,
    })

    // Update session state with the result messages
    sessionState.mainAgentState.messageHistory = result.messages.length > 0 
      ? result.messages 
      : initialMessages
    sessionState.mainAgentState.creditsUsed = result.creditsUsed
    sessionState.mainAgentState.directCreditsUsed = result.directCreditsUsed

    // Finish agent run with proper credit breakdown
    await finishAgentRun(
      apiKey,
      runId,
      'completed',
      Math.ceil(result.messages.length / 2), // Approximate steps
      result.directCreditsUsed, // Direct credits (this agent's LLM calls)
      result.creditsUsed, // Total credits (including subagents)
      logger,
    )

    // Send finish event
    if (handleEvent) {
      await handleEvent({
        type: 'finish',
        agentId: mainAgentId,
        totalCost: result.creditsUsed,
      })
    }

    return {
      sessionState,
      output: {
        type: 'lastMessage' as const,
        value: [{ role: 'assistant', content: result.response || 'Agent completed.' }],
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const statusCode = getErrorStatusCode(error)

    // Finish agent run with error
    await finishAgentRun(
      apiKey,
      runId,
      'failed',
      0,
      0,
      0,
      logger,
    )

    if (handleEvent) {
      await handleEvent({ type: 'error', message: errorMessage })
    }

    return {
      sessionState,
      output: {
        type: 'error',
        message: errorMessage,
        ...(statusCode !== undefined && { statusCode }),
      },
    }
  }
}

// ============================================================================
// ConvexCodebuffClient Class
// ============================================================================

/**
 * Convex-compatible Codebuff client.
 *
 * This client is designed to work within Convex's sandboxed Node.js runtime.
 * It doesn't require file system or child_process access.
 */
export class ConvexCodebuffClient {
  public options: ConvexClientOptions & {
    fingerprintId: string
  }

  constructor(options: ConvexClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'Codebuff API key is required. Please provide an apiKey in the constructor of ConvexCodebuffClient.',
      )
    }

    this.options = {
      handleEvent: (event) => {
        if (event.type === 'error') {
          throw new Error(
            `Received error: ${event.message}.\n\nProvide a handleEvent function to handle this error.`,
          )
        }
      },
      fingerprintId: `codebuff-convex-sdk-${Math.random().toString(36).substring(2, 15)}`,
      ...options,
    }
  }

  /**
   * Run a Codebuff agent with the specified options.
   *
   * Note: In Convex mode, tools that require file system or process spawning
   * will throw ConvexUnsupportedToolError unless you provide overrides.
   */
  public async run(
    options: ConvexRunOptions & Partial<ConvexClientOptions>,
  ): Promise<ConvexRunState> {
    return run({ ...this.options, ...options })
  }

  /**
   * Check connection to the Codebuff backend.
   */
  public async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${WEBSITE_URL}/api/healthz`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) return false

      const result = await response.json()
      return (
        typeof result === 'object' &&
        result !== null &&
        'status' in result &&
        (result as { status?: unknown }).status === 'ok'
      )
    } catch {
      return false
    }
  }
}

// Re-export buildUserMessageContent for backward compatibility
export { buildUserMessageContent }
