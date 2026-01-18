/**
 * Example: Using Codebuff SDK in a Convex Action
 *
 * This example shows how to run Codebuff agents from within a Convex backend action.
 * Convex actions run in a sandboxed Node.js environment without access to the file
 * system or child_process, so we use the special Convex-compatible SDK entry point.
 *
 * To use this in your Convex project:
 * 1. Install the SDK: `npm install @codebuff/sdk`
 * 2. Add your CODEBUFF_API_KEY to your Convex environment variables
 * 3. Create an action file like this one in your convex/ directory
 */

// Import from the Convex-compatible entry point
import { ConvexCodebuffClient } from '@codebuff/sdk/convex'

import type { ConvexRunOptions } from '@codebuff/sdk/convex'

// Example Convex action (this would be in your convex/ directory)
// In a real Convex project, you'd use: import { action } from "./_generated/server"

/**
 * Simple example: Ask an agent to analyze or explain code
 */
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
    prompt: `Please analyze the code in code-to-analyze.ts and explain what it does.`,
  })

  if (result.output.type === 'error') {
    throw new Error(`Agent error: ${result.output.message}`)
  }

  return result.output
}

/**
 * Advanced example: Custom agent with streaming and custom tools
 */
export async function runCustomAgent(
  apiKey: string,
  prompt: string,
  projectFiles: Record<string, string>,
) {
  const client = new ConvexCodebuffClient({
    apiKey,
    projectFiles,
    maxAgentSteps: 10, // Limit steps to stay within Convex's 10-minute timeout

    // Handle streaming chunks (useful for real-time UI updates)
    handleStreamChunk: (chunk) => {
      if (typeof chunk === 'string') {
        console.log('Agent response chunk:', chunk)
      }
    },

    // Handle events like tool calls
    handleEvent: (event) => {
      console.log('Agent event:', event.type)
    },
  })

  const result = await client.run({
    agent: 'codebuff/base-lite@1.0.0',
    prompt,
  })

  return result
}

/**
 * Example: Multi-turn conversation
 */
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

/**
 * Example: Using a custom agent definition
 */
export async function runWithCustomAgentDefinition(
  apiKey: string,
  prompt: string,
) {
  const client = new ConvexCodebuffClient({
    apiKey,
    agentDefinitions: [
      {
        id: 'code-reviewer',
        model: 'anthropic/claude-sonnet-4-20250514',
        displayName: 'Code Reviewer',
        toolNames: [], // No tools needed for pure analysis
        instructionsPrompt: `You are an expert code reviewer. Analyze code for:
1. Potential bugs and edge cases
2. Performance issues
3. Security vulnerabilities
4. Code style and best practices

Provide actionable feedback with specific line references when possible.`,
      },
    ],
  })

  const result = await client.run({
    agent: 'code-reviewer', // Use our custom agent
    prompt,
  })

  return result
}

// ============================================================================
// Usage in a real Convex action would look like this:
// ============================================================================
//
// import { action } from "./_generated/server";
// import { v } from "convex/values";
// import { ConvexCodebuffClient } from "@codebuff/sdk/convex";
//
// export const analyzeCode = action({
//   args: {
//     code: v.string(),
//   },
//   handler: async (ctx, args) => {
//     const apiKey = process.env.CODEBUFF_API_KEY;
//     if (!apiKey) throw new Error("CODEBUFF_API_KEY not configured");
//
//     const client = new ConvexCodebuffClient({
//       apiKey,
//       projectFiles: { "input.ts": args.code },
//     });
//
//     const result = await client.run({
//       agent: "codebuff/base-lite@1.0.0",
//       prompt: "Analyze this code and suggest improvements.",
//     });
//
//     if (result.output.type === "error") {
//       throw new Error(result.output.message);
//     }
//
//     return result.output;
//   },
// });
