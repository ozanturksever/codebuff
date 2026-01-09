import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getProjectRoot } from '../project-files'
import { logger } from '../utils/logger'
import { useChatStore } from '../state/chat-store'
import { getCodebuffClient } from '../utils/codebuff-client'
import { AGENT_MODE_TO_ID } from '../utils/constants'
import { getSystemMessage, getUserMessage } from '../utils/message-history'

import type { AgentMode } from '../utils/constants'

import type { CodebuffClient } from '@codebuff/sdk'

import type { ChatMessage } from '../types/chat'
import type { PostUserMessageFn } from '../types/contracts/send-message'

// ============================================================================
// Types
// ============================================================================

export interface UserStory {
  id: string
  title: string
  description: string
  acceptanceCriteria: string[]
  priority: number
  passes: boolean
  notes: string
}

export interface ParallelWorktree {
  storyId: string
  branch: string
  worktreePath: string
  status: 'running' | 'completed' | 'merged'
  createdAt: string
}

export interface PRD {
  project: string
  branchName?: string
  description: string
  userStories: UserStory[]
  createdAt: string
  updatedAt: string
  /** Tracks stories being executed in parallel worktrees */
  parallelWorktrees?: ParallelWorktree[]
}

export interface PRDSummary {
  name: string
  project: string
  description: string
  totalStories: number
  completedStories: number
  filePath: string
}

// ============================================================================
// Constants
// ============================================================================

const PRD_DIR = 'prd'
const PROGRESS_DIR = 'prd/progress'

// ============================================================================
// File Operations
// ============================================================================

function getPrdDir(): string {
  return path.join(getProjectRoot(), PRD_DIR)
}

function getProgressDir(): string {
  return path.join(getProjectRoot(), PROGRESS_DIR)
}

function ensurePrdDirExists(): void {
  const prdDir = getPrdDir()
  if (!fs.existsSync(prdDir)) {
    fs.mkdirSync(prdDir, { recursive: true })
  }
}

function ensureProgressDirExists(): void {
  const progressDir = getProgressDir()
  if (!fs.existsSync(progressDir)) {
    fs.mkdirSync(progressDir, { recursive: true })
  }
}

export function listPRDs(): PRDSummary[] {
  const prdDir = getPrdDir()
  
  if (!fs.existsSync(prdDir)) {
    return []
  }

  const files = fs.readdirSync(prdDir).filter(f => f.endsWith('.json'))
  const summaries: PRDSummary[] = []

  for (const file of files) {
    try {
      const filePath = path.join(prdDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const prd = JSON.parse(content) as PRD
      
      const completedStories = prd.userStories.filter(s => s.passes).length
      
      summaries.push({
        name: file.replace('.json', ''),
        project: prd.project,
        description: prd.description,
        totalStories: prd.userStories.length,
        completedStories,
        filePath,
      })
    } catch {
      // Skip invalid files
    }
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

export function loadPRD(name: string): PRD | null {
  const filePath = path.join(getPrdDir(), `${name}.json`)
  
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as PRD
  } catch {
    return null
  }
}

export function savePRD(name: string, prd: PRD): void {
  ensurePrdDirExists()
  const filePath = path.join(getPrdDir(), `${name}.json`)
  prd.updatedAt = new Date().toISOString()
  fs.writeFileSync(filePath, JSON.stringify(prd, null, 2), 'utf-8')
}

export function deletePRD(name: string): boolean {
  const filePath = path.join(getPrdDir(), `${name}.json`)
  
  if (!fs.existsSync(filePath)) {
    return false
  }

  fs.unlinkSync(filePath)
  return true
}

export function appendProgress(prdName: string, content: string): void {
  ensureProgressDirExists()
  const filePath = path.join(getProgressDir(), `${prdName}.txt`)
  const timestamp = new Date().toISOString()
  const entry = `\n## ${timestamp}\n${content}\n---\n`
  fs.appendFileSync(filePath, entry, 'utf-8')
}

export function getNextStory(prd: PRD): UserStory | null {
  const pendingStories = prd.userStories
    .filter(s => !s.passes)
    .sort((a, b) => a.priority - b.priority)
  
  return pendingStories[0] ?? null
}

export function markStoryComplete(prdName: string, storyId: string): boolean {
  const prd = loadPRD(prdName)
  if (!prd) return false

  const story = prd.userStories.find(s => s.id === storyId)
  if (!story) return false

  story.passes = true
  savePRD(prdName, prd)
  return true
}

// ============================================================================
// Worktree Management for Parallel Execution
// ============================================================================

const WORKTREES_DIR = '../codebuff-worktrees'

export function getWorktreesDir(): string {
  return path.resolve(getProjectRoot(), WORKTREES_DIR)
}

export function getStoryWorktreePath(prdName: string, storyId: string): string {
  return path.join(getWorktreesDir(), `${prdName}-${storyId.toLowerCase()}`)
}

export function getStoryBranchName(prdName: string, storyId: string): string {
  return `ralph/${prdName}/${storyId.toLowerCase()}`
}

async function runGitCommand(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: cwd ?? getProjectRoot(),
      stdio: 'pipe',
      shell: false,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 })
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}

async function getCurrentBranch(): Promise<string> {
  const result = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'])
  return result.stdout.trim() || 'main'
}

