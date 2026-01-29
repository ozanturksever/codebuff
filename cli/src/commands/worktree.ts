import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getSystemMessage, getUserMessage } from '../utils/message-history'

import type { PostUserMessageFn } from '../types/contracts/send-message'

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Git Utilities
// ============================================================================

async function runGitCommand(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: cwd ?? process.cwd(),
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

async function getCurrentBranch(cwd?: string): Promise<string> {
  const result = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return result.stdout.trim() || 'main'
}

async function getGitRoot(cwd?: string): Promise<string | null> {
  const result = await runGitCommand(['rev-parse', '--show-toplevel'], cwd)
  if (result.exitCode !== 0) return null
  return result.stdout.trim()
}

/**
 * Checks if the current directory is inside a git worktree (not the main repo).
 */
async function isInsideWorktree(cwd?: string): Promise<boolean> {
  const result = await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd)
  if (result.exitCode !== 0) return false
  
  // Check if this is the main worktree or a linked worktree
  const gitDirResult = await runGitCommand(['rev-parse', '--git-dir'], cwd)
  if (gitDirResult.exitCode !== 0) return false
  
  const gitDir = gitDirResult.stdout.trim()
  // If .git is a file (not a directory), we're in a worktree
  // Worktrees have .git as a file pointing to the main repo's .git/worktrees/<name>
  const gitPath = path.resolve(cwd ?? process.cwd(), gitDir)
  
  try {
    const stat = fs.statSync(gitPath)
    return stat.isFile() // Worktrees have .git as a file, main repo has it as a directory
  } catch {
    return false
  }
}

/**
 * Gets the main repository path from a worktree.
 */
async function getMainRepoPath(cwd?: string): Promise<string | null> {
  const result = await runGitCommand(['rev-parse', '--git-common-dir'], cwd)
  if (result.exitCode !== 0) return null
  
  // --git-common-dir returns the path to the main .git directory
  // We need the parent of that to get the main repo root
  const gitCommonDir = path.resolve(cwd ?? process.cwd(), result.stdout.trim())
  return path.dirname(gitCommonDir)
}

/**
 * Finds the next available port by checking existing worktree env files.
 */
function findNextAvailablePort(worktreesDir: string, basePort: number = 3001): number {
  if (!fs.existsSync(worktreesDir)) {
    return basePort
  }
  
  const usedPorts = new Set<number>()
  
  try {
    const entries = fs.readdirSync(worktreesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const envPath = path.join(worktreesDir, entry.name, '.env.development.local')
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8')
          const portMatch = content.match(/^PORT=(\d+)/m)
          if (portMatch) {
            usedPorts.add(parseInt(portMatch[1], 10))
          }
        }
      }
    }
  } catch {
    // Ignore errors reading worktrees directory
  }
  
  let port = basePort
  while (usedPorts.has(port)) {
    port++
  }
  
  return port
}

/**
 * Detects the package manager used by the project.
 */
function detectPackageManager(projectPath: string): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(projectPath, 'bun.lockb')) || 
      fs.existsSync(path.join(projectPath, 'bun.lock'))) {
    return 'bun'
  }
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
    return 'yarn'
  }
  return 'npm'
}

/**
 * Runs package manager install in a directory.
 */
