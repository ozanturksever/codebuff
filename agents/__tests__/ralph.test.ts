import { describe, test, expect, beforeEach } from 'bun:test'

import ralph from '../ralph/ralph'

interface MockLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

interface MockAgentState {
  messageHistory: unknown[]
  contextTokenCount: number
}

const createMockPRD = (stories: Array<{ id: string; title: string; passes: boolean; priority?: number }>) => {
  return JSON.stringify({
    project: 'Test Project',
    branchName: 'feature/test',
    description: 'Test PRD',
    userStories: stories.map((s, i) => ({
      id: s.id,
      title: s.title,
      description: `Description for ${s.id}`,
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      priority: s.priority ?? i + 1,
      passes: s.passes,
      notes: '',
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe('ralph handleSteps', () => {
  let mockAgentState: MockAgentState
  let mockLogger: MockLogger
  let logMessages: string[]

  beforeEach(() => {
    mockAgentState = {
      messageHistory: [],
      contextTokenCount: 0,
    }
    logMessages = []
    mockLogger = {
      debug: () => {},
      info: (...args: unknown[]) => {
        if (typeof args[0] === 'string') logMessages.push(args[0])
      },
      warn: () => {},
      error: () => {},
    }
  })

  const runHandleSteps = (
    params: Record<string, unknown>,
    prompt?: string,
    toolResults?: Map<string, unknown>,
  ) => {
    const generator = ralph.handleSteps!({
      agentState: mockAgentState as any,
      logger: mockLogger as any,
      params,
      prompt,
    })

    const yields: unknown[] = []
    let result = generator.next()

    while (!result.done) {
      const value = result.value
      yields.push(value)

      // Simulate tool results for generator continuation
      if (typeof value === 'object' && value !== null && 'toolName' in value) {
        const toolName = (value as { toolName: string }).toolName

        let toolResult: unknown[] | undefined

        if (toolName === 'read_files' && toolResults?.has('read_files')) {
          toolResult = [toolResults.get('read_files')]
        } else if (toolName === 'run_terminal_command') {
          toolResult = [{ stdout: '', exitCode: 0 }]
        } else if (toolName === 'spawn_agents') {
          toolResult = [{ success: true }]
        } else if (toolName === 'set_output') {
          toolResult = [{ success: true }]
        }

        result = generator.next({ toolResult, agentState: mockAgentState, stepsComplete: false })
      } else {
        // For STEP, STEP_ALL, or StepText, just continue
        result = generator.next({ toolResult: undefined, agentState: mockAgentState, stepsComplete: false })
      }
    }

    return yields
  }

  describe('parallel mode', () => {
    test('returns set_output error when PRD is not found', () => {
      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'nonexistent' },
        undefined,
        new Map([['read_files', { error: 'File not found' }]]),
      )

      // Should have read_files call first
      expect(yields[0]).toEqual(
        expect.objectContaining({
          toolName: 'read_files',
          input: { paths: ['prd/nonexistent.json'] },
        }),
      )

      // Should have set_output with error message
      const setOutputCall = yields.find(
        (y) => typeof y === 'object' && y !== null && (y as any).toolName === 'set_output',
      )
      expect(setOutputCall).toBeDefined()
      expect((setOutputCall as any).input.message).toContain('PRD not found')
    })

    test('returns set_output when all stories are complete', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: true },
        { id: 'US-002', title: 'Story 2', passes: true },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd' },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      const setOutputCall = yields.find(
        (y) => typeof y === 'object' && y !== null && (y as any).toolName === 'set_output',
      )
      expect(setOutputCall).toBeDefined()
      expect((setOutputCall as any).input.message).toContain('already complete')
    })

    test('creates worktrees and spawns editors for pending stories', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false, priority: 1 },
        { id: 'US-002', title: 'Story 2', passes: false, priority: 2 },
        { id: 'US-003', title: 'Story 3', passes: false, priority: 3 },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'my-feature', parallelism: 2 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should read PRD first
      expect(yields[0]).toEqual(
        expect.objectContaining({
          toolName: 'read_files',
          input: { paths: ['prd/my-feature.json'] },
        }),
      )

      // Should create worktrees directory
      const mkdirCall = yields.find(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('mkdir'),
      )
      expect(mkdirCall).toBeDefined()

      // Should create worktrees for 2 stories (parallelism: 2)
      const worktreeAddCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('git worktree add'),
      )
      expect(worktreeAddCalls.length).toBe(2)

      // Should copy PRD to worktrees
      const cpCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('cp -r prd'),
      )
      expect(cpCalls.length).toBe(2)

      // Should spawn editor agents
      const spawnCall = yields.find(
        (y) => typeof y === 'object' && y !== null && (y as any).toolName === 'spawn_agents',
      )
      expect(spawnCall).toBeDefined()
      expect((spawnCall as any).input.agents).toHaveLength(2)
      expect((spawnCall as any).input.agents[0].agent_type).toBe('editor')
      expect((spawnCall as any).input.agents[1].agent_type).toBe('editor')
    })

    test('respects specific story IDs when provided', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false, priority: 1 },
        { id: 'US-002', title: 'Story 2', passes: false, priority: 2 },
        { id: 'US-003', title: 'Story 3', passes: false, priority: 3 },
      ])

      const yields = runHandleSteps(
        {
          mode: 'parallel',
          prdName: 'test-prd',
          storyIds: ['US-002', 'US-003'],
        },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should create worktrees only for specified stories
      const worktreeAddCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('git worktree add'),
      )
      expect(worktreeAddCalls.length).toBe(2)

      // Check that the commands contain US-002 and US-003
      const commands = worktreeAddCalls.map((c) => (c as any).input.command)
      expect(commands.some((cmd: string) => cmd.includes('us-002'))).toBe(true)
      expect(commands.some((cmd: string) => cmd.includes('us-003'))).toBe(true)
      expect(commands.some((cmd: string) => cmd.includes('us-001'))).toBe(false)
    })

    test('limits parallelism to max 5', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
        { id: 'US-002', title: 'Story 2', passes: false },
        { id: 'US-003', title: 'Story 3', passes: false },
        { id: 'US-004', title: 'Story 4', passes: false },
        { id: 'US-005', title: 'Story 5', passes: false },
        { id: 'US-006', title: 'Story 6', passes: false },
        { id: 'US-007', title: 'Story 7', passes: false },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 10 }, // Request 10 but max is 5
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should only create 5 worktrees (max parallelism)
      const worktreeAddCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('git worktree add'),
      )
      expect(worktreeAddCalls.length).toBe(5)
    })

    test('defaults parallelism to 2', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
        { id: 'US-002', title: 'Story 2', passes: false },
        { id: 'US-003', title: 'Story 3', passes: false },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd' }, // No parallelism specified
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should create 2 worktrees (default parallelism)
      const worktreeAddCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('git worktree add'),
      )
      expect(worktreeAddCalls.length).toBe(2)
    })

    test('sorts pending stories by priority', () => {
      const prdContent = createMockPRD([
        { id: 'US-003', title: 'Story 3', passes: false, priority: 3 },
        { id: 'US-001', title: 'Story 1', passes: false, priority: 1 },
        { id: 'US-002', title: 'Story 2', passes: false, priority: 2 },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 2 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should create worktrees for US-001 and US-002 (lowest priorities)
      const worktreeAddCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('git worktree add'),
      )

      const commands = worktreeAddCalls.map((c) => (c as any).input.command)
      expect(commands[0]).toContain('us-001')
      expect(commands[1]).toContain('us-002')
    })

    test('skips already completed stories', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: true, priority: 1 },
        { id: 'US-002', title: 'Story 2', passes: false, priority: 2 },
        { id: 'US-003', title: 'Story 3', passes: false, priority: 3 },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 2 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should create worktrees only for US-002 and US-003 (pending)
      const worktreeAddCalls = yields.filter(
        (y) =>
          typeof y === 'object' &&
          y !== null &&
          (y as any).toolName === 'run_terminal_command' &&
          (y as any).input?.command?.includes('git worktree add'),
      )

      const commands = worktreeAddCalls.map((c) => (c as any).input.command)
      expect(commands.some((cmd: string) => cmd.includes('us-001'))).toBe(false)
      expect(commands.some((cmd: string) => cmd.includes('us-002'))).toBe(true)
      expect(commands.some((cmd: string) => cmd.includes('us-003'))).toBe(true)
    })

    test('includes story details in editor prompts', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Implement Feature X', passes: false, priority: 1 },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 1 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      const spawnCall = yields.find(
        (y) => typeof y === 'object' && y !== null && (y as any).toolName === 'spawn_agents',
      )
      expect(spawnCall).toBeDefined()

      const editorPrompt = (spawnCall as any).input.agents[0].prompt
      expect(editorPrompt).toContain('US-001')
      expect(editorPrompt).toContain('Implement Feature X')
      expect(editorPrompt).toContain('Criterion 1')
      expect(editorPrompt).toContain('Criterion 2')
      expect(editorPrompt).toContain('feat: US-001 - Implement Feature X')
    })

    test('handles invalid PRD JSON gracefully', () => {
      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd' },
        undefined,
        new Map([['read_files', 'not valid json {{{']]),
      )

      const setOutputCall = yields.find(
        (y) => typeof y === 'object' && y !== null && (y as any).toolName === 'set_output',
      )
      expect(setOutputCall).toBeDefined()
      expect((setOutputCall as any).input.message).toContain('Failed to parse PRD')
    })

    test('includes STEP_TEXT and STEP_ALL for merge phase', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
      ])

      const yields = runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 1 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      // Should have STEP_TEXT for merge prompt
      const stepTextYields = yields.filter(
        (y) => typeof y === 'object' && y !== null && (y as any).type === 'STEP_TEXT',
      )
      expect(stepTextYields.length).toBeGreaterThanOrEqual(1)

      // The merge prompt should mention merging branches
      const mergeStepText = stepTextYields.find((y) => (y as any).text.includes('merge'))
      expect(mergeStepText).toBeDefined()

      // Should have STEP_ALL yields
      const stepAllYields = yields.filter((y) => y === 'STEP_ALL')
      expect(stepAllYields.length).toBeGreaterThan(0)
    })
  })

  describe('non-parallel mode', () => {
    test('returns immediately for default mode (LLM handles naturally)', () => {
      const yields = runHandleSteps({}, 'help me create a PRD')

      // Should return early - no programmatic steps for non-parallel mode
      // This allows the LLM to handle ask_user and other interactive tools naturally
      expect(yields).toEqual([])
    })

    test('returns immediately for run mode without parallel flag', () => {
      const yields = runHandleSteps({ mode: 'run', prdName: 'test-prd' })

      // Should return early for non-parallel mode
      expect(yields).toEqual([])
    })

    test('returns immediately for create mode', () => {
      const yields = runHandleSteps({ mode: 'create' })

      expect(yields).toEqual([])
    })

    test('returns immediately for status mode', () => {
      const yields = runHandleSteps({ mode: 'status', prdName: 'test-prd' })

      expect(yields).toEqual([])
    })

    test('returns immediately when prdName is missing for parallel mode', () => {
      const yields = runHandleSteps({ mode: 'parallel' }) // No prdName

      // Should return early because prdName is required for parallel mode
      expect(yields).toEqual([])
    })
  })

  describe('logging', () => {
    test('logs parallel execution start', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
      ])

      runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 2 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      expect(logMessages.some((m) => m.includes('Starting parallel execution'))).toBe(true)
      expect(logMessages.some((m) => m.includes('test-prd'))).toBe(true)
    })

    test('logs stories being run', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
        { id: 'US-002', title: 'Story 2', passes: false },
      ])

      runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 2 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      expect(logMessages.some((m) => m.includes('US-001') && m.includes('US-002'))).toBe(true)
    })

    test('logs worktree creation', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
      ])

      runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 1 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      expect(logMessages.some((m) => m.includes('Created worktree') && m.includes('US-001'))).toBe(
        true,
      )
    })

    test('logs editor agent spawning', () => {
      const prdContent = createMockPRD([
        { id: 'US-001', title: 'Story 1', passes: false },
        { id: 'US-002', title: 'Story 2', passes: false },
      ])

      runHandleSteps(
        { mode: 'parallel', prdName: 'test-prd', parallelism: 2 },
        undefined,
        new Map([['read_files', prdContent]]),
      )

      expect(logMessages.some((m) => m.includes('Spawning') && m.includes('editor'))).toBe(true)
    })
  })
})