async function branchExists(branchName: string): Promise<boolean> {
  const result = await runGitCommand([
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branchName}`,
  ])
  return result.exitCode === 0
}

async function createStoryWorktree(
  prdName: string,
  story: UserStory,
): Promise<{ success: boolean; worktreePath: string; branch: string; error?: string }> {
  const worktreePath = getStoryWorktreePath(prdName, story.id)
  const branch = getStoryBranchName(prdName, story.id)

  // Check if worktree already exists - reuse it if so
  if (fs.existsSync(worktreePath)) {
    // Verify it's a valid worktree by checking for .git
    const gitPath = path.join(worktreePath, '.git')
    if (fs.existsSync(gitPath)) {
      // Sync .codebuff directory even for existing worktrees (PRD may have changed)
      const mainCodebuffDir = path.join(getProjectRoot(), '.codebuff')
      const worktreeCodebuffDir = path.join(worktreePath, '.codebuff')
      if (fs.existsSync(mainCodebuffDir)) {
        try {
          fs.cpSync(mainCodebuffDir, worktreeCodebuffDir, { recursive: true })
        } catch {
          // Non-fatal
        }
      }
      // Also sync PRD directory for existing worktrees (PRD may have changed)
      const mainPrdDir = path.join(getProjectRoot(), PRD_DIR)
      const worktreePrdDir = path.join(worktreePath, PRD_DIR)
      if (fs.existsSync(mainPrdDir)) {
        try {
          fs.cpSync(mainPrdDir, worktreePrdDir, { recursive: true })
        } catch {
          // Non-fatal
        }
      }
      return {
        success: true,
        worktreePath,
        branch,
      }
    }
    // Directory exists but not a valid worktree - clean it up
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true })
    } catch {
      return {
        success: false,
        worktreePath,
        branch,
        error: `Invalid worktree exists at ${worktreePath} and could not be removed`,
      }
    }
  }

  // Ensure worktrees directory exists
  const worktreesDir = getWorktreesDir()
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true })
  }

  // Check if branch already exists
  const exists = await branchExists(branch)

  // Create the worktree
  const worktreeArgs = ['worktree', 'add', worktreePath]
  if (exists) {
    worktreeArgs.push(branch)
  } else {
    worktreeArgs.push('-b', branch, 'HEAD')
  }

  const result = await runGitCommand(worktreeArgs)
  if (result.exitCode !== 0) {
    return {
      success: false,
      worktreePath,
      branch,
      error: result.stderr || 'Failed to create worktree',
    }
  }

  // Write a .ralph-story.json file with story info for the worktree
  const storyInfoPath = path.join(worktreePath, '.ralph-story.json')
  fs.writeFileSync(
    storyInfoPath,
    JSON.stringify(
      {
        prdName,
        storyId: story.id,
        title: story.title,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  // Copy .codebuff directory to worktree (PRDs and other config aren't committed)
  const mainCodebuffDir = path.join(getProjectRoot(), '.codebuff')
  const worktreeCodebuffDir = path.join(worktreePath, '.codebuff')
  if (fs.existsSync(mainCodebuffDir)) {
    try {
      fs.cpSync(mainCodebuffDir, worktreeCodebuffDir, { recursive: true })
    } catch (e) {
      // Non-fatal - log but continue
    }
  }

  // Copy PRD directory to worktree (PRD files might be uncommitted)
  const mainPrdDir = path.join(getProjectRoot(), PRD_DIR)
  const worktreePrdDir = path.join(worktreePath, PRD_DIR)
  if (fs.existsSync(mainPrdDir)) {
    try {
      fs.cpSync(mainPrdDir, worktreePrdDir, { recursive: true })
    } catch (e) {
      // Non-fatal - log but continue
    }
  }

  return { success: true, worktreePath, branch }
}

async function cleanupStoryWorktree(
  prdName: string,
  storyId: string,
): Promise<{ success: boolean; error?: string }> {
  const worktreePath = getStoryWorktreePath(prdName, storyId)

  // Remove git worktree
  const removeResult = await runGitCommand(['worktree', 'remove', worktreePath, '--force'])

  // Clean up directory if it still exists
  if (fs.existsSync(worktreePath)) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true })
    } catch (e) {
      return { success: false, error: `Failed to remove directory: ${e}` }
    }
  }

  // Prune worktrees
  await runGitCommand(['worktree', 'prune'])

  return { success: removeResult.exitCode === 0 || !fs.existsSync(worktreePath) }
}

async function checkBranchHasStoryCommit(
  branch: string,
  storyId: string,
  baseBranch: string,
): Promise<boolean> {
  // Get commits on branch that aren't on base
  const result = await runGitCommand([
    'log',
    `${baseBranch}..${branch}`,
    '--oneline',
    '--grep',
    storyId,
  ])

  return result.exitCode === 0 && result.stdout.trim().length > 0
}

async function mergeBranch(
  branch: string,
  baseBranch: string,
): Promise<{ success: boolean; error?: string; hasConflicts?: boolean }> {
  // First checkout base branch
  const checkoutResult = await runGitCommand(['checkout', baseBranch])
  if (checkoutResult.exitCode !== 0) {
    return { success: false, error: `Failed to checkout ${baseBranch}` }
  }

  // Try to merge
  const mergeResult = await runGitCommand(['merge', branch, '--no-edit'])

  if (mergeResult.exitCode !== 0) {
    // Check if it's a conflict
    if (mergeResult.stderr.includes('CONFLICT') || mergeResult.stdout.includes('CONFLICT')) {
      return { success: false, hasConflicts: true, error: 'Merge conflicts detected' }
    }
    return { success: false, error: mergeResult.stderr || 'Merge failed' }
  }

  return { success: true }
}

async function deleteBranch(branch: string): Promise<void> {
  await runGitCommand(['branch', '-D', branch])
}

// ============================================================================
// PRD Generation Prompt
// ============================================================================

function generatePrdCreationPrompt(prdName: string, featureDescription?: string, initialPrompt?: string): string {
  const initialContext = initialPrompt 
    ? `\n\nThe user has provided additional context:\n"${initialPrompt}"\n\nUse this information to reduce the number of clarifying questions needed.`
    : ''

  const featureContext = featureDescription
    ? `The user wants to build: "${featureDescription}"${initialContext}`
    : `The user wants to create a new PRD named "${prdName}".${initialContext}`

  return `You are helping create a PRD (Product Requirements Document) for autonomous development.

${featureContext}

Your task:
1. Ask 3-5 clarifying questions to understand the scope, constraints, and acceptance criteria${initialPrompt ? ' (skip questions already answered by the initial context)' : ''}
2. Use the ask_user tool to get answers
3. Based on the answers, generate a PRD with well-scoped user stories

Each user story should:
- Be small enough to complete in one context window (single focused change)
- Have clear acceptance criteria that can be verified
- Be ordered by priority (dependencies first)

After gathering requirements, create the PRD file at: prd/${prdName}.json

Use this exact JSON structure:
{
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
  "createdAt": "${new Date().toISOString()}",
  "updatedAt": "${new Date().toISOString()}"
}

Start by asking clarifying questions about the feature.`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
}

// ============================================================================
// Story Execution Prompt
// ============================================================================

function generateStoryExecutionPrompt(prd: PRD, story: UserStory, prdName: string): string {
  const completedCount = prd.userStories.filter(s => s.passes).length
  const totalCount = prd.userStories.length
  const isLastStory = completedCount + 1 === totalCount

  return `You are working on PRD: "${prd.project}" (${completedCount}/${totalCount} stories complete)

## Current Story: ${story.id} - ${story.title}

**Description:** ${story.description}

**Acceptance Criteria:**
${story.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${story.notes ? `**Notes:** ${story.notes}` : ''}

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
- **Use Testcontainers** for database and service dependencies - spin up real containers instead of mocking
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
5. If all checks pass, commit with message: "feat: ${story.id} - ${story.title}"
6. Update any relevant AGENTS.md files with learnings

After completing the story:
- Use write_file to update the PRD: Mark story ${story.id} as passes: true
- The PRD file is at: prd/${prdName}.json

Keep changes focused and minimal. Only implement what's needed for this story.

${isLastStory 
    ? '\n**This is the last story!** After completing it, suggest followups for next steps the user might want to take.'
    : '\n**Important:** After completing this story successfully, use suggest_followups to suggest "Continue to next story" as the first option so Ralph can automatically proceed to the next story.'}`
}

// ============================================================================
// Command Handlers
// ============================================================================

export function handleRalphList(): {
  postUserMessage: PostUserMessageFn
} {
  const prds = listPRDs()

  if (prds.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '📋 No PRDs found.\n\n' +
        'Create a new PRD with:\n' +
        '  /ralph new [feature description]\n\n' +
        'Example:\n' +
        '  /ralph new Add user authentication with OAuth'
      ),
    ]
    return { postUserMessage }
  }

  const lines = [
    '📋 PRDs',
    '',
    ...prds.map(p => {
      const status = p.completedStories === p.totalStories
        ? '✅'
        : `${p.completedStories}/${p.totalStories}`
      return `  ${status} ${p.name} - ${p.description.substring(0, 50)}${p.description.length > 50 ? '...' : ''}`
    }),
    '',
    'Commands:',
    '  /ralph run [name]    - Execute a PRD',
    '  /ralph edit [name]   - Edit a PRD',
    '  /ralph delete [name] - Delete a PRD',
    '  /ralph new [feature] - Create a new PRD',
  ]

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

export function handleRalphStatus(prdName?: string): {
  postUserMessage: PostUserMessageFn
} {
  if (!prdName) {
    // Show status of all PRDs
    return handleRalphList()
  }

  const prd = loadPRD(prdName)
  if (!prd) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }

  const completedCount = prd.userStories.filter(s => s.passes).length
  const totalCount = prd.userStories.length
  const nextStory = getNextStory(prd)

  // Check for parallel worktrees
  const runningWorktrees = prd.parallelWorktrees?.filter(w => w.status === 'running') || []
  const worktreeMap = new Map(runningWorktrees.map(w => [w.storyId, w]))

  const lines = [
    `📋 PRD: ${prd.project}`,
    '',
    `Description: ${prd.description}`,
    `Progress: ${completedCount}/${totalCount} stories complete`,
    prd.branchName ? `Branch: ${prd.branchName}` : '',
    '',
    'Stories:',
    ...prd.userStories.map(s => {
      const worktree = worktreeMap.get(s.id)
      const statusIcon = s.passes ? '✅' : worktree ? '🔀' : '○'
      const worktreeInfo = worktree ? ` (parallel: ${worktree.branch})` : ''
      return `  ${statusIcon} [${s.priority}] ${s.id}: ${s.title}${worktreeInfo}`
    }),
  ]

  if (runningWorktrees.length > 0) {
    lines.push('')
    lines.push(`🔀 ${runningWorktrees.length} stories running in parallel worktrees`)
    lines.push('   Use /ralph merge ' + prdName + ' to merge completed work')
  }

  lines.push('')
  lines.push(
    nextStory 
      ? `Next up: ${nextStory.id} - ${nextStory.title}`
      : '🎉 All stories complete!'
  )

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

export function handleRalphNew(prdName: string, featureDescription?: string, initialPrompt?: string): {
  postUserMessage: PostUserMessageFn
  prdPrompt?: string
} {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please provide a PRD name.\n\n' +
        'Examples:\n' +
        '  /ralph new my-feature\n' +
        '  /ralph new auth-system Add user authentication\n' +
        '  /ralph new auth -- use OAuth2 with Google and GitHub'
      ),
    ]
    return { postUserMessage }
  }

  // Slugify the PRD name to ensure valid filename
  const safePrdName = slugify(prdName)

  // Generate the prompt for PRD creation
  const prdPrompt = generatePrdCreationPrompt(safePrdName, featureDescription, initialPrompt)

  // Build the user message text
  let userMessageText = `/ralph new ${prdName}`
  if (featureDescription) {
    userMessageText += ` ${featureDescription}`
  }
  if (initialPrompt) {
    userMessageText += ` -- ${initialPrompt}`
  }

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getUserMessage(userMessageText),
  ]

  return { postUserMessage, prdPrompt }
}

export function handleRalphRun(prdName: string): {
  postUserMessage: PostUserMessageFn
  storyPrompt?: string
  prdName?: string
  storyId?: string
} {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name.\n\n' +
        'Use /ralph list to see available PRDs.'
      ),
    ]
    return { postUserMessage }
  }

  const prd = loadPRD(prdName)
  if (!prd) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }

  const nextStory = getNextStory(prd)
  if (!nextStory) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`🎉 All stories in "${prd.project}" are complete!`),
    ]
    return { postUserMessage }
  }

  const completedCount = prd.userStories.filter(s => s.passes).length
  const totalCount = prd.userStories.length

  // Generate prompt for story execution
  const storyPrompt = generateStoryExecutionPrompt(prd, nextStory, prdName)

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(
      `🚀 Starting Ralph: ${prd.project}\n` +
      `   Story ${completedCount + 1}/${totalCount}: ${nextStory.id} - ${nextStory.title}`
    ),
  ]

  return { 
    postUserMessage, 
    storyPrompt,
    prdName,
    storyId: nextStory.id,
  }
}

export function handleRalphDelete(prdName: string): {
  postUserMessage: PostUserMessageFn
} {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name to delete.\n\n' +
        'Use /ralph list to see available PRDs.'
      ),
    ]
    return { postUserMessage }
  }

  const deleted = deletePRD(prdName)
  
  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(
      deleted 
        ? `✓ Deleted PRD: ${prdName}`
        : `❌ PRD not found: ${prdName}`
    ),
  ]

  return { postUserMessage }
}

export function handleRalphEdit(prdName: string): {
  postUserMessage: PostUserMessageFn
  editPrompt?: string
} {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name to edit.\n\n' +
        'Use /ralph list to see available PRDs.'
      ),
    ]
    return { postUserMessage }
  }

  const prd = loadPRD(prdName)
  if (!prd) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }

  const editPrompt = `I want to edit the PRD at prd/${prdName}.json

Current PRD:
${JSON.stringify(prd, null, 2)}

What would you like to change? You can:
- Add new user stories
- Remove or reorder stories
- Update acceptance criteria
- Change priorities
- Modify descriptions

Tell me what changes you'd like to make.`

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getUserMessage(`/ralph edit ${prdName}`),
  ]

  return { postUserMessage, editPrompt }
}

export function handleRalphHelp(): {
  postUserMessage: PostUserMessageFn
} {
  const lines = [
    '📋 Ralph - PRD-Driven Autonomous Development',
    '',
    'Ralph helps you build features by breaking them into small,',
    'well-defined user stories and executing them one at a time.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'CREATING PRDs',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /ralph new <name>              Create a new PRD (interactive)',
    '  /ralph new <name> <desc>       Create PRD with description',
    '  /ralph new <name> -- <context> Create PRD with initial context',
    '  /ralph handoff                 Create PRD from current chat',
    '',
    'Examples:',
    '  /ralph new auth-feature',
    '  /ralph new auth Add user authentication with OAuth',
    '  /ralph new auth -- use OAuth2 with Google and GitHub providers',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'MANAGING PRDs',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /ralph                         List all PRDs',
    '  /ralph list                    List all PRDs with status',
    '  /ralph status <name>           Show detailed PRD status',
    '  /ralph edit <name>             Edit an existing PRD',
    '  /ralph delete <name>           Delete a PRD',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'EXECUTING STORIES',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /ralph run <name>              Execute next story in PRD',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'PARALLEL EXECUTION (Manual)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /ralph parallel <name> [ids]   Create worktrees for stories',
    '  /ralph merge <name>            Merge completed branches',
    '  /ralph cleanup <name>          Clean up worktrees',
    '',
    'Example:',
    '  /ralph parallel my-feature US-001 US-002 US-003',
    '  # Open terminals in each worktree and run codebuff',
    '  /ralph merge my-feature',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'ORCHESTRA MODE (Fully Autonomous)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /ralph orchestra <name>        Run all stories autonomously',
    '  /ralph orchestra <name> --parallelism N',
    '                                 Run N stories in parallel (default: 2)',
    '',
    'Example:',
    '  /ralph orchestra my-feature --parallelism 3',
    '',
    'Orchestra mode automatically:',
    '  • Creates worktrees for parallel execution',
    '  • Runs stories using the SDK',
    '  • Merges completed work back to main',
    '  • Resolves merge conflicts with AI',
    '  • Continues until all stories pass',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'NON-INTERACTIVE MODE',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Run Ralph commands without the TUI:',
    '',
    '  codebuff -n "/ralph orchestra my-feature"',
    '  codebuff --json "/ralph run my-feature"',
    '  codebuff -n -o result.json "/ralph status my-feature"',
    '  codebuff -n --timeout 600 "/ralph orchestra big-feature"',
    '',
    'Flags:',
    '  -n, --non-interactive   Run without TUI',
    '  --json                  Output JSON (implies -n)',
    '  -q, --quiet             Suppress progress output',
    '  -o, --output <file>     Write output to file',
    '  --timeout <seconds>     Set execution timeout',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'WORKFLOW EXAMPLE',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '1. Create PRD:',
    '   /ralph new auth-feature Add user authentication',
    '   → Codebuff asks clarifying questions',
    '   → Generates PRD with user stories',
    '',
    '2. Execute (choose one):',
    '   Sequential: /ralph run auth-feature (repeat for each story)',
    '   Autonomous: /ralph orchestra auth-feature --parallelism 3',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'FILES',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  PRD files:      prd/<name>.json',
    '  Progress logs:  prd/progress/<name>.txt',
    '',
    'Use /ralph help for this message.',
  ]

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

// ============================================================================
// Handoff - Create PRD from chat history
// ============================================================================

/**
 * Extracts a text representation of the conversation from chat messages.
 * Used to generate context for PRD creation from chat history.
 */
function extractConversationText(messages: ChatMessage[]): string {
  const lines: string[] = []

  for (const msg of messages) {
    if (msg.variant === 'user') {
      lines.push(`User: ${msg.content}`)
    } else if (msg.variant === 'ai') {
      // Extract text content from AI messages
      if (msg.blocks) {
        for (const block of msg.blocks) {
          if (block.type === 'text' && block.content) {
            lines.push(`Assistant: ${block.content.slice(0, 500)}`)
          }
          if (block.type === 'tool' && block.toolName === 'write_todos') {
            const todos = block.input?.todos as
              | Array<{ task: string; completed: boolean }>
              | undefined
            if (todos && todos.length > 0) {
              lines.push(
                `Todos: ${todos.map((t) => `[${t.completed ? 'x' : ' '}] ${t.task}`).join(', ')}`,
              )
            }
          }
        }
      } else if (msg.content) {
        lines.push(`Assistant: ${msg.content.slice(0, 500)}`)
      }
    }
  }

  // Limit total size
  const text = lines.join('\n')
  if (text.length > 10000) {
    return text.slice(-10000)
  }
  return text
}

/**
 * Generates a PRD creation prompt that includes conversation context.
 */
function generatePrdFromConversationPrompt(conversationText: string): string {
  return `You are helping create a PRD (Product Requirements Document) for autonomous development.

The user has been discussing a feature in the current chat session. Here is the conversation context:

---
${conversationText}
---

Based on this conversation, create a PRD with well-scoped user stories.

Your task:
1. Analyze the conversation to understand what feature/task the user wants to build
2. Ask 1-3 brief clarifying questions if critical details are missing (skip if the conversation provides enough context)
3. Generate a PRD with well-scoped user stories

Each user story should:
- Be small enough to complete in one context window (single focused change)
- Have clear acceptance criteria that can be verified
- Be ordered by priority (dependencies first)

After gathering any needed clarification, create the PRD file at: prd/<feature-slug>.json

Use this exact JSON structure:
{
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
  "createdAt": "${new Date().toISOString()}",
  "updatedAt": "${new Date().toISOString()}"
}

Start by summarizing what you understood from the conversation, then ask any critical clarifying questions or proceed to create the PRD.`
}

// ============================================================================
// Parallel Execution Commands
// ============================================================================

export async function handleRalphParallel(prdName: string, storyIds: string[]): Promise<{
  postUserMessage: PostUserMessageFn
}> {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name.\n\n' +
        'Usage: /ralph parallel <prd-name> [story-ids...]\n' +
        'Example: /ralph parallel my-feature US-001 US-002'
      ),
    ]
    return { postUserMessage }
  }

  const prd = loadPRD(prdName)
  if (!prd) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }

  // Get stories to parallelize
  let storiesToRun: UserStory[]
  if (storyIds.length === 0) {
    // No specific stories - use all pending stories
    storiesToRun = prd.userStories.filter(s => !s.passes)
    if (storiesToRun.length === 0) {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(`🎉 All stories in "${prd.project}" are already complete!`),
      ]
      return { postUserMessage }
    }
  } else {
    // Specific story IDs provided
    storiesToRun = []
    const notFound: string[] = []
    for (const id of storyIds) {
      const story = prd.userStories.find(s => s.id.toLowerCase() === id.toLowerCase())
      if (story) {
        if (!story.passes) {
          storiesToRun.push(story)
        }
      } else {
        notFound.push(id)
      }
    }

    if (notFound.length > 0) {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(
          `❌ Stories not found: ${notFound.join(', ')}\n\n` +
          `Available stories: ${prd.userStories.map(s => s.id).join(', ')}`
        ),
      ]
      return { postUserMessage }
    }

    if (storiesToRun.length === 0) {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage('❌ All specified stories are already complete.'),
      ]
      return { postUserMessage }
    }
  }

  // Get current branch as base
  const baseBranch = await getCurrentBranch()

  // Create worktrees for each story
  const results: Array<{
    story: UserStory
    success: boolean
    worktreePath: string
    branch: string
    error?: string
  }> = []

  for (const story of storiesToRun) {
    const result = await createStoryWorktree(prdName, story)
    results.push({ story, ...result })
  }

  // Update PRD with worktree info
  prd.parallelWorktrees = prd.parallelWorktrees || []
  for (const result of results) {
    if (result.success) {
      // Remove existing entry if present
      prd.parallelWorktrees = prd.parallelWorktrees.filter(
        w => w.storyId !== result.story.id
      )
      prd.parallelWorktrees.push({
        storyId: result.story.id,
        branch: result.branch,
        worktreePath: result.worktreePath,
        status: 'running',
        createdAt: new Date().toISOString(),
      })
    }
  }
  savePRD(prdName, prd)

  // Build output message
  const successResults = results.filter(r => r.success)
  const failedResults = results.filter(r => !r.success)

  const lines: string[] = [
    `🚀 Parallel Execution Setup for "${prd.project}"`,
    `   Base branch: ${baseBranch}`,
    '',
  ]

  if (successResults.length > 0) {
    lines.push('✅ Created worktrees:')
    for (const r of successResults) {
      lines.push(`   ${r.story.id}: ${r.story.title}`)
      lines.push(`      Path: ${r.worktreePath}`)
      lines.push(`      Branch: ${r.branch}`)
    }
    lines.push('')
    lines.push('📝 To work on each story, open a new terminal and run:')
    lines.push('')
    for (const r of successResults) {
      lines.push(`   # ${r.story.id}: ${r.story.title}`)
      lines.push(`   cd ${r.worktreePath} && codebuff`)
      lines.push(`   # Then run: /ralph run ${prdName}`)
      lines.push('')
    }
  }

  if (failedResults.length > 0) {
    lines.push('')
    lines.push('❌ Failed to create worktrees:')
    for (const r of failedResults) {
      lines.push(`   ${r.story.id}: ${r.error}`)
    }
  }

  lines.push('')
  lines.push('When done, run: /ralph merge ' + prdName)

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