async function runPackageInstall(cwd: string): Promise<{ success: boolean; error?: string }> {
  const pm = detectPackageManager(cwd)
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const proc = spawn(pm, ['install'], {
      cwd,
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
  
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Package install failed' }
  }
  
  return { success: true }
}

// ============================================================================
// Worktree Directory Structure
// ============================================================================

function getWorktreesDir(repoRoot: string): string {
  const repoName = path.basename(repoRoot)
  return path.resolve(repoRoot, '..', `${repoName}-worktrees`)
}

function getWorktreePath(repoRoot: string, name: string): string {
  return path.join(getWorktreesDir(repoRoot), name)
}

// ============================================================================
// Subcommand Handlers
// ============================================================================

export async function handleWorktreeNew(name: string): Promise<{
  postUserMessage: PostUserMessageFn
  newCwd?: string
}> {
  if (!name.trim()) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Please provide a worktree name.\n\n' +
        'Usage: /worktree new <name>\n' +
        'Example: /worktree new feature-auth'
      ),
    ]
    return { postUserMessage }
  }
  
  // Validate name
  const safeName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
  const wasSanitized = safeName !== name.trim()
  
  const gitRoot = await getGitRoot()
  if (!gitRoot) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('❌ Not inside a git repository.'),
    ]
    return { postUserMessage }
  }
  
  // If we're already in a worktree, get the main repo
  const isWorktree = await isInsideWorktree()
  const mainRepoPath = isWorktree ? await getMainRepoPath() : gitRoot
  
  if (!mainRepoPath) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('❌ Could not determine main repository path.'),
    ]
    return { postUserMessage }
  }
  
  const worktreePath = getWorktreePath(mainRepoPath, safeName)
  const worktreesDir = getWorktreesDir(mainRepoPath)
  
  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    // Just switch to it
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        `📁 Worktree "${safeName}" already exists.\n` +
        `   Switching to: ${worktreePath}`
      ),
    ]
    return { postUserMessage, newCwd: worktreePath }
  }
  
  // Create worktrees directory if needed
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true })
  }
  
  // Check if branch already exists
  const branchResult = await runGitCommand(
    ['show-ref', '--verify', '--quiet', `refs/heads/${safeName}`],
    mainRepoPath
  )
  const branchExists = branchResult.exitCode === 0
  
  // Create the worktree
  const worktreeArgs = ['worktree', 'add', worktreePath]
  if (branchExists) {
    worktreeArgs.push(safeName)
  } else {
    worktreeArgs.push('-b', safeName, 'HEAD')
  }
  
  const createResult = await runGitCommand(worktreeArgs, mainRepoPath)
  if (createResult.exitCode !== 0) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        `❌ Failed to create worktree: ${createResult.stderr || 'Unknown error'}`
      ),
    ]
    return { postUserMessage }
  }
  
  // Auto-assign port and create .env.development.local
  const port = findNextAvailablePort(worktreesDir)
  const envContent = `# Worktree-specific overrides
# Generated by /worktree new ${safeName}
PORT=${port}
NEXT_PUBLIC_WEB_PORT=${port}
`
  
  fs.writeFileSync(path.join(worktreePath, '.env.development.local'), envContent)
  
  // Run package install
  const installResult = await runPackageInstall(worktreePath)
  
  const lines: string[] = []
  
  // Include sanitization warning if name was changed
  if (wasSanitized) {
    lines.push(`⚠️ Name sanitized: "${name.trim()}" → "${safeName}"`)
    lines.push('')
  }
  
  lines.push(`✅ Created worktree "${safeName}"`)
  lines.push(`   Path: ${worktreePath}`)
  lines.push(`   Branch: ${safeName}`)
  lines.push(`   Port: ${port}`)
  lines.push('')
  
  if (!installResult.success) {
    lines.push(`⚠️ Package install failed: ${installResult.error}`)
    lines.push('   Run `npm install` (or equivalent) manually.')
  } else {
    lines.push('✅ Dependencies installed')
  }
  
  lines.push('')
  lines.push('Switching to worktree directory...')
  
  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]
  
  return { postUserMessage, newCwd: worktreePath }
}

export function handleWorktreeMerge(): {
  postUserMessage: PostUserMessageFn
  mergePrompt?: string
} {
  const mergePrompt = `Merge the current worktree branch to the main branch (usually main or master).

Please do the following:
1. Run \`git status\` to check for uncommitted changes
2. If there are uncommitted changes, commit them first with an appropriate message
3. Identify the main branch (check for \`main\` or \`master\`)
4. Push the current branch to origin if not already pushed
5. Create a pull request or merge directly to the main branch
6. Handle any merge conflicts if they arise
7. Report the result

If you encounter any issues, explain what went wrong and how to fix it.`

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getUserMessage('/worktree merge'),
  ]
  
  return { postUserMessage, mergePrompt }
}

