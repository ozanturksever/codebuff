import { cyan, dim, magenta, red } from 'picocolors'

import type { PrintModeEvent } from '@codebuff/common/types/print-mode'

/**
 * Format tool input for display in traces.
 * Truncates long strings and JSON objects to reasonable lengths.
 */
export function formatToolInput(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') {
    return input.length > 200 ? input.slice(0, 200) + '...' : input
  }
  try {
    const str = JSON.stringify(input, null, 2)
    return str.length > 300 ? str.slice(0, 300) + '...' : str
  } catch {
    return String(input)
  }
}

/**
 * Format tool output for display in traces.
 * Handles various output formats including arrays with value properties.
 */
export function formatToolOutput(output: unknown): string {
  if (!output) return ''
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0]
    if (first && typeof first === 'object' && 'value' in first) {
      const val = (first as { value: unknown }).value
      if (typeof val === 'string') {
        return val.length > 500 ? val.slice(0, 500) + '...' : val
      }
      try {
        const str = JSON.stringify(val, null, 2)
        return str.length > 500 ? str.slice(0, 500) + '...' : str
      } catch {
        return String(val)
      }
    }
  }
  try {
    const str = JSON.stringify(output, null, 2)
    return str.length > 500 ? str.slice(0, 500) + '...' : str
  } catch {
    return String(output)
  }
}

/** Tools that are hidden from trace output */
export const HIDDEN_TOOLS = ['spawn_agents', 'spawn_agent_inline', 'end_turn', 'suggest_followups', 'set_output']

export interface TraceState {
  currentAgentLabel: string
  toolCalls: Array<{ toolName: string; input: unknown; output?: unknown }>
}

export interface FormattedTrace {
  type: 'line' | 'inline'
  text: string
}

/**
 * Format a PrintModeEvent into a trace string for display.
 * Returns null if the event should not produce trace output.
 */
export function formatTraceEvent(
  event: PrintModeEvent,
  state: TraceState,
): FormattedTrace | null {
  switch (event.type) {
    case 'start':
    case 'download':
    case 'reasoning_delta':
    case 'text':
      // These events are handled elsewhere or not displayed
      return null

    case 'subagent_start': {
      let line = dim(`[${cyan(event.agentType || 'agent')}]`)
      if (event.prompt) {
        const promptPreview = event.prompt.length > 80 ? event.prompt.slice(0, 80) + '...' : event.prompt
        line += dim(` ${promptPreview}`)
      }
      state.currentAgentLabel = event.agentType || ''
      return { type: 'line', text: line }
    }

    case 'subagent_finish':
      if (state.currentAgentLabel === event.agentType) {
        state.currentAgentLabel = ''
      }
      return { type: 'line', text: dim(`[/${event.agentType || 'agent'}]`) }

    case 'tool_call': {
      const toolName = event.toolName
      // Skip hidden/internal tools
      if (HIDDEN_TOOLS.includes(toolName)) {
        return null
      }
      state.toolCalls.push({ toolName, input: event.input })
      let line = dim(`[${magenta(toolName)}]`)
      // Show input preview
      const inputStr = formatToolInput(event.input)
      if (inputStr) {
        const firstLine = inputStr.split('\n')[0]
        const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine
        line += dim(` ${preview}`)
      }
      return { type: 'line', text: line }
    }

    case 'tool_result': {
      // Find the matching tool call and update its output
      const toolCall = state.toolCalls.find(tc => !tc.output)
      if (toolCall) {
        toolCall.output = event.output
      }
      // Show brief result for visibility
      const outputStr = formatToolOutput(event.output)
      if (outputStr && outputStr.length > 0) {
        const lines = outputStr.split('\n').slice(0, 2)
        const preview = lines.join(' ').slice(0, 120)
        if (preview.length > 0) {
          return { type: 'line', text: dim(`  → ${preview}${outputStr.length > 120 ? '...' : ''}`) }
        }
      }
      return null
    }

    case 'tool_progress': {
      const progressStr = event.output
      if (progressStr) {
        return { type: 'line', text: dim(`  ... ${progressStr.slice(0, 100)}`) }
      }
      return null
    }

    case 'error':
      return { type: 'line', text: red(`[ERROR] ${event.message}`) }

    case 'finish':
      if (event.totalCost !== undefined && event.totalCost > 0) {
        // totalCost is in credits (1 credit = $0.001)
        const dollars = event.totalCost * 0.001
        return { type: 'line', text: dim(`[cost: $${dollars.toFixed(4)}]`) }
      }
      return null

    default:
      return null
  }
}

/**
 * Simplify an event for JSON output traces.
 * Returns a simplified object or null if the event should not be included.
 */
export function simplifyEventForJson(
  event: PrintModeEvent,
): { type: string; [key: string]: unknown } | null {
  switch (event.type) {
    case 'tool_call':
      return { type: 'tool_call', toolName: event.toolName, input: event.input }
    case 'tool_result':
      return { type: 'tool_result', toolName: event.toolName }
    case 'subagent_start':
      return { type: 'subagent_start', agentType: event.agentType }
    case 'subagent_finish':
      return { type: 'subagent_finish', agentType: event.agentType }
    case 'error':
      return { type: 'error', message: event.message }
    default:
      return null
  }
}

/**
 * Create a fresh trace state for tracking tool calls and agent labels.
 */
export function createTraceState(): TraceState {
  return {
    currentAgentLabel: '',
    toolCalls: [],
  }
}