export async function handleRalphMerge(prdName: string): Promise<{
  postUserMessage: PostUserMessageFn
}> {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name.\n\n' +
        'Usage: /ralph merge <prd-name>'
      ),
    ]
    return { postUserMessage }
  }

  const prd = loadPRD(prdName)
  if (!prd) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }

  if (!prd.parallelWorktrees || prd.parallelWorktrees.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        `❌ No parallel worktrees found for "${prdName}".\n\n` +
        'Use /ralph parallel to create worktrees first.'
      ),
    ]
    return { postUserMessage }
  }

  const baseBranch = await getCurrentBranch()
  const runningWorktrees = prd.parallelWorktrees.filter(w => w.status === 'running')

  if (runningWorktrees.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('✅ All worktrees have already been merged.'),
    ]
    return { postUserMessage }
  }

  const lines: string[] = [
    `🔀 Merging parallel branches for "${prd.project}"`,
    `   Base branch: ${baseBranch}`,
    '',
  ]

  const mergeResults: Array<{
    worktree: ParallelWorktree
    hasCommit: boolean
    merged: boolean
    hasConflicts?: boolean
    error?: string
  }> = []

  // Check and merge each branch
  for (const worktree of runningWorktrees) {
    const hasCommit = await checkBranchHasStoryCommit(
      worktree.branch,
      worktree.storyId,
      baseBranch,
    )

    if (!hasCommit) {
      mergeResults.push({ worktree, hasCommit: false, merged: false })
      continue
    }

    const mergeResult = await mergeBranch(worktree.branch, baseBranch)
    mergeResults.push({
      worktree,
      hasCommit: true,
      merged: mergeResult.success,
      hasConflicts: mergeResult.hasConflicts,
      error: mergeResult.error,
    })
  }

  // Process results and update PRD
  const merged: typeof mergeResults = []
  const notReady: typeof mergeResults = []
  const conflicts: typeof mergeResults = []
  const failed: typeof mergeResults = []

  for (const result of mergeResults) {
    if (!result.hasCommit) {
      notReady.push(result)
    } else if (result.merged) {
      merged.push(result)
      // Update worktree status
      const wt = prd.parallelWorktrees?.find(w => w.storyId === result.worktree.storyId)
      if (wt) wt.status = 'merged'
      // Mark story as complete
      const story = prd.userStories.find(s => s.id === result.worktree.storyId)
      if (story) story.passes = true
      // Clean up worktree and branch
      await cleanupStoryWorktree(prdName, result.worktree.storyId)
      await deleteBranch(result.worktree.branch)
    } else if (result.hasConflicts) {
      conflicts.push(result)
    } else {
      failed.push(result)
    }
  }

  // Remove merged worktrees from tracking
  prd.parallelWorktrees = prd.parallelWorktrees?.filter(
    w => w.status !== 'merged'
  )
  savePRD(prdName, prd)

  // Build output
  if (merged.length > 0) {
    lines.push('✅ Successfully merged:')
    for (const r of merged) {
      lines.push(`   ${r.worktree.storyId} (${r.worktree.branch})`)
    }
    lines.push('')
  }

  if (notReady.length > 0) {
    lines.push('⏳ Not ready (no story commit found):')
    for (const r of notReady) {
      lines.push(`   ${r.worktree.storyId} - work in progress`)
      lines.push(`      Expected commit message containing: ${r.worktree.storyId}`)
    }
    lines.push('')
  }

  if (conflicts.length > 0) {
    lines.push('⚠️  Merge conflicts (resolve manually):')
    for (const r of conflicts) {
      lines.push(`   ${r.worktree.storyId} (${r.worktree.branch})`)
    }
    lines.push('')
    lines.push('   To resolve conflicts:')
    lines.push(`   1. git checkout ${baseBranch}`)
    lines.push(`   2. git merge <branch> --no-commit`)
    lines.push('   3. Resolve conflicts and commit')
    lines.push('')
  }

  if (failed.length > 0) {
    lines.push('❌ Failed to merge:')
    for (const r of failed) {
      lines.push(`   ${r.worktree.storyId}: ${r.error}`)
    }
    lines.push('')
  }

  // Summary
  const remaining = prd.parallelWorktrees?.filter(w => w.status === 'running').length || 0
  if (remaining > 0) {
    lines.push(`📊 ${merged.length} merged, ${remaining} remaining`)
  } else {
    lines.push('🎉 All parallel work has been merged!')
  }

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

