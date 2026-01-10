import { describe, test, expect, beforeEach } from 'bun:test'

import {
  formatToolInput,
  formatToolOutput,
  formatTraceEvent,
  simplifyEventForJson,
  createTraceState,
  HIDDEN_TOOLS,
} from '../non-interactive-traces'

import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { TraceState } from '../non-interactive-traces'

describe('non-interactive-traces', () => {
  describe('formatToolInput', () => {
    test('returns empty string for null/undefined input', () => {
      expect(formatToolInput(null)).toBe('')
      expect(formatToolInput(undefined)).toBe('')
    })

    test('returns string input as-is when short', () => {
      expect(formatToolInput('hello world')).toBe('hello world')
    })

    test('truncates long string input at 200 chars', () => {
      const longString = 'a'.repeat(250)
      const result = formatToolInput(longString)
      expect(result).toBe('a'.repeat(200) + '...')
      expect(result.length).toBe(203) // 200 + '...'
    })

    test('returns exactly 200 chars without truncation', () => {
      const exactString = 'b'.repeat(200)
      expect(formatToolInput(exactString)).toBe(exactString)
    })

    test('formats object input as JSON', () => {
      const input = { key: 'value', num: 42 }
      const result = formatToolInput(input)
      expect(result).toContain('"key": "value"')
      expect(result).toContain('"num": 42')
    })

    test('truncates long JSON at 300 chars', () => {
      const input = { longKey: 'x'.repeat(400) }
      const result = formatToolInput(input)
      expect(result.endsWith('...')).toBe(true)
      expect(result.length).toBe(303) // 300 + '...'
    })

    test('handles array input', () => {
      const input = ['item1', 'item2', 'item3']
      const result = formatToolInput(input)
      expect(result).toContain('"item1"')
      expect(result).toContain('"item2"')
    })

    test('handles nested objects', () => {
      const input = { outer: { inner: { deep: 'value' } } }
      const result = formatToolInput(input)
      expect(result).toContain('"deep": "value"')
    })

    test('handles objects with circular references gracefully', () => {
      const obj: Record<string, unknown> = { name: 'test' }
      obj.self = obj
      // Should not throw, returns String(obj)
      const result = formatToolInput(obj)
      expect(result).toBe('[object Object]')
    })

    test('handles number input', () => {
      expect(formatToolInput(42)).toBe('42')
      expect(formatToolInput(3.14159)).toBe('3.14159')
    })

    test('handles boolean true input', () => {
      expect(formatToolInput(true)).toBe('true')
    })

    test('handles empty object input', () => {
      expect(formatToolInput({})).toBe('{}')
    })
  })

  describe('formatToolOutput', () => {
    test('returns empty string for null/undefined output', () => {
      expect(formatToolOutput(null)).toBe('')
      expect(formatToolOutput(undefined)).toBe('')
    })

    test('handles array with value property (agent output format)', () => {
      const output = [{ value: 'result text' }]
      expect(formatToolOutput(output)).toBe('result text')
    })

    test('truncates long value string at 500 chars', () => {
      const longValue = 'c'.repeat(600)
      const output = [{ value: longValue }]
      const result = formatToolOutput(output)
      expect(result).toBe('c'.repeat(500) + '...')
    })

    test('handles array with object value', () => {
      const output = [{ value: { data: 'test', count: 10 } }]
      const result = formatToolOutput(output)
      expect(result).toContain('"data": "test"')
      expect(result).toContain('"count": 10')
    })

    test('handles plain string output', () => {
      const output = 'simple result'
      const result = formatToolOutput(output)
      expect(result).toBe('"simple result"')
    })

    test('handles plain object output', () => {
      const output = { status: 'success', files: ['a.ts', 'b.ts'] }
      const result = formatToolOutput(output)
      expect(result).toContain('"status": "success"')
      expect(result).toContain('"a.ts"')
    })

    test('truncates long JSON output at 500 chars', () => {
      const output = { longData: 'd'.repeat(600) }
      const result = formatToolOutput(output)
      expect(result.endsWith('...')).toBe(true)
      expect(result.length).toBe(503)
    })

    test('handles empty array', () => {
      expect(formatToolOutput([])).toBe('[]')
    })

    test('handles array without value property', () => {
      const output = [{ name: 'file1' }, { name: 'file2' }]
      const result = formatToolOutput(output)
      expect(result).toContain('"name": "file1"')
    })

    test('handles array with empty first element', () => {
      const output = [null, { value: 'test' }]
      const result = formatToolOutput(output)
      // Falls through to JSON.stringify since first element is null
      expect(result).toContain('null')
    })
  })

  describe('createTraceState', () => {
    test('creates state with empty currentAgentLabel', () => {
      const state = createTraceState()
      expect(state.currentAgentLabel).toBe('')
    })

    test('creates state with empty toolCalls array', () => {
      const state = createTraceState()
      expect(state.toolCalls).toEqual([])
    })
  })

  describe('HIDDEN_TOOLS', () => {
    test('contains expected internal tools', () => {
      expect(HIDDEN_TOOLS).toContain('spawn_agents')
      expect(HIDDEN_TOOLS).toContain('spawn_agent_inline')
      expect(HIDDEN_TOOLS).toContain('end_turn')
      expect(HIDDEN_TOOLS).toContain('suggest_followups')
      expect(HIDDEN_TOOLS).toContain('set_output')
    })

    test('has exactly 5 hidden tools', () => {
      expect(HIDDEN_TOOLS.length).toBe(5)
    })
  })

  describe('formatTraceEvent', () => {
    let state: TraceState

    beforeEach(() => {
      state = createTraceState()
    })

    describe('start event', () => {
      test('returns null for start event without model', () => {
        const event: PrintModeEvent = { type: 'start', messageHistoryLength: 0 }
        expect(formatTraceEvent(event, state)).toBeNull()
      })

      test('formats start event with model', () => {
        const event: PrintModeEvent = {
          type: 'start',
          agentId: 'base',
          model: 'anthropic/claude-sonnet-4.5',
          messageHistoryLength: 0,
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('line')
        expect(result!.text).toContain('base')
        expect(result!.text).toContain('anthropic/claude-sonnet-4.5')
      })

      test('uses "agent" as default when agentId is missing', () => {
        const event: PrintModeEvent = {
          type: 'start',
          model: 'openai/gpt-5.1',
          messageHistoryLength: 0,
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.text).toContain('agent')
        expect(result!.text).toContain('openai/gpt-5.1')
      })
    })

    describe('events that return null', () => {
      test('returns null for download event', () => {
        const event: PrintModeEvent = { type: 'download', version: '1.0.0', status: 'complete' }
        expect(formatTraceEvent(event, state)).toBeNull()
      })

      test('returns null for reasoning_delta event', () => {
        const event: PrintModeEvent = {
          type: 'reasoning_delta',
          text: 'thinking...',
          ancestorRunIds: [],
          runId: 'run-1',
        }
        expect(formatTraceEvent(event, state)).toBeNull()
      })

      test('returns null for text event', () => {
        const event: PrintModeEvent = { type: 'text', text: 'response text' }
        expect(formatTraceEvent(event, state)).toBeNull()
      })
    })

    describe('subagent_start event', () => {
      const baseSubagentStart = {
        type: 'subagent_start' as const,
        agentId: 'agent-1',
        displayName: 'Test Agent',
        onlyChild: false,
      }

      test('formats subagent start with agent type', () => {
        const event: PrintModeEvent = { ...baseSubagentStart, agentType: 'file-picker' }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('line')
        expect(result!.text).toContain('file-picker')
      })

      test('updates currentAgentLabel in state', () => {
        const event: PrintModeEvent = { ...baseSubagentStart, agentType: 'commander' }
        formatTraceEvent(event, state)
        expect(state.currentAgentLabel).toBe('commander')
      })

      test('includes prompt preview when present', () => {
        const event: PrintModeEvent = {
          ...baseSubagentStart,
          agentType: 'thinker',
          prompt: 'Think about this problem',
        }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('Think about this problem')
      })

      test('includes model when present', () => {
        const event: PrintModeEvent = {
          ...baseSubagentStart,
          agentType: 'thinker',
          model: 'anthropic/claude-sonnet-4.5',
        }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('anthropic/claude-sonnet-4.5')
      })

      test('truncates long prompt to 80 chars', () => {
        const longPrompt = 'x'.repeat(100)
        const event: PrintModeEvent = {
          ...baseSubagentStart,
          agentType: 'thinker',
          prompt: longPrompt,
        }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('x'.repeat(80) + '...')
      })

      test('uses "agent" as default when agentType is empty', () => {
        const event: PrintModeEvent = { ...baseSubagentStart, agentType: '' }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('agent')
      })
    })

    describe('subagent_finish event', () => {
      const baseSubagentFinish = {
        type: 'subagent_finish' as const,
        agentId: 'agent-1',
        displayName: 'Test Agent',
        onlyChild: false,
      }

      test('formats subagent finish with agent type', () => {
        const event: PrintModeEvent = { ...baseSubagentFinish, agentType: 'code-searcher' }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('line')
        expect(result!.text).toContain('/code-searcher')
      })

      test('clears currentAgentLabel when matching', () => {
        state.currentAgentLabel = 'editor'
        const event: PrintModeEvent = { ...baseSubagentFinish, agentType: 'editor' }
        formatTraceEvent(event, state)
        expect(state.currentAgentLabel).toBe('')
      })

      test('does not clear currentAgentLabel when not matching', () => {
        state.currentAgentLabel = 'editor'
        const event: PrintModeEvent = { ...baseSubagentFinish, agentType: 'other-agent' }
        formatTraceEvent(event, state)
        expect(state.currentAgentLabel).toBe('editor')
      })
    })

    describe('tool_call event', () => {
      const baseToolCall = {
        type: 'tool_call' as const,
        toolCallId: 'call-1',
      }

      test('formats tool call with tool name', () => {
        const event: PrintModeEvent = {
          ...baseToolCall,
          toolName: 'read_files',
          input: { paths: ['file.ts'] },
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('line')
        expect(result!.text).toContain('read_files')
      })

      test('adds tool call to state.toolCalls', () => {
        const event: PrintModeEvent = {
          ...baseToolCall,
          toolName: 'write_file',
          input: { path: 'test.ts', content: 'code' },
        }
        formatTraceEvent(event, state)
        expect(state.toolCalls.length).toBe(1)
        expect(state.toolCalls[0].toolName).toBe('write_file')
        expect(state.toolCalls[0].input).toEqual({ path: 'test.ts', content: 'code' })
      })

      test('includes input preview for object with path', () => {
        const event: PrintModeEvent = {
          ...baseToolCall,
          toolName: 'str_replace',
          input: { path: 'app.ts', replacements: [] },
        }
        const result = formatTraceEvent(event, state)
        // The result contains the tool name and input preview
        expect(result!.text).toContain('str_replace')
      })

      test.each(HIDDEN_TOOLS)('returns null for hidden tool: %s', (toolName) => {
        const event: PrintModeEvent = {
          ...baseToolCall,
          toolName,
          input: {},
        }
        const result = formatTraceEvent(event, state)
        expect(result).toBeNull()
      })

      test('does not add hidden tools to state.toolCalls', () => {
        const event: PrintModeEvent = {
          ...baseToolCall,
          toolName: 'spawn_agents',
          input: { agents: [] },
        }
        formatTraceEvent(event, state)
        expect(state.toolCalls.length).toBe(0)
      })
    })

    describe('tool_result event', () => {
      const baseToolResult = {
        type: 'tool_result' as const,
        toolCallId: 'call-1',
      }

      test('formats tool result with preview', () => {
        // First add a tool call
        state.toolCalls.push({ toolName: 'read_files', input: {} })
        
        const event: PrintModeEvent = {
          ...baseToolResult,
          toolName: 'read_files',
          output: [{ type: 'json', value: 'file content here' }],
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.text).toContain('→')
        expect(result!.text).toContain('file content here')
      })

      test('updates toolCalls with output', () => {
        state.toolCalls.push({ toolName: 'test_tool', input: {} })
        
        const event: PrintModeEvent = {
          ...baseToolResult,
          toolName: 'test_tool',
          output: [{ type: 'json', value: { success: true } }],
        }
        formatTraceEvent(event, state)
        expect(state.toolCalls[0].output).toEqual([{ type: 'json', value: { success: true } }])
      })

      test('formats empty output array as []', () => {
        const event: PrintModeEvent = {
          ...baseToolResult,
          toolName: 'test',
          output: [],
        }
        const result = formatTraceEvent(event, state)
        // Empty arrays still get formatted as "[]"
        expect(result).not.toBeNull()
        expect(result!.text).toContain('[]')
      })

      test('truncates long output preview to 120 chars', () => {
        state.toolCalls.push({ toolName: 'test', input: {} })
        
        const event: PrintModeEvent = {
          ...baseToolResult,
          toolName: 'test',
          output: [{ type: 'json', value: 'y'.repeat(200) }],
        }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('...')
      })
    })

    describe('tool_progress event', () => {
      const baseToolProgress = {
        type: 'tool_progress' as const,
        toolCallId: 'call-1',
        toolName: 'test',
      }

      test('formats progress with output', () => {
        const event: PrintModeEvent = {
          ...baseToolProgress,
          output: 'Processing files...',
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.text).toContain('...')
        expect(result!.text).toContain('Processing files')
      })

      test('truncates progress to 100 chars', () => {
        const event: PrintModeEvent = {
          ...baseToolProgress,
          output: 'z'.repeat(150),
        }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('z'.repeat(100))
        expect(result!.text).not.toContain('z'.repeat(101))
      })

      test('returns null for empty progress', () => {
        const event: PrintModeEvent = {
          ...baseToolProgress,
          output: '',
        }
        const result = formatTraceEvent(event, state)
        expect(result).toBeNull()
      })
    })

    describe('error event', () => {
      test('formats error with message', () => {
        const event: PrintModeEvent = {
          type: 'error',
          message: 'Something went wrong',
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('line')
        expect(result!.text).toContain('[ERROR]')
        expect(result!.text).toContain('Something went wrong')
      })
    })

    describe('finish event', () => {
      test('formats finish with cost when present', () => {
        const event: PrintModeEvent = {
          type: 'finish',
          totalCost: 100, // 100 credits = $0.10
        }
        const result = formatTraceEvent(event, state)
        expect(result).not.toBeNull()
        expect(result!.text).toContain('cost')
        expect(result!.text).toContain('$0.1000')
      })

      test('returns null when cost is zero', () => {
        const event: PrintModeEvent = {
          type: 'finish',
          totalCost: 0,
        }
        const result = formatTraceEvent(event, state)
        expect(result).toBeNull()
      })

      test('calculates cost correctly (1 credit = $0.001)', () => {
        const event: PrintModeEvent = {
          type: 'finish',
          totalCost: 1500, // 1500 credits = $1.50
        }
        const result = formatTraceEvent(event, state)
        expect(result!.text).toContain('$1.5000')
      })
    })
  })

  describe('simplifyEventForJson', () => {
    test('simplifies tool_call event', () => {
      const event: PrintModeEvent = {
        type: 'tool_call',
        toolCallId: 'call-1',
        toolName: 'read_files',
        input: { paths: ['a.ts'] },
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'tool_call',
        toolName: 'read_files',
        input: { paths: ['a.ts'] },
      })
    })

    test('simplifies tool_result event (excludes output)', () => {
      const event: PrintModeEvent = {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'read_files',
        output: [{ type: 'json', value: 'file content' }],
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'tool_result',
        toolName: 'read_files',
      })
    })

    test('simplifies subagent_start event', () => {
      const event: PrintModeEvent = {
        type: 'subagent_start',
        agentId: 'agent-1',
        agentType: 'thinker',
        displayName: 'Thinker',
        onlyChild: false,
        prompt: 'long prompt here',
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'subagent_start',
        agentType: 'thinker',
        model: undefined,
      })
    })

    test('simplifies subagent_start event with model', () => {
      const event: PrintModeEvent = {
        type: 'subagent_start',
        agentId: 'agent-1',
        agentType: 'thinker',
        displayName: 'Thinker',
        model: 'anthropic/claude-sonnet-4.5',
        onlyChild: false,
        prompt: 'long prompt here',
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'subagent_start',
        agentType: 'thinker',
        model: 'anthropic/claude-sonnet-4.5',
      })
    })

    test('simplifies subagent_finish event', () => {
      const event: PrintModeEvent = {
        type: 'subagent_finish',
        agentId: 'agent-1',
        agentType: 'editor',
        displayName: 'Editor',
        onlyChild: false,
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'subagent_finish',
        agentType: 'editor',
        model: undefined,
      })
    })

    test('simplifies subagent_finish event with model', () => {
      const event: PrintModeEvent = {
        type: 'subagent_finish',
        agentId: 'agent-1',
        agentType: 'editor',
        displayName: 'Editor',
        model: 'openai/gpt-5.1',
        onlyChild: false,
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'subagent_finish',
        agentType: 'editor',
        model: 'openai/gpt-5.1',
      })
    })

    test('simplifies error event', () => {
      const event: PrintModeEvent = {
        type: 'error',
        message: 'An error occurred',
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'error',
        message: 'An error occurred',
      })
    })

    test('returns null for start event without model', () => {
      const event: PrintModeEvent = { type: 'start', messageHistoryLength: 0 }
      expect(simplifyEventForJson(event)).toBeNull()
    })

    test('simplifies start event with model', () => {
      const event: PrintModeEvent = {
        type: 'start',
        agentId: 'base',
        model: 'anthropic/claude-sonnet-4.5',
        messageHistoryLength: 5,
      }
      const result = simplifyEventForJson(event)
      expect(result).toEqual({
        type: 'start',
        agentId: 'base',
        model: 'anthropic/claude-sonnet-4.5',
      })
    })

    test('returns null for text event', () => {
      const event: PrintModeEvent = { type: 'text', text: 'response' }
      expect(simplifyEventForJson(event)).toBeNull()
    })

    test('returns null for finish event', () => {
      const event: PrintModeEvent = { type: 'finish', totalCost: 100 }
      expect(simplifyEventForJson(event)).toBeNull()
    })

    test('returns null for download event', () => {
      const event: PrintModeEvent = { type: 'download', version: '1.0.0', status: 'complete' }
      expect(simplifyEventForJson(event)).toBeNull()
    })
  })

  describe('integration: trace state management', () => {
    test('tracks multiple tool calls with outputs', () => {
      const state = createTraceState()

      // First tool call
      formatTraceEvent(
        { type: 'tool_call', toolCallId: 'call-1', toolName: 'read_files', input: { paths: ['a.ts'] } },
        state,
      )
      expect(state.toolCalls.length).toBe(1)

      // First result
      formatTraceEvent(
        { type: 'tool_result', toolCallId: 'call-1', toolName: 'read_files', output: [{ type: 'json', value: 'content a' }] },
        state,
      )
      expect(state.toolCalls[0].output).toEqual([{ type: 'json', value: 'content a' }])

      // Second tool call
      formatTraceEvent(
        { type: 'tool_call', toolCallId: 'call-2', toolName: 'write_file', input: { path: 'b.ts' } },
        state,
      )
      expect(state.toolCalls.length).toBe(2)

      // Second result
      formatTraceEvent(
        { type: 'tool_result', toolCallId: 'call-2', toolName: 'write_file', output: [{ type: 'json', value: 'success' }] },
        state,
      )
      expect(state.toolCalls[1].output).toEqual([{ type: 'json', value: 'success' }])
    })

    test('tracks nested subagent labels', () => {
      const state = createTraceState()
      const baseSubagent = { agentId: 'agent-1', displayName: 'Agent', onlyChild: false }

      formatTraceEvent({ type: 'subagent_start', ...baseSubagent, agentType: 'outer' }, state)
      expect(state.currentAgentLabel).toBe('outer')

      formatTraceEvent({ type: 'subagent_start', ...baseSubagent, agentId: 'agent-2', agentType: 'inner' }, state)
      expect(state.currentAgentLabel).toBe('inner')

      formatTraceEvent({ type: 'subagent_finish', ...baseSubagent, agentId: 'agent-2', agentType: 'inner' }, state)
      expect(state.currentAgentLabel).toBe('')

      // Outer finish doesn't match current label anymore
      state.currentAgentLabel = 'outer' // simulate state restored
      formatTraceEvent({ type: 'subagent_finish', ...baseSubagent, agentType: 'outer' }, state)
      expect(state.currentAgentLabel).toBe('')
    })
  })
})
