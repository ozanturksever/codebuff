#!/usr/bin/env bun
/**
 * Upstream Update Script (Online Upgrade Safe)
 *
 * This script uses the Codebuff SDK to run an intelligent agent that:
 * 1. Checks for uncommitted local changes and commits them
 * 2. Fetches and merges updates from upstream
 * 3. Analyzes the updates for agent/prompt changes
 * 4. Generates a report
 *
 * IMPORTANT: Docker restart happens AFTER the agent completes to avoid
 * killing the connection mid-execution (since this script runs on the
 * same instance it's updating).
 */

// Load environment variables from .env files using Bun's native file API
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { execSync } from 'child_process'

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

// Load .env files (later files don't override earlier ones)
const projectRoot = resolve(import.meta.dir, '..')
loadEnvFile(resolve(projectRoot, '.env.local'))
loadEnvFile(resolve(projectRoot, '.env'))

// Default to localhost for self-hosted if not set
if (!process.env.NEXT_PUBLIC_CODEBUFF_APP_URL) {
  process.env.NEXT_PUBLIC_CODEBUFF_APP_URL = 'http://localhost:3000'
}

import { z } from 'zod/v4'
import { CodebuffClient, getCustomToolDefinition } from '@codebuff/sdk'
import type { AgentDefinition } from '@codebuff/sdk'

// Helper to run shell commands
function runCommand(
  command: string,
  options: { cwd?: string; throwOnError?: boolean } = {},
): { success: boolean; stdout: string; stderr: string } {
  const { cwd = process.cwd(), throwOnError = false } = options
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { success: true, stdout: stdout.trim(), stderr: '' }
  } catch (error: any) {
    if (throwOnError) {
      throw error
    }
    return {
      success: false,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
    }
  }
}

// Global state to track what the agent found (for post-agent docker restart)
let analysisResult: {
  requiresDockerRestart: boolean
  requiresDockerRebuild: boolean
  agentChanges: string[]
  promptChanges: string[]
  dockerChanges: string[]
} = {
  requiresDockerRestart: false,
  requiresDockerRebuild: false,
  agentChanges: [],
  promptChanges: [],
  dockerChanges: [],
}

// Define custom tools for the agent
const gitStatusTool = getCustomToolDefinition({
  toolName: 'git_status',
  description:
    'Check the current git status to see if there are uncommitted changes, staged files, or untracked files.',
  inputSchema: z.object({}),
  exampleInputs: [{}],
  execute: async () => {
    const status = runCommand('git status --porcelain')
    const branch = runCommand('git branch --show-current')
    const hasChanges = status.stdout.length > 0

    return [
      {
        type: 'json' as const,
        value: {
          hasUncommittedChanges: hasChanges,
          currentBranch: branch.stdout,
          statusOutput: status.stdout || 'Working tree clean',
          changedFiles: status.stdout
            .split('\n')
            .filter(Boolean)
            .map((line) => ({
              status: line.substring(0, 2).trim(),
              file: line.substring(3),
            })),
        },
      },
    ]
  },
})