export async function handleRalphCleanup(prdName: string): Promise<{
  postUserMessage: PostUserMessageFn
}> {
  if (!prdName.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name.\n\n' +
        'Usage: /ralph cleanup <prd-name>'
      ),
    ]
    return { postUserMessage }
  }

  const prd = loadPRD(prdName)
  if (!prd) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }

  if (!prd.parallelWorktrees || prd.parallelWorktrees.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`No worktrees found for "${prdName}".`),
    ]
    return { postUserMessage }
  }

  const lines: string[] = [
    `🧹 Cleaning up worktrees for "${prd.project}"`,
    '',
  ]

  for (const worktree of prd.parallelWorktrees) {
    const result = await cleanupStoryWorktree(prdName, worktree.storyId)
    if (result.success) {
      lines.push(`   ✅ Removed: ${worktree.storyId}`)
      // Also delete the branch
      await deleteBranch(worktree.branch)
    } else {
      lines.push(`   ❌ Failed: ${worktree.storyId} - ${result.error}`)
    }
  }

  // Clear worktree tracking
  prd.parallelWorktrees = []
  savePRD(prdName, prd)

  lines.push('')
  lines.push('✅ Cleanup complete')

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

// ============================================================================
// Orchestra - Autonomous Parallel Execution with SDK
// ============================================================================

