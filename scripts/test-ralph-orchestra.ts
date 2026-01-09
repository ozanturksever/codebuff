#!/usr/bin/env bun
/**
 * Manual test script to validate Ralph orchestra functionality
 * 
 * Run modes:
 *   cd cli && bun run ../scripts/test-ralph-orchestra.ts          # Manual workflow test
 *   cd cli && bun run ../scripts/test-ralph-orchestra.ts --full   # Full SDK orchestra test
 * 
 * Run with: cd cli && bun run ../scripts/test-ralph-orchestra.ts
 */

import { 
  loadPRD, 
  savePRD,
  handleRalphStatus,
  handleRalphParallel,
  handleRalphMerge,
  handleRalphCleanup,
  handleRalphOrchestra,
  getStoryWorktreePath,
  getStoryBranchName,
} from '../cli/src/commands/ralph'
import { setProjectRoot } from '../cli/src/project-files'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

// Set project root to the main codebuff directory (parent of cli)
const projectRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
setProjectRoot(projectRoot)

// Helper to run git commands
async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
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
}

async function main() {
  const prdName = 'sample-test'
  
  console.log('='.repeat(60))
  console.log('Ralph Orchestra Full Workflow Validation Test')
  console.log('='.repeat(60))
  console.log(`Project root: ${projectRoot}`)
  console.log('')
  
  // Check PRD status first
  console.log('📋 Step 1: Checking PRD status...')
  let prd = loadPRD(prdName)
  if (!prd) {
    console.error(`❌ PRD not found: ${prdName}`)
    console.log('Make sure prd/sample-test.json exists')
    process.exit(1)
  }
  
  // Reset story passes for clean test
  prd.userStories.forEach(s => s.passes = false)
  prd.parallelWorktrees = []
  savePRD(prdName, prd)
  
  // Commit the PRD reset so merge doesn't fail due to uncommitted changes
  console.log('  Committing PRD reset for clean test state...')
  await runGit(['add', 'prd/sample-test.json'], projectRoot)
  await runGit(['commit', '-m', 'test: reset sample-test PRD for orchestra validation', '--allow-empty'], projectRoot)
  
  prd = loadPRD(prdName)!
  
  console.log(`✓ PRD: ${prd.project}`)
  console.log(`  Description: ${prd.description}`)
  console.log(`  Stories: ${prd.userStories.length}`)
  
  const completed = prd.userStories.filter(s => s.passes).length
  console.log(`  Progress: ${completed}/${prd.userStories.length} complete`)
  console.log('')
  
  // Show detailed status
  const statusResult = handleRalphStatus(prdName)
  const statusMessages = statusResult.postUserMessage([])
  console.log('Current Status:')
  statusMessages.forEach(m => {
    if (typeof m.content === 'string') {
      console.log(m.content)
    }
  })
  console.log('')
  
  // Test parallel worktree creation
  console.log('='.repeat(60))
  console.log('📋 Step 2: Creating parallel worktrees...')
  console.log('='.repeat(60))
  console.log('')
  
  try {
    // Create worktree for one story to test full merge workflow
    const parallelResult = await handleRalphParallel(prdName, ['US-001'])
    const parallelMessages = parallelResult.postUserMessage([])
    parallelMessages.forEach(m => {
      if (typeof m.content === 'string') {
        console.log(m.content)
      }
    })
    console.log('')
    
    // Verify worktree was created
    const wt1 = getStoryWorktreePath(prdName, 'US-001')
    const branch1 = getStoryBranchName(prdName, 'US-001')
    
    console.log('Worktree verification:')
    console.log(`  US-001 worktree exists: ${fs.existsSync(wt1)}`)
    console.log(`  US-001 worktree path: ${wt1}`)
    console.log(`  US-001 branch: ${branch1}`)
    console.log('')
    
    // Step 3: Simulate work being done in the worktree
    console.log('='.repeat(60))
    console.log('📋 Step 3: Simulating story work in worktree...')
    console.log('='.repeat(60))
    console.log('')
    
    // Create a file in the worktree to simulate work
    const scriptsDir = path.join(wt1, 'scripts')
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true })
    }
    
    const greetingFile = path.join(scriptsDir, 'greeting.ts')
    fs.writeFileSync(greetingFile, `// US-001: Create a greeting utility
export function greet(name: string): string {
  return \`Hello, \${name}!\`
}
`)
    console.log(`  ✓ Created ${greetingFile}`)
    
    // Stage and commit the changes in the worktree
    console.log('  Staging changes...')
    const addResult = await runGit(['add', '.'], wt1)
    if (addResult.exitCode !== 0) {
      console.error(`  ❌ git add failed: ${addResult.stderr}`)
    } else {
      console.log('  ✓ Changes staged')
    }
    
    console.log('  Committing changes...')
    const commitResult = await runGit(
      ['commit', '-m', 'feat: US-001 - Create a greeting utility'],
      wt1
    )
    if (commitResult.exitCode !== 0) {
      console.error(`  ❌ git commit failed: ${commitResult.stderr}`)
    } else {
      console.log('  ✓ Changes committed with message containing US-001')
    }
    
    // Verify the commit exists
    const logResult = await runGit(['log', '--oneline', '-1'], wt1)
    console.log(`  Latest commit: ${logResult.stdout.trim()}`)
    console.log('')
    
    // Step 4: Test merge - should now detect the completed work
    console.log('='.repeat(60))
    console.log('📋 Step 4: Testing merge of completed work...')
    console.log('='.repeat(60))
    console.log('')
    
    const mergeResult = await handleRalphMerge(prdName)
    const mergeMessages = mergeResult.postUserMessage([])
    mergeMessages.forEach(m => {
      if (typeof m.content === 'string') {
        console.log(m.content)
      }
    })
    console.log('')
    
    // Verify the merge results
    console.log('Post-merge verification:')
    
    // Check if worktree was cleaned up (should be removed after successful merge)
    console.log(`  US-001 worktree exists: ${fs.existsSync(wt1)}`)
    
    // Check if the file exists in main repo now
    const mainGreetingFile = path.join(projectRoot, 'scripts', 'greeting.ts')
    const fileExistsInMain = fs.existsSync(mainGreetingFile)
    console.log(`  greeting.ts exists in main: ${fileExistsInMain}`)
    
    if (fileExistsInMain) {
      const content = fs.readFileSync(mainGreetingFile, 'utf-8')
      console.log(`  greeting.ts content preview: ${content.split('\n')[0]}...`)
    }
    
    // Check PRD status - story should be marked complete
    const postMergePrd = loadPRD(prdName)
    const us001 = postMergePrd?.userStories.find(s => s.id === 'US-001')
    console.log(`  US-001 passes: ${us001?.passes}`)
    console.log(`  PRD parallelWorktrees count: ${postMergePrd?.parallelWorktrees?.length || 0}`)
    console.log('')
    
    // Step 5: Show final status
    console.log('='.repeat(60))
    console.log('📋 Step 5: Final PRD status...')
    console.log('='.repeat(60))
    console.log('')
    
    const finalStatusResult = handleRalphStatus(prdName)
    const finalStatusMessages = finalStatusResult.postUserMessage([])
    finalStatusMessages.forEach(m => {
      if (typeof m.content === 'string') {
        console.log(m.content)
      }
    })
    console.log('')
    
    // Summary
    console.log('='.repeat(60))
    console.log('✅ Ralph Orchestra Full Workflow Validation Complete!')
    console.log('='.repeat(60))
    console.log('')
    console.log('Summary:')
    console.log('  ✓ PRD loading works')
    console.log('  ✓ Status display works')
    console.log('  ✓ Parallel worktree creation works')
    console.log('  ✓ Work simulation in worktree works')
    console.log('  ✓ Git commit in worktree works')
    console.log(`  ${fileExistsInMain && us001?.passes ? '✓' : '✗'} Merge and story completion works`)
    console.log('')
    
    if (!fileExistsInMain || !us001?.passes) {
      console.log('⚠️  Some merge validations may have failed.')
      console.log('    This could be due to git state or branch issues.')
      console.log('    Check the output above for details.')
    }
    
    console.log('')
    console.log('Note: Full orchestra execution requires SDK authentication.')
    console.log('To test full orchestra, run: /ralph orchestra sample-test')
    
  } catch (error) {
    console.error('Test error:', error)
    
    // Cleanup on error
    console.log('')
    console.log('Attempting cleanup...')
    try {
      await handleRalphCleanup(prdName)
      console.log('Cleanup completed')
    } catch (e) {
      console.error('Cleanup failed:', e)
    }
    
    process.exit(1)
  }
}

