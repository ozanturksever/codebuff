import type { AgentDefinition, ToolCall, StepText } from '../types/agent-definition'
import { publisher } from '../constants'

const PRD_JSON_SCHEMA = `{
  "project": "Project Name",
  "branchName": "feature/branch-name",
  "description": "Brief description of the feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a [user], I want [goal] so that [benefit]",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ],
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}`

const STORY_WORKER_PROMPT = `You are working on a single user story from a PRD. Follow these steps:

1. **Write tests FIRST** - Before implementing any feature code:
   - Write unit tests for the core logic/functions
   - Write e2e/integration tests for the user-facing behavior
   - Tests should initially fail (red phase)

2. **Implement minimal code** - Write just enough code to make tests pass (green phase)

3. **Refactor** - Clean up while keeping tests green

4. **Validation**:
   - All tests must pass
   - Typecheck and lint must pass
   - Commit with message: "feat: <story-id> - <story-title>"

5. **Update PRD**: Mark the story's \`passes\` field as \`true\` in the PRD file

Keep changes focused and minimal. Only implement what's needed for this story.`

const definition: AgentDefinition = {
  id: 'ralph-lite',
  publisher,
  displayName: 'Ralph Lite',
  model: 'x-ai/grok-4.1-fast',

  spawnerPrompt: `Ralph Lite is a lighter, faster version of Ralph for PRD-driven development. Spawn when user wants PRD workflow in lite mode.
- The user says "ralph lite", "lite PRD", or requests faster PRD workflow
- Same capabilities as Ralph but optimized for speed`,

  toolNames: [
    'read_files',
    'write_file',
    'str_replace',
    'run_terminal_command',
    'spawn_agents',
    'ask_user',
    'code_search',
    'find_files',
    'read_subtree',
    'glob',
    'list_directory',
    'suggest_followups',
    'write_todos',
    'set_output',
  ],

  spawnableAgents: [
    'file-picker',
    'code-searcher',
    'thinker-lite',
    'editor',
    'simple-code-reviewer',
    'commander-lite',
    'directory-lister',
    'glob-matcher',
  ],

  inputSchema: {
    prompt: {
      type: 'string',
      description: 'What Ralph should help with - creating a PRD, running a story, or managing PRD workflow',
    },
    params: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['create', 'run', 'status', 'list', 'parallel'],
          description: 'Operation mode: create (new PRD), run (next story), status (show progress), list (show PRDs), parallel (run multiple stories)',
        },
        prdName: {
          type: 'string',
          description: 'Name of the PRD file (without .json extension)',
        },
        featureDescription: {
          type: 'string',
          description: 'Description of the feature for create mode',
        },
        parallelism: {
          type: 'number',
          description: 'Number of stories to run in parallel (default: 2, max: 5)',
        },
        storyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific story IDs to run in parallel (optional, defaults to next N pending stories)',
        },
      },
    },
  },

  instructionsPrompt: `You are Ralph Lite, a faster PRD-driven autonomous development agent. Use lighter subagents like commander-lite, thinker-lite for speed.

## Core Capabilities

### 1. Creating PRDs
When the user wants to build a new feature:
1. Ask 3-5 clarifying questions to understand scope, constraints, and acceptance criteria
2. Use the ask_user tool to gather answers
3. Generate a PRD with well-scoped user stories
4. Save the PRD to \`prd/<feature-name>.json\`

Each user story should:
- Be small enough to complete in one context window (single focused change)
- Have clear acceptance criteria that can be verified
- Be ordered by priority (dependencies first)

PRD JSON structure:
${PRD_JSON_SCHEMA}

### 2. Executing User Stories
When running a story, follow TDD principles strictly:

1. **Write tests FIRST** - Before implementing any feature code:
   - Write unit tests for the core logic/functions
   - Write e2e/integration tests for the user-facing behavior
   - Tests should initially fail (red phase)

2. **Implement minimal code** - Write just enough code to make tests pass (green phase)

3. **Refactor** - Clean up while keeping tests green

#### Testing Guidelines:
- **Prefer real implementations over mocks** - Only use mocks when absolutely necessary
- **Unit tests** for business logic, utilities, and pure functions
- **E2E/Integration tests** for API endpoints, user flows, and feature behavior
- **All acceptance criteria must have corresponding tests**

#### Validation Before Completing:
- All tests must pass before marking the story complete
- Run the full test suite for affected areas
- Typecheck and lint must also pass

### 3. Parallel Story Execution
When the user wants to run stories in parallel:
1. Read the PRD to get pending stories
2. Create git worktrees for isolated execution
3. Spawn multiple editor agents to work on stories simultaneously
4. Each story runs in its own worktree to avoid conflicts
5. Merge completed work back to the main branch

### 4. Story Completion Workflow
After completing a story:
1. Run quality checks (typecheck, lint, test)
2. If all checks pass, commit with message: "feat: <story-id> - <story-title>"
3. Update the PRD file: Mark the story's \`passes\` field as \`true\`
4. Suggest "Continue to next story" as a followup if more stories remain

## PRD Management Commands

Help users with these operations:
- **List PRDs**: Read the \`prd/\` directory to show available PRDs
- **Show Status**: Read a specific PRD and show progress (completed/total stories)
- **Run Next Story**: Find the next incomplete story (lowest priority number where passes=false)
- **Run Parallel**: Execute multiple stories simultaneously using worktrees
- **Edit PRD**: Help modify stories, acceptance criteria, or priorities

## Important Guidelines

1. **Keep changes focused** - Only implement what's needed for the current story
2. **Follow project conventions** - Match the existing code style and patterns
3. **Reuse existing code** - Don't reinvent what already exists in the codebase
4. **Document learnings** - Update knowledge files with important discoveries
5. **Commit frequently** - Each story should result in a focused commit

Prefer lite agents: spawn commander-lite for commands, thinker-lite for thinking, editor for edits but minimize heavy spawns.

Be proactive, thorough, and guide the user through the entire feature development process.`,

  handleSteps: function* ({ prompt, params, logger }) {
    const mode = params?.mode as string | undefined
    const prdName = params?.prdName as string | undefined
    const featureDescription = params?.featureDescription as string | undefined
    const parallelism = Math.min(Math.max((params?.parallelism as number) || 2, 1), 5)
    const storyIds = params?.storyIds as string[] | undefined

    // Handle different modes with programmatic steps
    // This ensures Ralph provides concrete, actionable prompts like oldralph does

    // ========== LIST MODE ==========
    if (mode === 'list') {
      logger.info('Listing PRDs...')
      
      // List the prd directory
      const { toolResult: listResult } = yield {
        toolName: 'list_directory',
        input: { path: 'prd' },
      } as ToolCall<'list_directory'>

      const listPrompt = `List all PRD files in the prd/ directory and show their status.

Directory contents: ${JSON.stringify(listResult)}

For each .json file found:
1. Read the PRD file
2. Count total stories and completed stories (passes=true)
3. Show a formatted list like:
   📋 PRDs
   
   ✅ prd-name - Description (if all complete)
   2/5 prd-name - Description (if incomplete)

If no PRDs found, suggest creating one with /ralph new <name>.`

      yield { type: 'STEP_TEXT', text: listPrompt } as StepText
      yield 'STEP_ALL'
      return
    }

    // ========== STATUS MODE ==========
    if (mode === 'status' && prdName) {
      logger.info(`Getting status for PRD: ${prdName}`)
      
      const { toolResult: prdReadResult } = yield {
        toolName: 'read_files',
        input: { paths: [`prd/${prdName}.json`] },
      } as ToolCall<'read_files'>

      const prdContent = prdReadResult?.[0]
      if (!prdContent || (typeof prdContent === 'object' && 'error' in prdContent)) {
        yield {
          toolName: 'set_output',
          input: { message: `PRD not found: ${prdName}. Use /ralph list to see available PRDs.` },
        } as ToolCall<'set_output'>
        return
      }

      const statusPrompt = `Show the status of PRD "${prdName}".

PRD Content:
${typeof prdContent === 'string' ? prdContent : JSON.stringify(prdContent, null, 2)}

Provide a formatted status report:
1. PRD name and description
2. Progress: X/Y stories complete
3. List all stories with status icons:
   ✅ [priority] story-id: title (if passes=true)
   ○ [priority] story-id: title (if passes=false)
4. Show which story is next (lowest priority with passes=false)
5. Suggest using /ralph run ${prdName} to execute the next story`

      yield { type: 'STEP_TEXT', text: statusPrompt } as StepText
      yield 'STEP_ALL'
      return
    }

    // ========== CREATE MODE ==========
    if (mode === 'create' && prdName) {
      logger.info(`Creating new PRD: ${prdName}`)
      
      const featureContext = featureDescription
        ? `The user wants to build: "${featureDescription}"`
        : `The user wants to create a new PRD named "${prdName}".`

      const createPrompt = `You are helping create a PRD (Product Requirements Document) for autonomous development.

${featureContext}

Your task:
1. Ask 3-5 clarifying questions to understand the scope, constraints, and acceptance criteria
2. Use the ask_user tool to get answers
3. Based on the answers, generate a PRD with well-scoped user stories

Each user story should:
- Be small enough to complete in one context window (single focused change)
- Have clear acceptance criteria that can be verified
- Be ordered by priority (dependencies first)

After gathering requirements, create the PRD file at: prd/${prdName}.json

Use this exact JSON structure:
${PRD_JSON_SCHEMA}

Start by asking clarifying questions about the feature.`

      yield { type: 'STEP_TEXT', text: createPrompt } as StepText
      yield 'STEP_ALL'
      return
    }

    // ========== RUN MODE ==========
    if (mode === 'run' && prdName) {
      logger.info(`Running next story for PRD: ${prdName}`)
      
      // Step 1: Read the PRD file
      const { toolResult: prdReadResult } = yield {
        toolName: 'read_files',
        input: { paths: [`prd/${prdName}.json`] },
      } as ToolCall<'read_files'>

      const prdContent = prdReadResult?.[0]
      if (!prdContent || (typeof prdContent === 'object' && 'error' in prdContent)) {
        yield {
          toolName: 'set_output',
          input: { message: `PRD not found: ${prdName}. Use /ralph list to see available PRDs.` },
        } as ToolCall<'set_output'>
        return
      }

      // Step 2: Parse the PRD
      let prd: { 
        project: string
        description: string
        userStories: Array<{ 
          id: string
          title: string
          description: string
          acceptanceCriteria: string[]
          priority: number
          passes: boolean
          notes?: string
        }> 
      }
      try {
        const content = typeof prdContent === 'string' ? prdContent : JSON.stringify(prdContent)
        prd = JSON.parse(content)
      } catch {
        yield {
          toolName: 'set_output',
          input: { message: `Failed to parse PRD: ${prdName}` },
        } as ToolCall<'set_output'>
        return
      }

      // Step 3: Find next pending story
      const pendingStories = prd.userStories
        .filter(s => !s.passes)
        .sort((a, b) => a.priority - b.priority)

      if (pendingStories.length === 0) {
        yield {
          toolName: 'set_output',
          input: { message: `🎉 All stories in "${prd.project}" are complete!` },
        } as ToolCall<'set_output'>
        return
      }

      const nextStory = pendingStories[0]
      const completedCount = prd.userStories.filter(s => s.passes).length
      const totalCount = prd.userStories.length
      const isLastStory = completedCount + 1 === totalCount

      logger.info(`Running story ${nextStory.id}: ${nextStory.title} (${completedCount + 1}/${totalCount})`)

      // Step 4: Generate detailed execution prompt (like generateStoryExecutionPrompt)
      const storyPrompt = `You are working on PRD: "${prd.project}" (${completedCount}/${totalCount} stories complete)

## Current Story: ${nextStory.id} - ${nextStory.title}

**Description:** ${nextStory.description}

**Acceptance Criteria:**
${nextStory.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${nextStory.notes ? `**Notes:** ${nextStory.notes}` : ''}

## Development Approach: Test-Driven Development (TDD)

Follow TDD principles strictly:

1. **Write tests FIRST** - Before implementing any feature code:
   - Write unit tests for the core logic/functions
   - Write e2e/integration tests for the user-facing behavior
   - Tests should initially fail (red phase)

2. **Implement minimal code** - Write just enough code to make tests pass (green phase)

3. **Refactor** - Clean up while keeping tests green

### Testing Guidelines:

- **Prefer real implementations over mocks** - Only use mocks when absolutely necessary (e.g., external APIs, payment systems)
- **Unit tests** for business logic, utilities, and pure functions
- **E2E/Integration tests** for API endpoints, user flows, and feature behavior
- **All acceptance criteria must have corresponding tests**

### Validation Before Proceeding:

- All tests must pass before marking the story complete
- Run the full test suite for affected areas
- Typecheck and lint must also pass

## Instructions

1. Write failing tests for this story's acceptance criteria
2. Implement the feature to make tests pass
3. Refactor if needed while keeping tests green
4. Run quality checks (typecheck, lint, test)
5. If all checks pass, commit with message: "feat: ${nextStory.id} - ${nextStory.title}"
6. Update any relevant knowledge files with learnings

After completing the story:
- Use str_replace to update the PRD: Mark story ${nextStory.id} as passes: true
- The PRD file is at: prd/${prdName}.json

Keep changes focused and minimal. Only implement what's needed for this story.

${isLastStory 
        ? '\n**This is the last story!** After completing it, suggest followups for next steps the user might want to take.'
        : '\n**Important:** After completing this story successfully, use suggest_followups to suggest "Continue to next story" as the first option so Ralph can automatically proceed to the next story.'}`

      yield { type: 'STEP_TEXT', text: storyPrompt } as StepText
      yield 'STEP_ALL'
      return
    }

    // ========== PARALLEL MODE ==========
    if (mode !== 'parallel' || !prdName) {
      // No recognized mode with required params - let LLM handle based on prompt
      return
    }

    // Parallel mode: orchestrate parallel story execution
    logger.info(`Starting parallel execution for PRD: ${prdName} with parallelism: ${parallelism}`)

    // Step 1: Read the PRD file to get story details
    const { toolResult: prdReadResult } = yield {
      toolName: 'read_files',
      input: { paths: [`prd/${prdName}.json`] },
    } as ToolCall<'read_files'>

    // Check if PRD was found
    const prdContent = prdReadResult?.[0]
    if (!prdContent || (typeof prdContent === 'object' && 'error' in prdContent)) {
      yield {
        toolName: 'set_output',
        input: { message: `PRD not found: ${prdName}. Use /ralph list to see available PRDs.` },
      } as ToolCall<'set_output'>
      return
    }

    // Step 2: Parse the PRD and get stories to run
    let prd: { userStories: Array<{ id: string; title: string; description: string; acceptanceCriteria: string[]; priority: number; passes: boolean }> }
    try {
      const content = typeof prdContent === 'string' ? prdContent : JSON.stringify(prdContent)
      prd = JSON.parse(content)
    } catch {
      yield {
        toolName: 'set_output',
        input: { message: `Failed to parse PRD: ${prdName}` },
      } as ToolCall<'set_output'>
      return
    }

    // Get pending stories
    const pendingStories = prd.userStories
      .filter(s => !s.passes)
      .sort((a, b) => a.priority - b.priority)

    if (pendingStories.length === 0) {
      yield {
        toolName: 'set_output',
        input: { message: `All stories in "${prdName}" are already complete!` },
      } as ToolCall<'set_output'>
      return
    }

    // Select stories to run
    let storiesToRun = pendingStories
    if (storyIds && storyIds.length > 0) {
      storiesToRun = pendingStories.filter(s => 
        storyIds.some(id => id.toLowerCase() === s.id.toLowerCase())
      )
    } else {
      storiesToRun = pendingStories.slice(0, parallelism)
    }

    logger.info(`Running ${storiesToRun.length} stories in parallel: ${storiesToRun.map(s => s.id).join(', ')}`)

    // Step 3: Create worktrees for each story
    const worktreesDir = '../codebuff-worktrees'
    yield {
      toolName: 'run_terminal_command',
      input: { command: `mkdir -p ${worktreesDir}` },
    } as ToolCall<'run_terminal_command'>

    const worktreeInfos: Array<{ story: typeof storiesToRun[0]; path: string; branch: string }> = []

    for (const story of storiesToRun) {
      const storyIdLower = story.id.toLowerCase()
      const worktreePath = `${worktreesDir}/${prdName}-${storyIdLower}`
      const branch = `ralph/${prdName}/${storyIdLower}`

      // Create worktree
      yield {
        toolName: 'run_terminal_command',
        input: { command: `git worktree add ${worktreePath} -b ${branch} HEAD 2>/dev/null || git worktree add ${worktreePath} ${branch}` },
      } as ToolCall<'run_terminal_command'>

      // Copy PRD directory to worktree
      yield {
        toolName: 'run_terminal_command', 
        input: { command: `cp -r prd ${worktreePath}/` },
      } as ToolCall<'run_terminal_command'>

      worktreeInfos.push({ story, path: worktreePath, branch })
      logger.info(`Created worktree for ${story.id} at ${worktreePath}`)
    }

    // Step 4: Spawn editor agents in parallel - one for each story
    const editorAgents = worktreeInfos.map(({ story, path }) => ({
      agent_type: 'editor',
      prompt: `Work in directory: ${path}

Implement story ${story.id}: ${story.title}

**Description:** ${story.description}

**Acceptance Criteria:**
${story.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${STORY_WORKER_PROMPT}

IMPORTANT: 
- Run all commands from the worktree directory: ${path}
- After completing the story, commit with message: "feat: ${story.id} - ${story.title}"
- Update the PRD at ${path}/prd/${prdName}.json to mark ${story.id} as passes: true`,
    }))

    logger.info(`Spawning ${editorAgents.length} editor agents in parallel`)

    // Spawn all editors in parallel
    yield {
      toolName: 'spawn_agents',
      input: { agents: editorAgents },
    } as ToolCall<'spawn_agents'>

    // Step 5: Merge completed work back to main branch
    const mergePrompt = `The parallel story execution is complete. Now merge the completed work:

For each of these branches, check if it has commits and merge if ready:
${worktreeInfos.map(w => `- ${w.branch} (${w.story.id})`).join('\n')}

1. Get the current branch name
2. For each story branch:
   - Check if it has commits: git log main..${worktreeInfos[0]?.branch} --oneline
   - If it has commits, merge it: git merge <branch> --no-edit
   - If there are conflicts, resolve them intelligently
   - After successful merge, update prd/${prdName}.json to mark the story as passes: true
   - Clean up: git worktree remove <path> --force && git branch -D <branch>

3. Provide a summary of results`

    yield { type: 'STEP_TEXT', text: mergePrompt } as StepText
    yield 'STEP_ALL'

    // Final summary
    yield { type: 'STEP_TEXT', text: 'Provide a final summary of the parallel execution: which stories were completed, merged, and any issues encountered. Suggest next steps.' } as StepText
    yield 'STEP'
  },
}

export default definition