/** Progress callback for orchestra mode */
export type OrchestraProgressCallback = (message: string) => void

/** Default timeout for story execution (10 minutes) */
const STORY_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Checks if an error is a recoverable tool error that shouldn't stop execution.
 * These errors typically mean the agent tried to use a tool that isn't available
 * in the current environment but may have still made progress on the story.
 */
function isRecoverableToolError(errorMessage: string): boolean {
  const recoverablePatterns = [
    'AI_NoSuchToolError',
    'NoSuchToolError', 
    'unavailable tool',
    'tool not found',
    'run_file_change_hooks', // This specific tool isn't critical
  ]
  const lowerMessage = errorMessage.toLowerCase()
  return recoverablePatterns.some(pattern => 
    lowerMessage.includes(pattern.toLowerCase())
  )
}

/** Default agent mode for orchestra execution */
const DEFAULT_ORCHESTRA_MODE: AgentMode = 'DEFAULT'

/**
 * Runs a story using the CodebuffClient in a worktree directory.
 * Uses the same agent as the TUI (base2) for full tool access.
 */
async function runStoryWithClient(
  client: CodebuffClient,
  worktreePath: string,
  storyPrompt: string,
  storyId: string,
  onProgress?: OrchestraProgressCallback,
): Promise<{ success: boolean; error?: string; partialSuccess?: boolean }> {
  try {
    const progressMsg = `Running story ${storyId} in ${worktreePath}...`
    onProgress?.(progressMsg)
    logger.info({}, progressMsg)
    
    // Log that we're about to call client.run()
    logger.info({}, `[Orchestra] About to call client.run() for ${storyId}`)
    console.log(`[Orchestra] About to call client.run() for ${storyId}`)
    
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Story ${storyId} timed out after ${STORY_EXECUTION_TIMEOUT_MS / 1000}s`))
      }, STORY_EXECUTION_TIMEOUT_MS)
    })
    
    // Use the same agent as the TUI for full tool access
    const agentId = AGENT_MODE_TO_ID[DEFAULT_ORCHESTRA_MODE]
    logger.info({}, `[Orchestra] Using agent: ${agentId}`)
    
    // Race between the run and timeout
    const result = await Promise.race([
      client.run({
        agent: agentId,
        prompt: storyPrompt,
        cwd: worktreePath,
      }),
      timeoutPromise,
    ])
    
    // Check if the run resulted in an error
    if (result.output?.type === 'error') {
      const errorMsg = result.output.message
      
      // Check if this is a recoverable tool error
      // The agent may have still made progress even if a non-critical tool failed
      if (isRecoverableToolError(errorMsg)) {
        logger.warn({}, `Story ${storyId} had a tool error but may have partial progress: ${errorMsg}`)
        onProgress?.(`⚠️ ${storyId}: Tool error (checking for progress anyway)`)
        return { success: false, error: errorMsg, partialSuccess: true }
      }
      
      logger.error({}, `Story ${storyId} failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
    
    logger.info({}, `Story ${storyId} completed successfully`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    // Check if this is a recoverable tool error
    if (isRecoverableToolError(errorMessage)) {
      logger.warn({}, `Story ${storyId} threw a tool error but may have partial progress: ${errorMessage}`)
      onProgress?.(`⚠️ ${storyId}: Tool error (checking for progress anyway)`)
      return { success: false, error: errorMessage, partialSuccess: true }
    }
    
    logger.error({ error }, `Story execution failed: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Generates a conflict resolution prompt for the AI.
 */
function generateConflictResolutionPrompt(branch: string, storyId: string): string {
  return `Git merge conflicts were detected while merging branch "${branch}" for story ${storyId}.

Please resolve the merge conflicts:

1. Run \`git status\` to see which files have conflicts
2. Read the conflicting files to understand what both branches intended
3. Resolve each conflict by combining changes appropriately (don't just pick one side)
4. Remove the conflict markers (<<<<<<<, =======, >>>>>>>)
5. Run \`git add <resolved-files>\` to mark them as resolved
6. Commit with message: "Resolve merge conflicts from ${branch}"

Make sure to preserve the functionality from both branches. Test if possible.`
}

/** Timeout for conflict resolution (5 minutes) */
const CONFLICT_RESOLUTION_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Resolves merge conflicts using the CodebuffClient.
 */
async function resolveConflictsWithClient(
  client: CodebuffClient,
  cwd: string,
  branch: string,
  storyId: string,
  onProgress?: OrchestraProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  try {
    const progressMsg = `🔧 Using AI to resolve conflicts from ${branch}...`
    onProgress?.(progressMsg)
    logger.info({}, progressMsg)
    
    const prompt = generateConflictResolutionPrompt(branch, storyId)
    
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Conflict resolution timed out after ${CONFLICT_RESOLUTION_TIMEOUT_MS / 1000}s`))
      }, CONFLICT_RESOLUTION_TIMEOUT_MS)
    })
    
    // Use the same agent as the TUI for full tool access
    const agentId = AGENT_MODE_TO_ID[DEFAULT_ORCHESTRA_MODE]
    
    const result = await Promise.race([
      client.run({
        agent: agentId,
        prompt,
        cwd,
      }),
      timeoutPromise,
    ])
    
    // Check if the run resulted in an error
    if (result.output?.type === 'error') {
      return { success: false, error: result.output.message }
    }
    
    // Check if conflicts are actually resolved
    const statusResult = await runGitCommand(['status', '--porcelain'], cwd)
    const hasUnmerged = statusResult.stdout.split('\n').some(line => 
      line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD')
    )
    
    if (hasUnmerged) {
      return { success: false, error: 'Conflicts still present after resolution attempt' }
    }
    
    logger.info({}, `Conflicts resolved for ${branch}`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error({ error }, `Conflict resolution failed: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Attempts to merge a branch with automatic conflict resolution.
 */
async function mergeWithConflictResolution(
  client: CodebuffClient,
  branch: string,
  baseBranch: string,
  storyId: string,
  projectRoot: string,
  onProgress: OrchestraProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  // First checkout base branch
  const checkoutResult = await runGitCommand(['checkout', baseBranch], projectRoot)
  if (checkoutResult.exitCode !== 0) {
    return { success: false, error: `Failed to checkout ${baseBranch}: ${checkoutResult.stderr}` }
  }
  
  // Try to merge
  const mergeResult = await runGitCommand(['merge', branch, '--no-edit'], projectRoot)
  
  if (mergeResult.exitCode === 0) {
    onProgress?.(`✅ Merged ${branch} successfully`)
    return { success: true }
  }
  
  // Check if it's a conflict
  const hasConflicts = mergeResult.stderr.includes('CONFLICT') || 
                       mergeResult.stdout.includes('CONFLICT') ||
                       mergeResult.stderr.includes('Automatic merge failed')
  
  if (!hasConflicts) {
    return { success: false, error: mergeResult.stderr || 'Merge failed' }
  }
  
  onProgress?.(`⚠️ Merge conflicts detected for ${branch}, attempting AI resolution...`)
  
  // Try to resolve conflicts with AI
  const resolution = await resolveConflictsWithClient(client, projectRoot, branch, storyId, onProgress)
  
  if (!resolution.success) {
    // Abort the merge if we couldn't resolve
    await runGitCommand(['merge', '--abort'], projectRoot)
    return { success: false, error: `Failed to resolve conflicts: ${resolution.error}` }
  }
  
  onProgress?.(`✅ Conflicts resolved and merged for ${branch}`)
  return { success: true }
}

/**
 * Main orchestration function that runs stories in parallel batches using the SDK.
 */
export async function handleRalphOrchestra(
  prdName: string,
  parallelism: number = 2,
  onProgress?: OrchestraProgressCallback,
): Promise<{
  postUserMessage: PostUserMessageFn
}> {
  // IMPORTANT: Log immediately to confirm function is being called
  console.log('\n\n==========================================')
  console.log('[Orchestra] handleRalphOrchestra ENTERED')
  console.log(`[Orchestra] prdName: "${prdName}", parallelism: ${parallelism}`)
  console.log('==========================================\n')
  
  // Collect all log messages to display in final output
  const logMessages: string[] = []
  const log = (msg: string) => {
    logMessages.push(msg)
    // Also log immediately for visibility
    logger.info({}, `[Orchestra] ${msg}`)
    // Print to console for immediate user feedback
    console.log(`[Orchestra] ${msg}`)
    onProgress?.(msg)
  }
  
  log('Getting SDK client...')
  
  // Get the SDK client
  const client = await getCodebuffClient()
  if (!client) {
    log('Failed to get SDK client - authentication required')
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Orchestra mode requires authentication.\n\n' +
        'Please log in with `codebuff auth login` first.'
      ),
    ]
    return { postUserMessage }
  }
  
  log('SDK client obtained successfully')
  log(`PRD name: "${prdName}"`)
  
  if (!prdName.trim()) {
    log('PRD name is empty!')
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please specify a PRD name.\n\n' +
        'Usage: /ralph orchestra <prd-name> [--parallelism N]\n' +
        'Example: /ralph orchestra my-feature --parallelism 3'
      ),
    ]
    return { postUserMessage }
  }

  log(`Loading PRD: ${prdName}`)
  let prd = loadPRD(prdName)
  if (!prd) {
    log(`PRD not found: ${prdName}`)
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(`❌ PRD not found: ${prdName}\n\nUse /ralph list to see available PRDs.`),
    ]
    return { postUserMessage }
  }
  log(`PRD loaded: ${prd.project} with ${prd.userStories.length} stories`)

  const projectRoot = getProjectRoot()
  log(`Project root: ${projectRoot}`)
  const baseBranch = await getCurrentBranch()
  const outputLines: string[] = [
    `🎭 Orchestra Mode: "${prd.project}"`,
    `   Base branch: ${baseBranch}`,
    `   Parallelism: ${parallelism}`,
    '',
  ]
  
  log(`🎭 Starting Orchestra for "${prd.project}" with parallelism ${parallelism}`)

  // Process stories in batches until all complete
  let batchNumber = 0
  while (true) {
    // Reload PRD to get latest status
    prd = loadPRD(prdName)
    if (!prd) break
    
    // Get pending stories sorted by priority
    const pendingStories = prd.userStories
      .filter(s => !s.passes)
      .sort((a, b) => a.priority - b.priority)
    
    if (pendingStories.length === 0) {
      log('🎉 All stories complete!')
      outputLines.push('🎉 All stories complete!')
      break
    }
    
    batchNumber++
    const batch = pendingStories.slice(0, parallelism)
    const completedCount = prd.userStories.filter(s => s.passes).length
    const totalCount = prd.userStories.length
    
    log(`\n📦 Batch ${batchNumber}: ${batch.map(s => s.id).join(', ')} (${completedCount}/${totalCount} done)`)
    outputLines.push(`📦 Batch ${batchNumber}: ${batch.map(s => s.id).join(', ')}`)
    
    // Phase 1: Create worktrees for this batch
    log('Creating worktrees...')
    const worktreeResults: Array<{
      story: UserStory
      worktreePath: string
      branch: string
      createSuccess: boolean
      error?: string
    }> = []
    
    for (const story of batch) {
      log(`   Creating worktree for ${story.id}...`)
      const result = await createStoryWorktree(prdName, story)
      worktreeResults.push({
        story,
        worktreePath: result.worktreePath,
        branch: result.branch,
        createSuccess: result.success,
        error: result.error,
      })
      
      if (result.success) {
        log(`   ✓ Created worktree for ${story.id} at ${result.worktreePath}`)
      } else {
        log(`   ✗ Failed to create worktree for ${story.id}: ${result.error}`)
        outputLines.push(`   ✗ ${story.id}: ${result.error}`)
      }
    }
    
    const successfulWorktrees = worktreeResults.filter(r => r.createSuccess)
    
    if (successfulWorktrees.length === 0) {
      log('❌ Failed to create any worktrees in this batch')
      outputLines.push('   ❌ Failed to create worktrees')
      break
    }
    
    // Phase 2: Run stories in parallel using the SDK client
    log('\nRunning stories in parallel...')
    
    // Generate prompts for each story
    const storyPrompts = new Map<string, string>()
    for (const { story } of successfulWorktrees) {
      // Reload PRD to get current state
      const currentPrd = loadPRD(prdName)
      if (currentPrd) {
        const prompt = generateStoryExecutionPrompt(currentPrd, story, prdName)
        storyPrompts.set(story.id, prompt)
      }
    }
    
    // Run all stories in parallel
    const runPromises = successfulWorktrees.map(async ({ story, worktreePath }) => {
      const prompt = storyPrompts.get(story.id)
      if (!prompt) {
        return { story, success: false, error: 'No prompt generated' }
      }
      
      log(`   🚀 Starting ${story.id}: ${story.title}`)
      const result = await runStoryWithClient(client, worktreePath, prompt, story.id, log)
      
      if (result.success) {
        log(`   ✅ Completed ${story.id}`)
      } else {
        log(`   ❌ Failed ${story.id}: ${result.error}`)
      }
      
      return { story, ...result }
    })
    
    await Promise.all(runPromises)
    
    // Phase 3: Check for commits and merge completed work
    log('\nMerging completed work...')
    
    for (const { story } of successfulWorktrees) {
      const branch = getStoryBranchName(prdName, story.id)
      
      // Check if the branch has a commit with the story ID
      const hasCommit = await checkBranchHasStoryCommit(branch, story.id, baseBranch)
      
      if (!hasCommit) {
        log(`   ⏳ ${story.id}: No completion commit found, skipping merge`)
        continue
      }
      
      // Try to merge with automatic conflict resolution
      const mergeResult = await mergeWithConflictResolution(
        client,
        branch,
        baseBranch,
        story.id,
        projectRoot,
        log,
      )
      
      if (mergeResult.success) {
        // Mark story as complete
        const updatedPrd = loadPRD(prdName)
        if (updatedPrd) {
          const storyToMark = updatedPrd.userStories.find(s => s.id === story.id)
          if (storyToMark) {
            storyToMark.passes = true
            savePRD(prdName, updatedPrd)
          }
        }
        
        // Clean up worktree and branch
        await cleanupStoryWorktree(prdName, story.id)
        await deleteBranch(branch)
        
        log(`   ✅ ${story.id}: Merged and cleaned up`)
        outputLines.push(`   ✅ ${story.id}: Complete`)
      } else {
        log(`   ❌ ${story.id}: Merge failed - ${mergeResult.error}`)
        outputLines.push(`   ❌ ${story.id}: ${mergeResult.error}`)
        
        // Clean up the failed worktree
        await cleanupStoryWorktree(prdName, story.id)
      }
    }
    
    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  // Final summary
  const finalPrd = loadPRD(prdName)
  if (finalPrd) {
    const completedCount = finalPrd.userStories.filter(s => s.passes).length
    const totalCount = finalPrd.userStories.length
    outputLines.push('')
    outputLines.push(`📊 Final: ${completedCount}/${totalCount} stories complete`)
    
    if (completedCount === totalCount) {
      outputLines.push('🎉 All done! PRD fully implemented.')
    } else {
      const remaining = finalPrd.userStories.filter(s => !s.passes).map(s => s.id)
      outputLines.push(`⚠️  Remaining: ${remaining.join(', ')}`)
    }
  }
  
  // Include debug log messages in output
  if (logMessages.length > 0) {
    outputLines.push('')
    outputLines.push('Debug log:')
    outputLines.push(...logMessages.map(m => `  ${m}`))
  }
  
  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(outputLines.join('\n')),
  ]

  return { postUserMessage }
}

