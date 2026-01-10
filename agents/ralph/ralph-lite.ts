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

  instructionsPrompt: `You are Ralph Lite, a faster PRD-driven autonomous development agent. Use lighter subagents like commander-lite, thinker-lite for speed.

## Core Capabilities

### 1. Creating PRDs
[ same as original ]

[ copy the rest of instructionsPrompt from ralph.ts ]

Prefer lite agents: spawn commander-lite for commands, thinker-lite for thinking, editor for edits but minimize heavy spawns.

[ copy handleSteps same as ralph.ts ]`,

  handleSteps: [ paste the entire handleSteps function from ralph.ts ]
}

export default definition
