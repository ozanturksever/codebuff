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
  id: 'ralph',
  publisher,
  displayName: 'Ralph',
  model: 'anthropic/claude-opus-4.5',

  spawnerPrompt: `Ralph is a PRD-driven autonomous development agent. Spawn Ralph when:
- The user wants to break down a feature into user stories
- The user wants to create a Product Requirements Document (PRD)
- The user wants to execute user stories in a structured, test-driven way
- The user mentions "PRD", "user stories", "ralph", or wants autonomous feature development
- The user wants to work through a complex feature systematically
- The user wants to run multiple stories in parallel`,

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
    'thinker',
    'editor',
    'code-reviewer',
    'commander',
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
          enum: ['create', 'run', 'status', 'parallel'],
          description: 'Operation mode: create (new PRD), run (next story), status (show progress), parallel (run multiple stories)',
        },
        prdName: {
          type: 'string',
          description: 'Name of the PRD file (without .json extension)',
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

  instructionsPrompt: `You are Ralph, a PRD-driven autonomous development agent. Your purpose is to help users break down features into well-scoped user stories and execute them systematically using Test-Driven Development (TDD).

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

To run stories in parallel, use the run_terminal_command tool to:
1. Create worktrees: \`git worktree add <path> -b <branch>\`
2. Run codebuff in each worktree to execute the story
3. Merge completed branches: \`git merge <branch>\`
4. Clean up worktrees: \`git worktree remove <path>\`

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

## Example Parallel Workflow

1. User: "Run US-001, US-002, and US-003 in parallel"
2. Ralph creates worktrees for each story
3. Ralph spawns editors to work on each story in parallel
4. Each editor implements and tests its story
5. Ralph merges completed work and updates the PRD
6. Ralph reports which stories passed and which need attention

Be proactive, thorough, and guide the user through the entire feature development process.`,

  handleSteps: function* ({ prompt, params, logger }) {
    const mode = params?.mode as string | undefined
    const prdName = params?.prdName as string | undefined
    const parallelism = Math.min(Math.max((params?.parallelism as number) || 2, 1), 5)
    const storyIds = params?.storyIds as string[] | undefined

    // Only use programmatic handleSteps for explicit parallel mode with structured params
    // For all other modes (create, run, status, etc.), let the LLM handle naturally
    // This avoids issues with STEP_ALL and interactive tools like ask_user
    if (mode !== 'parallel' || !prdName) {
      // Return immediately - no programmatic steps needed
      // The LLM will handle everything based on the instructionsPrompt
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