// ============================================================================
// Handoff - Create PRD from chat history
// ============================================================================

export function handleRalphHandoff(): {
  postUserMessage: PostUserMessageFn
  prdPrompt?: string
} {
  const { messages } = useChatStore.getState()

  if (messages.length === 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ No conversation to create PRD from.\n\n' +
        'Start a conversation about the feature you want to build, then use /ralph handoff.'
      ),
    ]
    return { postUserMessage }
  }

  // Extract conversation text
  const conversationText = extractConversationText(messages)

  if (!conversationText.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ No meaningful content to create PRD from.\n\n' +
        'Have a conversation about the feature first, then use /ralph handoff.'
      ),
    ]
    return { postUserMessage }
  }

  // Generate the PRD creation prompt with conversation context
  const prdPrompt = generatePrdFromConversationPrompt(conversationText)

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getUserMessage('/ralph handoff'),
  ]

  return { postUserMessage, prdPrompt }
}

// ============================================================================
// Main Command Router
// ============================================================================

export function handleRalphCommand(args: string): {
  postUserMessage: PostUserMessageFn
  prompt?: string
  prdName?: string
  storyId?: string
  asyncHandler?: () => Promise<{ postUserMessage: PostUserMessageFn }>
} {
  const trimmedArgs = args.trim()
  const [subcommand, ...rest] = trimmedArgs.split(/\s+/)
  const restArgs = rest.join(' ')

  switch (subcommand?.toLowerCase()) {
    case '':
    case undefined:
    case 'list':
      return handleRalphList()
    
    case 'status':
      return handleRalphStatus(restArgs || undefined)
    
    case 'handoff': {
      const handoffResult = handleRalphHandoff()
      return {
        postUserMessage: handoffResult.postUserMessage,
        prompt: handoffResult.prdPrompt,
      }
    }
    
    case 'new': {
      // Support syntax: /ralph new <name> [description] [-- <initial prompt>]
      const [mainPart, ...promptParts] = restArgs.split(' -- ')
      const initialPrompt = promptParts.join(' -- ').trim() || undefined
      
      // First word is the PRD name, rest is optional feature description
      const words = mainPart.trim().split(/\s+/)
      const prdName = words[0] || ''
      const featureDescription = words.slice(1).join(' ').trim() || undefined
      
      const newResult = handleRalphNew(prdName, featureDescription, initialPrompt)
      return {
        postUserMessage: newResult.postUserMessage,
        prompt: newResult.prdPrompt,
      }
    }
    
    case 'run': {
      const runResult = handleRalphRun(restArgs)
      return {
        postUserMessage: runResult.postUserMessage,
        prompt: runResult.storyPrompt,
        prdName: runResult.prdName,
        storyId: runResult.storyId,
      }
    }
    
    case 'parallel': {
      // /ralph parallel <prd-name> [story-ids...]
      const [prdName, ...storyIds] = restArgs.split(/\s+/).filter(Boolean)
      // Return placeholder and async handler
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(`⏳ Setting up parallel execution for "${prdName}"...`),
      ]
      return {
        postUserMessage,
        asyncHandler: () => handleRalphParallel(prdName || '', storyIds),
      }
    }
    
    case 'merge': {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(`⏳ Merging parallel branches for "${restArgs}"...`),
      ]
      return {
        postUserMessage,
        asyncHandler: () => handleRalphMerge(restArgs),
      }
    }
    
    case 'cleanup': {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(`⏳ Cleaning up worktrees for "${restArgs}"...`),
      ]
      return {
        postUserMessage,
        asyncHandler: () => handleRalphCleanup(restArgs),
      }
    }
    
    case 'orchestra': {
      // Parse: /ralph orchestra <prd-name> [--parallelism N]
      const orchestraArgs = restArgs.split(/\s+/).filter(Boolean)
      const prdNameArg = orchestraArgs[0] || ''
      let parallelism = 2 // default
      
      const parallelismIndex = orchestraArgs.findIndex(a => a === '--parallelism' || a === '-p')
      if (parallelismIndex >= 0 && orchestraArgs[parallelismIndex + 1]) {
        const parsed = parseInt(orchestraArgs[parallelismIndex + 1], 10)
        if (!isNaN(parsed) && parsed > 0 && parsed <= 10) {
          parallelism = parsed
        }
      }
      
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(
          `🎭 Starting Orchestra mode for "${prdNameArg}"...\n` +
          `   Parallelism: ${parallelism}\n` +
          `   This will run autonomously until all stories are complete.`
        ),
      ]
      return {
        postUserMessage,
        asyncHandler: () => handleRalphOrchestra(prdNameArg, parallelism),
      }
    }
    
    case 'edit': {
      const editResult = handleRalphEdit(restArgs)
      return {
        postUserMessage: editResult.postUserMessage,
        prompt: editResult.editPrompt,
      }
    }
    
    case 'delete':
      return handleRalphDelete(restArgs)
    
    case 'help':
    case '-h':
    case '--help':
      return handleRalphHelp()
    
    default: {
      // Treat as "new" with the first word as PRD name, rest as description
      // Support syntax: /ralph <name> [description] [-- <initial prompt>]
      const [mainPart, ...promptParts] = trimmedArgs.split(' -- ')
      const initialPrompt = promptParts.join(' -- ').trim() || undefined
      
      const words = mainPart.trim().split(/\s+/)
      const prdName = words[0] || ''
      const featureDescription = words.slice(1).join(' ').trim() || undefined
      
      const defaultResult = handleRalphNew(prdName, featureDescription, initialPrompt)
      return {
        postUserMessage: defaultResult.postUserMessage,
        prompt: defaultResult.prdPrompt,
      }
    }
  }
}