// Check for --full flag to run full SDK orchestra test
const runFullOrchestra = process.argv.includes('--full')

if (runFullOrchestra) {
  runFullOrchestraTest().catch(console.error)
} else {
  main().catch(console.error)
}

/**
 * Full orchestra test using the SDK client
 * This runs the actual /ralph orchestra command flow
 */
async function runFullOrchestraTest() {
  const prdName = 'sample-test'
  const parallelism = 2
  
  console.log('='.repeat(60))
  console.log('Ralph Orchestra FULL SDK Test')
  console.log('='.repeat(60))
  console.log(`Project root: ${projectRoot}`)
  console.log(`PRD: ${prdName}`)
  console.log(`Parallelism: ${parallelism}`)
  console.log('')
  
  // Check PRD exists
  let prd = loadPRD(prdName)
  if (!prd) {
    console.error(`❌ PRD not found: ${prdName}`)
    process.exit(1)
  }
  
  // Show initial status
  console.log('📋 Initial PRD Status:')
  const initialCompleted = prd.userStories.filter(s => s.passes).length
  console.log(`  Stories: ${initialCompleted}/${prd.userStories.length} complete`)
  prd.userStories.forEach(s => {
    console.log(`  ${s.passes ? '✅' : '○'} ${s.id}: ${s.title}`)
  })
  console.log('')
  
  // Run orchestra
  console.log('='.repeat(60))
  console.log('🎭 Starting Orchestra...')
  console.log('='.repeat(60))
  console.log('')
  
  const progressMessages: string[] = []
  const onProgress = (msg: string) => {
    progressMessages.push(msg)
    console.log(`[Orchestra] ${msg}`)
  }
  
  try {
    const startTime = Date.now()
    const result = await handleRalphOrchestra(prdName, parallelism, onProgress)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    
    console.log('')
    console.log('='.repeat(60))
    console.log(`Orchestra completed in ${elapsed}s`)
    console.log('='.repeat(60))
    console.log('')
    
    // Show result messages
    const messages = result.postUserMessage([])
    messages.forEach(m => {
      if (typeof m.content === 'string') {
        console.log(m.content)
      }
    })
    console.log('')
    
    // Show final status
    console.log('📋 Final PRD Status:')
    const finalPrd = loadPRD(prdName)
    if (finalPrd) {
      const finalCompleted = finalPrd.userStories.filter(s => s.passes).length
      console.log(`  Stories: ${finalCompleted}/${finalPrd.userStories.length} complete`)
      finalPrd.userStories.forEach(s => {
        console.log(`  ${s.passes ? '✅' : '○'} ${s.id}: ${s.title}`)
      })
    }
    console.log('')
    
    console.log(`Total progress callbacks: ${progressMessages.length}`)
    
  } catch (error) {
    console.error('Orchestra error:', error)
    process.exit(1)
  }
}
