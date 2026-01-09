import fs from 'fs'
import path from 'path'

import { getProjectRoot } from '../project-files'
import { useChatStore } from '../state/chat-store'
import { getSystemMessage, getUserMessage } from '../utils/message-history'

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

export interface PRD {
  project: string
  branchName?: string
  description: string
  userStories: UserStory[]
  createdAt: string
  updatedAt: string
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
// PRD Generation Prompt
// ============================================================================

function generatePrdCreationPrompt(featureDescription: string, initialPrompt?: string): string {
  const initialContext = initialPrompt 
    ? `\n\nThe user has provided additional context:\n"${initialPrompt}"\n\nUse this information to reduce the number of clarifying questions needed.`
    : ''

  return `You are helping create a PRD (Product Requirements Document) for autonomous development.

The user wants to build: "${featureDescription}"${initialContext}

Your task:
1. Ask 3-5 clarifying questions to understand the scope, constraints, and acceptance criteria${initialPrompt ? ' (skip questions already answered by the initial context)' : ''}
2. Use the ask_user tool to get answers
3. Based on the answers, generate a PRD with well-scoped user stories

Each user story should:
- Be small enough to complete in one context window (single focused change)
- Have clear acceptance criteria that can be verified
- Be ordered by priority (dependencies first)

After gathering requirements, create the PRD file at: prd/${slugify(featureDescription)}.json

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

  const lines = [
    `📋 PRD: ${prd.project}`,
    '',
    `Description: ${prd.description}`,
    `Progress: ${completedCount}/${totalCount} stories complete`,
    prd.branchName ? `Branch: ${prd.branchName}` : '',
    '',
    'Stories:',
    ...prd.userStories.map(s => 
      `  ${s.passes ? '✅' : '○'} [${s.priority}] ${s.id}: ${s.title}`
    ),
    '',
    nextStory 
      ? `Next up: ${nextStory.id} - ${nextStory.title}`
      : '🎉 All stories complete!',
  ].filter(Boolean)

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

export function handleRalphNew(featureDescription: string, initialPrompt?: string): {
  postUserMessage: PostUserMessageFn
  prdPrompt?: string
} {
  if (!featureDescription.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please provide a feature description.\n\n' +
        'Examples:\n' +
        '  /ralph new Add task priority system\n' +
        '  /ralph new Add auth -- use OAuth2 with Google and GitHub'
      ),
    ]
    return { postUserMessage }
  }

  // Generate the prompt for PRD creation
  const prdPrompt = generatePrdCreationPrompt(featureDescription, initialPrompt)

  const userMessageText = initialPrompt 
    ? `/ralph new ${featureDescription} -- ${initialPrompt}`
    : `/ralph new ${featureDescription}`

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
    'Commands:',
    '  /ralph              - List all PRDs (or create new)',
    '  /ralph new [desc]   - Create a new PRD interactively',
    '  /ralph new [desc] -- [context] - Create PRD with initial context',
    '  /ralph handoff      - Create PRD from current chat context',
    '  /ralph list         - List all PRDs with status',
    '  /ralph status [name]- Show detailed PRD status',
    '  /ralph run [name]   - Execute the next story in a PRD',
    '  /ralph edit [name]  - Edit an existing PRD',
    '  /ralph delete [name]- Delete a PRD',
    '',
    'Workflow:',
    '  1. /ralph new "Add user authentication"',
    '     or: /ralph new "Add auth" -- use OAuth2 with Google',
    '     or: /ralph handoff (after discussing feature in chat)',
    '     → Codebuff asks clarifying questions',
    '     → Generates PRD with user stories',
    '',
    '  2. /ralph run auth',
    '     → Executes next pending story',
    '     → Updates PRD when complete',
    '     → Repeat until all stories pass',
    '',
    'PRD files are stored in: prd/',
    'Progress logs are stored in: prd/progress/',
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
      // Support syntax: /ralph new <feature> -- <initial prompt>
      const [featureDesc, ...promptParts] = restArgs.split(' -- ')
      const initialPrompt = promptParts.join(' -- ').trim() || undefined
      const newResult = handleRalphNew(featureDesc.trim(), initialPrompt)
      return {
        postUserMessage: newResult.postUserMessage,
        prompt: newResult.prdPrompt,
      }
    }
    
    case 'run':
      const runResult = handleRalphRun(restArgs)
      return {
        postUserMessage: runResult.postUserMessage,
        prompt: runResult.storyPrompt,
        prdName: runResult.prdName,
        storyId: runResult.storyId,
      }
    
    case 'edit':
      const editResult = handleRalphEdit(restArgs)
      return {
        postUserMessage: editResult.postUserMessage,
        prompt: editResult.editPrompt,
      }
    
    case 'delete':
      return handleRalphDelete(restArgs)
    
    case 'help':
    case '-h':
    case '--help':
      return handleRalphHelp()
    
    default: {
      // Treat as "new" with the full args as feature description
      // Support syntax: /ralph <feature> -- <initial prompt>
      const [featureDesc, ...promptParts] = trimmedArgs.split(' -- ')
      const initialPrompt = promptParts.join(' -- ').trim() || undefined
      const defaultResult = handleRalphNew(featureDesc.trim(), initialPrompt)
      return {
        postUserMessage: defaultResult.postUserMessage,
        prompt: defaultResult.prdPrompt,
      }
    }
  }
}
