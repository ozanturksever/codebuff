"use node"
/**
 * Convex Actions for Codebuff Demo
 *
 * This file contains Convex actions that use the ConvexCodebuffClient
 * to run AI agents in a real Convex backend environment.
 *
 * NOTE: The "use node" directive is required because the ConvexCodebuffClient
 * uses Node.js APIs internally. This makes the action run in a Node.js runtime
 * instead of Convex's default V8 isolate runtime.
 */

import { action } from "./_generated/server"
import { v } from "convex/values"

// Import from the published SDK package (must be installed)
import { ConvexCodebuffClient } from "@fatagnus/codebuff/convex"

import type { AgentDefinition } from "@fatagnus/codebuff/convex"

/**
 * Analyze code using a Codebuff agent
 *
 * This action demonstrates running a Codebuff agent inside a Convex action.
 * The agent can read the provided files and analyze the code.
 */
export const analyzeCode = action({
  args: {
    code: v.string(),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.CODEBUFF_API_KEY
    if (!apiKey) {
      throw new Error(
        "CODEBUFF_API_KEY environment variable is not configured. " +
          "Set it in your Convex dashboard under Settings > Environment Variables."
      )
    }

    const filename = args.filename ?? "code.ts"

    // Create the Convex-compatible client
    const client = new ConvexCodebuffClient({
      apiKey,
      // Provide the code as a project file
      projectFiles: {
        [filename]: args.code,
      },
      maxAgentSteps: 5, // Keep it low for demo purposes
    })

    // Check connection first
    const isConnected = await client.checkConnection()
    if (!isConnected) {
      throw new Error("Could not connect to Codebuff backend")
    }

    // Define an inline agent for code analysis
    const analyzerAgent: AgentDefinition = {
      id: "convex-code-analyzer",
      name: "Convex Code Analyzer",
      displayName: "Code Analyzer",
      description: "Analyzes code running in Convex backend",
      version: "1.0.0",
      model: "anthropic/claude-haiku-4.5",
      systemPrompt: `You are a helpful code analyzer running inside a Convex backend action.

When analyzing code:
1. First read the file using read_files
2. Explain what the code does clearly and concisely
3. Identify any potential bugs, edge cases, or issues
4. Suggest improvements for readability, performance, or best practices

Keep your response focused and actionable.`,
      tools: ["read_files"],
    }

    // Run the analysis
    const result = await client.run({
      agent: analyzerAgent,
      prompt: `Please analyze the code in ${filename} and provide insights.`,
    })

    if (result.output.type === "error") {
      throw new Error(`Agent error: ${result.output.message}`)
    }

    return {
      success: true,
      outputType: result.output.type,
      output: result.output,
    }
  },
})

/**
 * Simple health check action to verify Convex is working
 */
export const healthCheck = action({
  args: {},
  handler: async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: "convex",
    }
  },
})

/**
 * Check if Codebuff connection is working
 */
export const checkCodebuffConnection = action({
  args: {},
  handler: async () => {
    const apiKey = process.env.CODEBUFF_API_KEY
    if (!apiKey) {
      return {
        connected: false,
        error: "CODEBUFF_API_KEY not configured",
      }
    }

    const client = new ConvexCodebuffClient({ apiKey })
    const isConnected = await client.checkConnection()

    return {
      connected: isConnected,
      error: isConnected ? null : "Could not connect to Codebuff backend",
    }
  },
})