describe('ralph agent definition', () => {
  test('has correct id', () => {
    expect(ralph.id).toBe('ralph')
  })

  test('has displayName', () => {
    expect(ralph.displayName).toBe('Ralph')
  })

  test('has spawner prompt', () => {
    expect(ralph.spawnerPrompt).toBeDefined()
    expect(ralph.spawnerPrompt).toContain('PRD')
    expect(ralph.spawnerPrompt).toContain('parallel')
  })

  test('includes required tools', () => {
    expect(ralph.toolNames).toContain('read_files')
    expect(ralph.toolNames).toContain('write_file')
    expect(ralph.toolNames).toContain('run_terminal_command')
    expect(ralph.toolNames).toContain('spawn_agents')
    expect(ralph.toolNames).toContain('set_output')
  })

  test('includes spawnable agents for parallel work', () => {
    expect(ralph.spawnableAgents).toContain('editor')
    expect(ralph.spawnableAgents).toContain('file-picker')
    expect(ralph.spawnableAgents).toContain('code-reviewer')
  })

  test('has input schema with parallel mode params', () => {
    expect(ralph.inputSchema).toBeDefined()
    expect(ralph.inputSchema?.params?.properties?.mode).toBeDefined()
    expect(ralph.inputSchema?.params?.properties?.prdName).toBeDefined()
    expect(ralph.inputSchema?.params?.properties?.parallelism).toBeDefined()
    expect(ralph.inputSchema?.params?.properties?.storyIds).toBeDefined()
  })

  test('has handleSteps function', () => {
    expect(ralph.handleSteps).toBeDefined()
    expect(typeof ralph.handleSteps).toBe('function')
  })

  test('instructions prompt mentions parallel execution', () => {
    expect(ralph.instructionsPrompt).toContain('Parallel')
    expect(ralph.instructionsPrompt).toContain('worktree')
  })
})
