import { createInterface } from 'node:readline'

import { CodebuffClient } from '@codebuff/sdk'

import { getAuthTokenDetails } from '../utils/auth'
import { AGENT_MODE_TO_ID } from '../utils/constants'
import { loadAgentDefinitions } from '../utils/local-agent-registry'

import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { AgentMode } from '../utils/constants'

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function writeMessage(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

function sendResponse(id: unknown, result: unknown): void {
  writeMessage({ jsonrpc: '2.0', id, result })
}

function sendError(id: unknown, code: number, message: string): void {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } })
}

function sendNotification(method: string, params: unknown): void {
  writeMessage({ jsonrpc: '2.0', method, params })
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let client: CodebuffClient | null = null
let currentSessionId: string | null = null
let currentAbort: AbortController | null = null
let agentId = 'base'

// ---------------------------------------------------------------------------
// PrintModeEvent → ACP session/update conversion
// ---------------------------------------------------------------------------

function convertAndEmit(event: PrintModeEvent): void {
  if (!currentSessionId) return

  switch (event.type) {
    case 'tool_call':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        },
      })
      break

    case 'tool_result':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: event.toolCallId,
          status: 'completed',
          output: event.output,
        },
      })
      break

    case 'tool_progress':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: event.toolCallId,
          status: 'in_progress',
          output: event.output,
        },
      })
      break

    case 'text':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: event.text },
        },
      })
      break

    case 'start':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '' },
          metadata: { event: 'start', agentId: event.agentId, model: event.model },
        },
      })
      break

    case 'finish':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '' },
          metadata: { event: 'finish', totalCost: event.totalCost },
        },
      })
      break

    case 'error':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `Error: ${event.message}` },
          metadata: { event: 'error' },
        },
      })
      break

    case 'subagent_start':
    case 'subagent_finish':
      sendNotification('session/update', {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '' },
          metadata: {
            event: event.type,
            agentId: event.agentId,
            agentType: event.agentType,
            displayName: event.displayName,
          },
        },
      })
      break

    // reasoning_delta and download handled elsewhere or skipped
    case 'reasoning_delta':
    case 'download':
      break
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleMessage(raw: string, options: { cwd: string }): Promise<void> {
  if (!raw.trim()) return

  let msg: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: any }
  try {
    msg = JSON.parse(raw)
  } catch {
    sendError(null, -32700, 'Parse error')
    return
  }

  const { method, id, params } = msg

  if (typeof method !== 'string') {
    if (id !== undefined) {
      sendError(id, -32600, 'Invalid request: missing method')
    }
    return
  }

  switch (method) {
    case 'initialize': {
      sendResponse(id, {
        protocolVersion: '1.0',
        agentCapabilities: {
          promptCapabilities: { streaming: true },
        },
      })
      break
    }

    case 'session/new': {
      const cwd = params?.cwd ?? options.cwd
      const meta = params?._meta?.['sandboxagent.dev']

      // Resolve agent mode
      if (meta?.mode) {
        const mode = meta.mode.toUpperCase() as AgentMode
        if (mode in AGENT_MODE_TO_ID) {
          agentId = AGENT_MODE_TO_ID[mode]
        }
      }
      if (meta?.agent) {
        agentId = meta.agent
      }

      // Get auth
      const { token: apiKey } = getAuthTokenDetails()
      if (!apiKey) {
        sendError(id, -32000, 'No API key found. Run `codebuff login` first or set CODEBUFF_API_KEY.')
        return
      }

      try {
        client = new CodebuffClient({
          apiKey,
          cwd,
          agentDefinitions: loadAgentDefinitions(),
        })
      } catch (err) {
        sendError(id, -32000, err instanceof Error ? err.message : String(err))
        return
      }

      currentSessionId = 'codebuff_' + Date.now()
      sendResponse(id, { sessionId: currentSessionId })
      break
    }

    case 'session/prompt': {
      if (!client || !currentSessionId) {
        sendError(id, -32000, 'No active session. Call session/new first.')
        return
      }

      // Extract prompt text from content parts array
      const promptParts: Array<{ type: string; text?: string }> = params?.prompt ?? []
      const promptText = promptParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n')

      if (!promptText) {
        sendError(id, -32602, 'Empty prompt')
        return
      }

      currentAbort = new AbortController()

      try {
        const { output } = await client.run({
          agent: agentId,
          prompt: promptText,
          projectFiles: {},
          signal: currentAbort.signal,
          handleStreamChunk: (chunk) => {
            if (typeof chunk === 'string') {
              sendNotification('session/update', {
                sessionId: currentSessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: chunk },
                },
              })
            } else if (chunk.type === 'reasoning_chunk') {
              sendNotification('session/update', {
                sessionId: currentSessionId,
                update: {
                  sessionUpdate: 'agent_thought_chunk',
                  content: { type: 'text', text: chunk.chunk },
                },
              })
            }
          },
          handleEvent: (event: PrintModeEvent) => {
            convertAndEmit(event)
          },
        })

        sendResponse(id, {
          stopReason: output.type === 'error' ? 'error' : 'end_turn',
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`ACP error: ${msg}\n`)
        sendError(id, -32000, msg)
      }

      currentAbort = null
      break
    }

    case 'session/cancel': {
      // Notification — no response
      if (currentAbort) {
        currentAbort.abort()
      }
      break
    }

    default: {
      if (id !== undefined) {
        sendError(id, -32601, 'Method not found: ' + method)
      }
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAcp(options: { cwd: string }): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let pendingRequests = 0
  let stdinClosed = false

  rl.on('line', (line) => {
    pendingRequests++
    handleMessage(line, options).catch((err: unknown) => {
      process.stderr.write(`ACP handler error: ${err}\n`)
    }).finally(() => {
      pendingRequests--
      if (stdinClosed && pendingRequests === 0) {
        process.exit(0)
      }
    })
  })

  rl.on('close', () => {
    stdinClosed = true
    if (pendingRequests === 0) {
      process.exit(0)
    }
    // Otherwise, exit is deferred until all pending requests complete
  })
}
