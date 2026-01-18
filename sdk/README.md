# @fatagnus/codebuff

Official SDK for Codebuff - AI coding agent and framework

## Installation

```bash
npm install @fatagnus/codebuff
```

## Prerequisites

- Create a Codebuff account and get your [Codebuff API key here](https://www.codebuff.com/api-keys).

## Usage

### Basic Example

```typescript
import { CodebuffClient } from '@fatagnus/codebuff'

async function main() {
  const client = new CodebuffClient({
    // You need to pass in your own API key here.
    // Get one here: https://www.codebuff.com/api-keys
    apiKey: process.env.CODEBUFF_API_KEY,
    cwd: process.cwd(),
  })

  // First run
  const runState1 = await client.run({
    // The agent id. Any agent on the store (https://codebuff.com/store)
    agent: 'codebuff/base@0.0.16',
    prompt: 'Create a simple calculator class',
    handleEvent: (event) => {
      // All events that happen during the run: agent start/finish, tool calls/results, text responses, errors.
      console.log('Codebuff Event', JSON.stringify(event))
    },
  })

  // Continue the same session with a follow-up
  const runOrError2 = await client.run({
    agent: 'codebuff/base@0.0.16',
    prompt: 'Add unit tests for the calculator',
    previousRun: runState1, // <-- this is where your next run differs from the previous run
    handleEvent: (event) => {
      console.log('Codebuff Event', JSON.stringify(event))
    },
  })
}

main()
```

### Example 2: Custom Agents and Tools

Here, we create a full agent and custom tools that can be reused between runs.

```typescript
import { z } from 'zod/v4'

import { CodebuffClient, getCustomToolDefinition } from '@fatagnus/codebuff'

import type { AgentDefinition } from '@fatagnus/codebuff'

async function main() {
  const client = new CodebuffClient({
    // Note: You need to pass in your own API key.
    // Get it here: https://www.codebuff.com/profile?tab=api-keys
    apiKey: process.env.CODEBUFF_API_KEY,
    // Optional directory agent runs from (if applicable).
    cwd: process.cwd(),
  })

  // Define your own custom agents!
  const myCustomAgent: AgentDefinition = {
    id: 'my-custom-agent',
    model: 'x-ai/grok-4-fast',
    displayName: 'Sentiment analyzer',
    toolNames: ['fetch_api_data'], // Defined below!
    instructionsPrompt: `
1. Describe the different sentiments in the given prompt.
2. Score the prompt along the following 5 dimensions:
  happiness, sadness, anger, fear, and surprise.`,
    // ... other AgentDefinition properties
  }

  // And define your own custom tools!
  const myCustomTool = getCustomToolDefinition({
    toolName: 'fetch_api_data',
    description: 'Fetch data from an API endpoint',
    inputSchema: z.object({
      url: z.url(),
      method: z.enum(['GET', 'POST']).default('GET'),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    exampleInputs: [{ url: 'https://api.example.com/data', method: 'GET' }],
    execute: async ({ url, method, headers }) => {
      const response = await fetch(url, { method, headers })
      const data = await response.text()
      return [
        {
          type: 'json' as const,
          value: {
            message: `API Response: ${data.slice(0, 5000)}...`,
          },
        },
      ]
    },
  })

  const { output } = await client.run({
    // Run a custom agent by id. Must match an id in the agentDefinitions field below.
    agent: 'my-custom-agent',
    prompt: "Today I'm feeling very happy!",

    // Provide custom agent and tool definitions:
    agentDefinitions: [myCustomAgent],
    customToolDefinitions: [myCustomTool],

    handleEvent: (event) => {
      // All events that happen during the run: agent start/finish, tool calls/results, text responses, errors.
      console.log('Codebuff Event', JSON.stringify(event))
    },
  })

  if (output.type === 'error') {
    console.error(`The run failed:\n${output.message}`)
  } else {
    console.log('The run succeeded with output:', output)
  }
}

main()
```

## API Reference

### Knowledge Files

Knowledge files provide project context to the agent. The SDK auto-discovers:

- **Project files**: `knowledge.md`, `AGENTS.md`, or `CLAUDE.md` in each directory (priority order)
- **User files**: `~/.knowledge.md`, `~/.AGENTS.md`, or `~/.CLAUDE.md` (case-insensitive)

Override with `knowledgeFiles` (replaces project files) or `userKnowledgeFiles` (merges with home directory files):

```typescript
await client.run({
  agent: 'codebuff/base@0.0.16',
  prompt: 'Help me refactor',
  knowledgeFiles: { 'knowledge.md': '# Guidelines\n- Use TypeScript' },
  userKnowledgeFiles: { '~/.knowledge.md': '# Preferences\n- Be concise' },
})
```

### File Filtering

The `fileFilter` option controls which files the agent can read:

```typescript
const client = new CodebuffClient({
  apiKey: process.env.CODEBUFF_API_KEY,
  fileFilter: (filePath) => {
    if (filePath === '.env') return { status: 'blocked' }
    if (filePath.endsWith('.env.example')) return { status: 'allow-example' }
    return { status: 'allow' }
  },
})
```

**Statuses:** `'blocked'` (returns `[BLOCKED]`), `'allow-example'` (prefixes content with `[TEMPLATE]`), `'allow'` (normal read).

**Default behavior:** When no `fileFilter` is provided, gitignore checking is applied automatically. When a `fileFilter` IS provided, the caller owns all filtering.

### `loadLocalAgents(options)`

Loads agent definitions from `.agents` directories on disk.

```typescript
import { loadLocalAgents, CodebuffClient } from '@fatagnus/codebuff'

// Load from default locations (.agents in cwd, parent, or home)
const agents = await loadLocalAgents({ verbose: true })

// Or load from a specific directory
// const agents = await loadLocalAgents({ agentsPath: './my-agents' })

// Or load and validate agents (invalid agents are filtered out)
// const agents = await loadLocalAgents({ validate: true, verbose: true })

// Access source file path for debugging
for (const agent of Object.values(agents)) {
  console.log(`${agent.id} loaded from ${agent._sourceFilePath}`)
}

// Use the loaded agents with client.run()
const client = new CodebuffClient({ apiKey: process.env.CODEBUFF_API_KEY })
const result = await client.run({
  agent: 'my-custom-agent',
  agentDefinitions: Object.values(agents),
  prompt: 'Hello',
})
```

#### Parameters

- **`agentsPath`** (string, optional): Path to a specific agents directory. If omitted, searches in `{cwd}/.agents`, `{cwd}/../.agents`, and `{homedir}/.agents`.
- **`verbose`** (boolean, optional): Whether to log errors during loading. Defaults to `false`.
- **`validate`** (boolean, optional): Whether to validate agents after loading. Invalid agents are filtered out. Defaults to `false`.

#### Returns

Returns a `Promise<LoadedAgents>` - a `Record<string, LoadedAgentDefinition>` of agent definitions keyed by their ID.

Each `LoadedAgentDefinition` extends `AgentDefinition` with:
- **`_sourceFilePath`** (string): The file path the agent was loaded from

#### Supported File Types

- `.ts`, `.tsx` - TypeScript files (automatically transpiled)
- `.js`, `.mjs`, `.cjs` - JavaScript files

Files ending in `.d.ts` or `.test.ts` are excluded.

### `client.run(options)`

Runs a Codebuff agent with the specified options.

#### Parameters

- **`agent`** (string, required): The agent to run. Use `'base'` for the default agent, or specify a custom agent ID if you made your own agent definition (passed with the `agentDefinitions` param).

- **`prompt`** (string, required): The user prompt describing what you want the agent to do.

- **`params`** (object, optional): Additional parameters for the agent. Most agents don't use this, but some custom agents can take a JSON object as input in addition to the user prompt string.

- **`handleEvent`** (function, optional): Callback function that receives every event during execution (assistant messages, tool calls, etc.). This allows you to stream the agent's progress in real-time. We will likely add a token-by-token streaming callback in the future.

- **`previousRun`** (object, optional): JSON state returned from a previous `run()` call. Use this to continue a conversation or session with the agent, maintaining context from previous interactions.

- **`projectFiles`** (object, optional): All the files in your project as a plain JavaScript object. Keys should be the full path from your current directory to each file, and values should be the string contents of the file. Example: `{ "src/index.ts": "console.log('hi')" }`. This helps Codebuff pick good source files for context. Note: This parameter was previously named `allFiles` but has been renamed for clarity.

- **`knowledgeFiles`** (object, optional): Knowledge files to inject into every `run()` call. Uses the same schema as `projectFiles` - keys are file paths and values are file contents. These files are added directly to the agent's context.

- **`agentDefinitions`** (array, optional): Array of custom agent definitions. Each object should satisfy the AgentDefinition type.

- **`customToolDefinitions`** (array, optional): Array of custom tool definitions that extend the agent's capabilities. Each tool definition includes a name, Zod schema for input validation, and a handler function. These tools can be called by the agent during execution.

- **`maxAgentSteps`** (number, optional): Maximum number of steps the agent can take before stopping. Use this as a safety measure in case your agent starts going off the rails. A reasonable number is around 20.

#### Returns

Returns a Promise that resolves to either a "success" or a "failure" object.

- The "success" object contains a `RunState` object which can be passed into subsequent runs via the `previousRun` parameter to resume the conversation.
- The "failure" object contains an `Error` object with a `name`, `message`, and `stack` properties.

The `RunState` object contains:

- `sessionState`: Internal state to be passed to the next run
- `output`: The agent's output (text, error, or other types)

## Convex Compatibility

This SDK includes a special entry point for running agents in [Convex](https://convex.dev) backend actions. Convex actions run in a sandboxed Node.js environment without access to the file system or `child_process`, so we provide a `ConvexCodebuffClient` that works within these constraints.

### Installation for Convex

```bash
npm install @fatagnus/codebuff
```

### Basic Convex Example

```typescript
import { ConvexCodebuffClient } from '@fatagnus/codebuff/convex'

// In a Convex action
export async function analyzeCode(apiKey: string, codeToAnalyze: string) {
  const client = new ConvexCodebuffClient({
    apiKey,
    // In Convex, provide project files as a plain object since there's no file system
    projectFiles: {
      'code-to-analyze.ts': codeToAnalyze,
    },
  })

  const result = await client.run({
    agent: 'codebuff/base-lite@1.0.0',
    prompt: 'Please analyze the code in code-to-analyze.ts and explain what it does.',
  })

  if (result.output.type === 'error') {
    throw new Error(`Agent error: ${result.output.message}`)
  }

  return result.output
}
```

### Full Convex Action Example

```typescript
import { action } from "./_generated/server"
import { v } from "convex/values"
import { ConvexCodebuffClient } from "@fatagnus/codebuff/convex"

export const analyzeCode = action({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.CODEBUFF_API_KEY
    if (!apiKey) throw new Error("CODEBUFF_API_KEY not configured")

    const client = new ConvexCodebuffClient({
      apiKey,
      projectFiles: { "input.ts": args.code },
      maxAgentSteps: 10, // Limit steps to stay within Convex's timeout
    })

    const result = await client.run({
      agent: "codebuff/base-lite@1.0.0",
      prompt: "Analyze this code and suggest improvements.",
    })

    if (result.output.type === "error") {
      throw new Error(result.output.message)
    }

    return result.output
  },
})
```

### Multi-turn Conversations in Convex

```typescript
import { ConvexCodebuffClient } from '@fatagnus/codebuff/convex'

export async function multiTurnConversation(
  apiKey: string,
  projectFiles: Record<string, string>,
) {
  const client = new ConvexCodebuffClient({
    apiKey,
    projectFiles,
  })

  // First turn
  const run1 = await client.run({
    agent: 'codebuff/base-lite@1.0.0',
    prompt: 'What files are in this project?',
  })

  // Second turn - continues the conversation
  const run2 = await client.run({
    agent: 'codebuff/base-lite@1.0.0',
    prompt: 'Now explain the main entry point.',
    previousRun: run1, // Pass the previous run state to continue the conversation
  })

  return run2
}
```

### Subagent Spawning in Convex

The Convex runtime supports spawning subagents using the `spawn_agents` tool. To use this feature:

1. Define your agents with `spawnableAgents` arrays
2. Include all agent definitions in `agentDefinitions`

```typescript
import { ConvexCodebuffClient } from '@fatagnus/codebuff/convex'
import type { AgentDefinition } from '@fatagnus/codebuff/convex'

const helperAgent: AgentDefinition = {
  id: 'helper',
  displayName: 'Helper Agent',
  systemPrompt: 'You are a helpful assistant that answers questions.',
  toolNames: ['read_files', 'end_turn'],
}

const orchestratorAgent: AgentDefinition = {
  id: 'orchestrator',
  displayName: 'Orchestrator',
  systemPrompt: 'You coordinate tasks by spawning helper agents.',
  toolNames: ['spawn_agents', 'read_files', 'end_turn'],
  spawnableAgents: ['helper'], // Can spawn the helper agent
}

const client = new ConvexCodebuffClient({
  apiKey,
  projectFiles: myFiles,
  agentDefinitions: [helperAgent, orchestratorAgent],
})

const result = await client.run({
  agent: orchestratorAgent,
  prompt: 'Analyze this codebase by spawning helpers for each file.',
})
```

**Subagent limitations in Convex:**
- Maximum nesting depth of 5 levels
- Subagents can only be spawned from `agentDefinitions` (no database lookups)
- Subagents run in parallel using `Promise.allSettled`

### Convex Limitations & Workarounds

Convex runs in a sandboxed Node.js environment without WASM support, file system access, or `child_process`. Here's how the SDK handles this:

**Token Scoring Unavailable**: The standard SDK uses `web-tree-sitter` (WASM) to parse source files and extract symbol importance scores. In Convex, this is replaced with:
- A hierarchical file tree in the system prompt
- The `read_subtree` tool for exploring project structure

**Unavailable Tools** (will throw `ConvexUnsupportedToolError`):

- `run_terminal_command` - No `child_process` access
- `code_search` - Requires ripgrep and file system
- `write_file` / `str_replace` - No file system write access
- `list_directory` / `glob` - No file system access

You can provide custom implementations via `overrideTools` if needed:

```typescript
const client = new ConvexCodebuffClient({
  apiKey,
  projectFiles: myFiles,
  overrideTools: {
    read_files: async ({ filePaths }) => {
      // Custom implementation to fetch files from your database
      const result: Record<string, string | null> = {}
      for (const path of filePaths) {
        result[path] = await fetchFileFromDatabase(path)
      }
      return result
    },
  },
})
```

### ConvexCodebuffClient API

#### Constructor Options

- **`apiKey`** (string, required): Your Codebuff API key
- **`projectFiles`** (object, optional): Files as `{ path: content }` - required since there's no file system
- **`knowledgeFiles`** (object, optional): Knowledge files to inject into context
- **`agentDefinitions`** (array, optional): Custom agent definitions
- **`maxAgentSteps`** (number, optional): Max steps before stopping (recommended: 10-20 for Convex timeout limits)
- **`handleEvent`** (function, optional): Event callback for streaming
- **`handleStreamChunk`** (function, optional): Chunk callback for real-time updates. Receives text chunks and subagent events (`subagent_start`, `subagent_chunk`, `subagent_finish`)
- **`overrideTools`** (object, optional): Custom tool implementations
- **`customToolDefinitions`** (array, optional): Custom tool definitions

#### Methods

- **`run(options)`**: Run an agent (same options as standard `CodebuffClient.run()`)
- **`checkConnection()`**: Check if the Codebuff backend is reachable

#### Built-in Tools

The Convex SDK includes these tools by default:

- **`read_files`**: Read contents of specific files
- **`read_subtree`**: Explore directory structure and contents (compensates for lack of token scoring)
- **`end_turn`**: Signal task completion
- **`spawn_agents`**: Spawn subagents (when `spawnableAgents` is configured)

## License

MIT