const gitCommitAllTool = getCustomToolDefinition({
  toolName: 'git_commit_all',
  description:
    'Stage all changes (including untracked files) and commit them with a given message. Use this to save local changes before pulling from upstream.',
  inputSchema: z.object({
    message: z
      .string()
      .describe('The commit message describing the local changes'),
  }),
  exampleInputs: [{ message: 'Save local changes before upstream sync' }],
  execute: async ({ message }) => {
    // Stage all changes
    const addResult = runCommand('git add -A')
    if (!addResult.success) {
      return [
        {
          type: 'json' as const,
          value: { success: false, error: `Failed to stage: ${addResult.stderr}` },
        },
      ]
    }

    // Commit
    const commitResult = runCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`)
    if (!commitResult.success && !commitResult.stderr.includes('nothing to commit')) {
      return [
        {
          type: 'json' as const,
          value: { success: false, error: `Failed to commit: ${commitResult.stderr}` },
        },
      ]
    }

    // Get the commit hash
    const hashResult = runCommand('git rev-parse --short HEAD')

    return [
      {
        type: 'json' as const,
        value: {
          success: true,
          commitHash: hashResult.stdout,
          message: message,
        },
      },
    ]
  },
})

const gitFetchUpstreamTool = getCustomToolDefinition({
  toolName: 'git_fetch_upstream',
  description:
    'Fetch the latest changes from the upstream remote to see what updates are available.',
  inputSchema: z.object({}),
  exampleInputs: [{}],
  execute: async () => {
    const fetchResult = runCommand('git fetch upstream')

    // Check if upstream exists
    if (!fetchResult.success && fetchResult.stderr.includes("'upstream' does not appear")) {
      return [
        {
          type: 'json' as const,
          value: {
            success: false,
            error: 'Upstream remote not configured. Run: git remote add upstream <url>',
          },
        },
      ]
    }

    // Get commit count difference
    const behindResult = runCommand('git rev-list --count HEAD..upstream/main')
    const aheadResult = runCommand('git rev-list --count upstream/main..HEAD')

    return [
      {
        type: 'json' as const,
        value: {
          success: true,
          commitsBehind: parseInt(behindResult.stdout) || 0,
          commitsAhead: parseInt(aheadResult.stdout) || 0,
        },
      },
    ]
  },
})

const gitMergeUpstreamTool = getCustomToolDefinition({
  toolName: 'git_merge_upstream',
  description:
    'Merge the upstream/main branch into the current branch. This will bring in all the latest changes from upstream.',
  inputSchema: z.object({}),
  exampleInputs: [{}],
  execute: async () => {
    // Get commits that will be merged (before merging)
    const logResult = runCommand(
      'git log --oneline HEAD..upstream/main --pretty=format:"%h %s"',
    )
    const commitsToMerge = logResult.stdout.split('\n').filter(Boolean)

    // Perform the merge
    const mergeResult = runCommand('git merge upstream/main --no-edit')

    if (!mergeResult.success) {
      // Check if it's a merge conflict
      if (mergeResult.stderr.includes('CONFLICT')) {
        return [
          {
            type: 'json' as const,
            value: {
              success: false,
              error: 'Merge conflict detected',
              conflicts: mergeResult.stderr,
              hint: 'You may need to resolve conflicts manually',
            },
          },
        ]
      }
      // "Already up to date" is not an error
      if (mergeResult.stdout.includes('Already up to date') || mergeResult.stderr.includes('Already up to date')) {
        return [
          {
            type: 'json' as const,
            value: {
              success: true,
              mergedCommits: [],
              mergeOutput: 'Already up to date',
            },
          },
        ]
      }
      return [
        {
          type: 'json' as const,
          value: {
            success: false,
            error: mergeResult.stderr || mergeResult.stdout,
          },
        },
      ]
    }

    return [
      {
        type: 'json' as const,
        value: {
          success: true,
          mergedCommits: commitsToMerge,
          mergeOutput: mergeResult.stdout,
        },
      },
    ]
  },
})

const analyzeChangesTool = getCustomToolDefinition({
  toolName: 'analyze_upstream_changes',
  description:
    'Analyze what files changed in the upstream merge to detect agent changes, prompt changes, or docker-related changes. Returns categorized lists of changed files. This also flags whether Docker needs to be restarted (which will happen AFTER this script completes).',
  inputSchema: z.object({
    commitRange: z
      .string()
      .optional()
      .describe(
        'Git commit range to analyze (e.g., "HEAD~5..HEAD"). If not provided, analyzes the last merge.',
      ),
  }),
  exampleInputs: [{ commitRange: 'HEAD~5..HEAD' }, {}],
  execute: async ({ commitRange }) => {
    // Find the range to analyze - either provided or the last merge
    let range = commitRange
    if (!range) {
      // Get the merge base and HEAD
      const mergeBase = runCommand('git merge-base HEAD upstream/main~1 2>/dev/null || echo HEAD~1')
      range = `${mergeBase.stdout}..HEAD`
    }

    // Get all changed files
    const diffResult = runCommand(`git diff --name-only ${range} 2>/dev/null || git diff --name-only HEAD~5..HEAD`)
    const changedFiles = diffResult.stdout.split('\n').filter(Boolean)

    // Categorize files
    const agentChanges = changedFiles.filter(
      (f) =>
        f.startsWith('.agents/') ||
        f.includes('/agents/') ||
        f.endsWith('-agent.ts') ||
        f.endsWith('-agent.js'),
    )

    const promptChanges = changedFiles.filter(
      (f) =>
        f.includes('prompt') ||
        f.includes('system-prompt') ||
        f.includes('instructions') ||
        (f.startsWith('.agents/') && (f.endsWith('.ts') || f.endsWith('.js'))),
    )

    const dockerChanges = changedFiles.filter(
      (f) =>
        f.includes('docker') ||
        f.includes('Dockerfile') ||
        f === 'docker-compose.yml' ||
        f === '.dockerignore',
    )

    const webChanges = changedFiles.filter((f) => f.startsWith('web/'))
    const sdkChanges = changedFiles.filter((f) => f.startsWith('sdk/'))
    const cliChanges = changedFiles.filter((f) => f.startsWith('cli/'))

    // Store analysis for post-agent docker restart
    analysisResult = {
      requiresDockerRestart: agentChanges.length > 0 || promptChanges.length > 0 || webChanges.length > 0,
      requiresDockerRebuild: dockerChanges.length > 0,
      agentChanges,
      promptChanges,
      dockerChanges,
    }

    return [
      {
        type: 'json' as const,
        value: {
          totalFilesChanged: changedFiles.length,
          allFiles: changedFiles,
          categories: {
            agentChanges: {
              count: agentChanges.length,
              files: agentChanges,
            },
            promptChanges: {
              count: promptChanges.length,
              files: promptChanges,
            },
            dockerChanges: {
              count: dockerChanges.length,
              files: dockerChanges,
            },
            webChanges: {
              count: webChanges.length,
              files: webChanges,
            },
            sdkChanges: {
              count: sdkChanges.length,
              files: sdkChanges,
            },
            cliChanges: {
              count: cliChanges.length,
              files: cliChanges,
            },
          },
          // Inform agent about what will happen after it completes
          postAgentActions: {
            willRestartDocker: analysisResult.requiresDockerRestart || analysisResult.requiresDockerRebuild,
            willRebuildDocker: analysisResult.requiresDockerRebuild,
            note: 'Docker restart will happen AFTER this agent completes to avoid killing the connection.',
          },
        },
      },
    ]
  },
})

const generateReportTool = getCustomToolDefinition({
  toolName: 'generate_report',
  description:
    'Generate a final markdown report summarizing all actions taken during the upstream update process. Call this at the end with all the information gathered. Note: Docker restart info should indicate it will happen after the agent completes.',
  inputSchema: z.object({
    localChangesCommitted: z.boolean(),
    localCommitHash: z.string().optional(),
    localCommitMessage: z.string().optional(),
    commitsMerged: z.number(),
    mergedCommitList: z.array(z.string()).optional(),
    agentChangesDetected: z.boolean(),
    promptChangesDetected: z.boolean(),
    dockerChangesDetected: z.boolean(),
    webChangesDetected: z.boolean(),
    errors: z.array(z.string()).optional(),
    additionalNotes: z.string().optional(),
  }),
  exampleInputs: [
    {
      localChangesCommitted: true,
      localCommitHash: 'abc123',
      localCommitMessage: 'Save local changes',
      commitsMerged: 5,
      agentChangesDetected: true,
      promptChangesDetected: false,
      dockerChangesDetected: false,
      webChangesDetected: true,
    },
  ],
  execute: async (data) => {
    const timestamp = new Date().toISOString()
    const willRestart = analysisResult.requiresDockerRestart || analysisResult.requiresDockerRebuild
    const willRebuild = analysisResult.requiresDockerRebuild

    const report = `
# Upstream Update Report
Generated: ${timestamp}

## Summary
${data.localChangesCommitted ? `✅ Local changes committed (${data.localCommitHash}): "${data.localCommitMessage}"` : '⏭️ No local changes to commit'}
${data.commitsMerged > 0 ? `✅ Merged ${data.commitsMerged} commits from upstream` : '⏭️ Already up to date with upstream'}
${data.agentChangesDetected ? '🔔 Agent changes detected in update' : ''}
${data.promptChangesDetected ? '🔔 Prompt changes detected in update' : ''}
${data.dockerChangesDetected ? '🔔 Docker configuration changes detected' : ''}
${data.webChangesDetected ? '🔔 Web application changes detected' : ''}

## Merged Commits
${data.mergedCommitList?.length ? data.mergedCommitList.map((c) => `- ${c}`).join('\n') : 'No new commits merged'}

## Post-Agent Actions
${willRestart ? (willRebuild ? '🐳 Docker will be REBUILT and restarted after this report...' : '🐳 Docker will be RESTARTED after this report...') : '⏭️ No Docker restart needed'}

${data.errors?.length ? `## Errors\n${data.errors.map((e) => `- ❌ ${e}`).join('\n')}` : ''}

${data.additionalNotes ? `## Notes\n${data.additionalNotes}` : ''}

---
*Report generated by upstream-merger agent*
`.trim()

    // Print to console
    console.log('\n' + '='.repeat(60))
    console.log(report)
    console.log('='.repeat(60) + '\n')

    return [
      {
        type: 'json' as const,
        value: {
          report,
          timestamp,
          pendingDockerRestart: willRestart,
          pendingDockerRebuild: willRebuild,
        },
      },
    ]
  },
})

// Define the upstream merger agent
// Using a model available via OpenRouter for self-hosted setups
const upstreamMergerAgent: AgentDefinition = {
  id: 'upstream-merger',
  model: 'anthropic/claude-3.5-sonnet',
  displayName: 'Upstream Merger & Reporter',
  toolNames: [
    'git_status',
    'git_commit_all',
    'git_fetch_upstream',
    'git_merge_upstream',
    'analyze_upstream_changes',
    'generate_report',
  ],
  systemPrompt: `You are an intelligent git operations agent specializing in syncing forked repositories with their upstream source.

Your job is to:
1. Check for and handle uncommitted local changes
2. Fetch and merge updates from upstream
3. Analyze what changed (especially agent/prompt changes)
4. Generate a comprehensive report

IMPORTANT: This script runs on the same server it's updating. Docker restart happens AFTER you complete, not during your execution. Do NOT try to restart docker yourself - just report what changes were detected and the script will handle the restart after you finish.

Be thorough but efficient. Always check the current state before making changes.
If there are merge conflicts, report them clearly - don't try to resolve them automatically.`,

  instructionsPrompt: `Execute the upstream update workflow:

1. First, use git_status to check for uncommitted local changes
2. If there are uncommitted changes, use git_commit_all to save them with an appropriate message
3. Use git_fetch_upstream to fetch the latest from upstream
4. If there are new commits, use git_merge_upstream to merge them
5. Use analyze_upstream_changes to categorize what files changed
6. Use generate_report to create a summary (Docker restart will happen automatically after you complete if needed)

Handle errors gracefully and include them in the final report.
Do NOT attempt to restart Docker - it will be done automatically after you finish.`,
}

// Post-agent Docker restart function
function restartDockerIfNeeded() {
  const { requiresDockerRestart, requiresDockerRebuild } = analysisResult

  if (!requiresDockerRestart && !requiresDockerRebuild) {
    console.log('ℹ️  No Docker restart needed.')
    return
  }

  console.log('\n🐳 Initiating Docker restart (post-agent)...')

  // Check if docker compose is running
  const psResult = runCommand('docker compose ps -q')
  if (!psResult.success || !psResult.stdout) {
    console.log('ℹ️  Docker compose is not running. Skipping restart.')
    return
  }

  let command: string
  if (requiresDockerRebuild) {
    console.log('🔨 Rebuilding Docker images due to Dockerfile/compose changes...')
    command = 'docker compose up -d --build'
  } else {
    console.log('🔄 Restarting Docker containers...')
    command = 'docker compose up -d --force-recreate'
  }

  const result = runCommand(command)
  if (result.success) {
    console.log('✅ Docker restart completed successfully!')
    console.log(result.stdout)
  } else {
    console.error('❌ Docker restart failed:', result.stderr)
  }
}

async function main() {
  console.log('🚀 Starting Upstream Update Agent...')
  console.log('   (Online upgrade safe - Docker restart happens after agent completes)\n')

  const apiKey = process.env.CODEBUFF_API_KEY
  if (!apiKey) {
    console.error(
      '❌ CODEBUFF_API_KEY environment variable is required.\n' +
        '   Get your API key at: https://www.codebuff.com/api-keys',
    )
    process.exit(1)
  }

  const client = new CodebuffClient({
    apiKey,
    cwd: process.cwd(),
  })

  try {
    const { output } = await client.run({
      agent: 'upstream-merger',
      prompt:
        'Update this repository from upstream. Check for local changes, commit them if needed, merge upstream, analyze what changed, and generate a report. Docker restart will happen automatically after you complete.',
      agentDefinitions: [upstreamMergerAgent],
      customToolDefinitions: [
        gitStatusTool,
        gitCommitAllTool,
        gitFetchUpstreamTool,
        gitMergeUpstreamTool,
        analyzeChangesTool,
        generateReportTool,
      ],
      maxAgentSteps: 15,
      handleEvent: (event) => {
        if (event.type === 'tool_call') {
          console.log(`🔧 Tool: ${event.toolName}`)
        } else if (event.type === 'error') {
          console.error(`❌ Error: ${event.message}`)
        } else if (event.type === 'text') {
          // Agent thinking/response
          if (event.text && !event.text.startsWith('{')) {
            console.log(`💭 ${event.text.substring(0, 100)}...`)
          }
        }
      },
    })

    if (output.type === 'error') {
      console.error(`\n❌ Agent failed: ${output.message}`)
      process.exit(1)
    }

    console.log('\n✅ Agent completed successfully!')

    // NOW restart Docker if needed (after agent is done)
    restartDockerIfNeeded()

    console.log('\n🎉 Upstream update completed!')
  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  }
}

main()