export async function handleWorktreeRemove(): Promise<{
  postUserMessage: PostUserMessageFn
  newCwd?: string
}> {
  const isWorktree = await isInsideWorktree()
  
  if (!isWorktree) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        '❌ Not inside a worktree.\n\n' +
        'This command can only be used from within a worktree, not the main repository.'
      ),
    ]
    return { postUserMessage }
  }
  
  const currentPath = process.cwd()
  const mainRepoPath = await getMainRepoPath()
  
  if (!mainRepoPath) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage('❌ Could not determine main repository path.'),
    ]
    return { postUserMessage }
  }
  
  const currentBranch = await getCurrentBranch()
  
  // Force remove the worktree (even with uncommitted changes)
  const removeResult = await runGitCommand(
    ['worktree', 'remove', currentPath, '--force'],
    mainRepoPath
  )
  
  // Check if remove failed and directory still exists
  const directoryStillExists = fs.existsSync(currentPath)
  
  if (removeResult.exitCode !== 0 && directoryStillExists) {
    // Try to clean up directory manually
    try {
      fs.rmSync(currentPath, { recursive: true, force: true })
    } catch (cleanupError) {
      const postUserMessage: PostUserMessageFn = (prev) => [
        ...prev,
        getSystemMessage(
          `❌ Failed to remove worktree.\n` +
          `   Error: ${removeResult.stderr || 'Unknown error'}\n\n` +
          `You may need to manually remove: ${currentPath}`
        ),
      ]
      return { postUserMessage }
    }
  } else if (directoryStillExists) {
    // Git command succeeded but directory remains - clean it up
    try {
      fs.rmSync(currentPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors if git worktree remove succeeded
    }
  }
  
  // Prune worktrees
  await runGitCommand(['worktree', 'prune'], mainRepoPath)
  
  const lines = [
    `✅ Removed worktree`,
    `   Path: ${currentPath}`,
    `   Branch: ${currentBranch}`,
    '',
    'Switching back to main repository...',
  ]
  
  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]
  
  return { postUserMessage, newCwd: mainRepoPath }
}

export function handleWorktreeHelp(): {
  postUserMessage: PostUserMessageFn
} {
  const lines = [
    '📁 Worktree - Git Worktree Management',
    '',
    'Manage git worktrees for parallel development.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'COMMANDS',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /worktree                    Show this help',
    '  /worktree new <name>         Create a new worktree and switch to it',
    '  /worktree merge              Send prompt to AI to merge to main branch',
    '  /worktree remove             Force-remove current worktree, switch to main repo',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'EXAMPLES',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  /worktree new feature-auth   Create worktree for auth feature',
    '  /worktree merge              Merge current worktree to main',
    '  /worktree remove             Delete current worktree and go back',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'NOTES',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  • Worktrees are created in ../<repo-name>-worktrees/<name>',
    '  • Each worktree gets an auto-assigned port (3001, 3002, etc.)',
    '  • A .env.development.local file is created with port config',
    '  • Dependencies are installed automatically',
    '  • /worktree remove works even with uncommitted changes',
  ]
  
  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]
  
  return { postUserMessage }
}

// ============================================================================
// Main Command Router
// ============================================================================

export async function handleWorktreeCommand(args: string): Promise<{
  postUserMessage: PostUserMessageFn
  prompt?: string
  newCwd?: string
}> {
  const trimmedArgs = args.trim()
  const [subcommand, ...rest] = trimmedArgs.split(/\s+/)
  const restArgs = rest.join(' ')
  
  switch (subcommand?.toLowerCase()) {
    case '':
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      return handleWorktreeHelp()
    
    case 'new': {
      const result = await handleWorktreeNew(restArgs)
      return {
        postUserMessage: result.postUserMessage,
        newCwd: result.newCwd,
      }
    }
    
    case 'merge': {
      const result = handleWorktreeMerge()
      return {
        postUserMessage: result.postUserMessage,
        prompt: result.mergePrompt,
      }
    }
    
    case 'remove':
    case 'rm':
    case 'delete': {
      const result = await handleWorktreeRemove()
      return {
        postUserMessage: result.postUserMessage,
        newCwd: result.newCwd,
      }
    }
    
    default: {
      // Treat unknown subcommand as "new <name>"
      const result = await handleWorktreeNew(trimmedArgs)
      return {
        postUserMessage: result.postUserMessage,
        newCwd: result.newCwd,
      }
    }
  }
}
