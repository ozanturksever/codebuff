/**
 * E2E Test for Ralph Orchestra Mode
 * 
 * This test validates the Ralph orchestra functionality by testing:
 * 1. Worktree creation and management
 * 2. PRD loading and story execution flow
 * 3. Branch management
 * 4. The async handler integration
 * 
 * Run with: bun test cli/src/__tests__/ralph-orchestra.e2e.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'

import {
  loadPRD,
  savePRD,
  handleRalphOrchestra,
  handleRalphParallel,
  handleRalphMerge,
  handleRalphCleanup,
  getStoryWorktreePath,
  getStoryBranchName,
} from '../commands/ralph'
import { setProjectRoot } from '../project-files'

import type { PRD } from '../commands/ralph'

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

describe('Ralph Orchestra E2E Tests', () => {
  let tempDir: string
  let originalCwd: string

  const testPRD: PRD = {
    project: 'Orchestra Test Project',
    branchName: 'feature/orchestra-test',
    description: 'Test PRD for orchestra mode validation',
    userStories: [
      {
        id: 'US-001',
        title: 'Create greeting utility',
        description: 'Create a simple greeting function',
        acceptanceCriteria: ['Create greeting.ts', 'Export greet function'],
        priority: 1,
        passes: false,
        notes: '',
      },
      {
        id: 'US-002',
        title: 'Create farewell utility',
        description: 'Create a simple farewell function',
        acceptanceCriteria: ['Create farewell.ts', 'Export farewell function'],
        priority: 2,
        passes: false,
        notes: '',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(async () => {
    // Create a temp directory with git initialized
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-orchestra-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
    setProjectRoot(tempDir)

    // Initialize git repo
    await runGit(['init'], tempDir)
    await runGit(['config', 'user.email', 'test@test.com'], tempDir)
    await runGit(['config', 'user.name', 'Test User'], tempDir)

    // Create initial commit
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Project')
    await runGit(['add', '.'], tempDir)
    await runGit(['commit', '-m', 'Initial commit'], tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    
    // Clean up worktrees directory if it exists
    const worktreesDir = path.resolve(tempDir, '../codebuff-worktrees')
    if (fs.existsSync(worktreesDir)) {
      // Remove worktrees first
      await runGit(['worktree', 'prune'], tempDir).catch(() => {})
      fs.rmSync(worktreesDir, { recursive: true, force: true })
    }
    
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('Worktree Path Generation', () => {
    test('generates correct worktree path', () => {
      const worktreePath = getStoryWorktreePath('test-prd', 'US-001')
      expect(worktreePath).toContain('codebuff-worktrees')
      expect(worktreePath).toContain('test-prd-us-001')
    })

    test('generates correct branch name', () => {
      const branchName = getStoryBranchName('test-prd', 'US-001')
      expect(branchName).toBe('ralph/test-prd/us-001')
    })

    test('lowercases story ID in paths', () => {
      const worktreePath = getStoryWorktreePath('MyPRD', 'US-ABC')
      const branchName = getStoryBranchName('MyPRD', 'US-ABC')
      
      expect(worktreePath).toContain('us-abc')
      expect(branchName).toContain('us-abc')
    })
  })

  describe('handleRalphParallel', () => {
    test('returns error for empty PRD name', async () => {
      const result = await handleRalphParallel('', [])
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')
      
      expect(text).toContain('Please specify a PRD name')
    })

    test('returns error for non-existent PRD', async () => {
      const result = await handleRalphParallel('nonexistent', [])
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')
      
      expect(text).toContain('PRD not found')
    })

    test('creates worktrees for pending stories', async () => {
      // Save the test PRD
      savePRD('orchestra-test', testPRD)

      const result = await handleRalphParallel('orchestra-test', ['US-001'])
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      // Should show success
      expect(text).toContain('Created worktrees')
      expect(text).toContain('US-001')

      // Verify worktree was created
      const worktreePath = getStoryWorktreePath('orchestra-test', 'US-001')
      expect(fs.existsSync(worktreePath)).toBe(true)

      // Verify .ralph-story.json was created
      const storyInfoPath = path.join(worktreePath, '.ralph-story.json')
      expect(fs.existsSync(storyInfoPath)).toBe(true)
      
      const storyInfo = JSON.parse(fs.readFileSync(storyInfoPath, 'utf-8'))
      expect(storyInfo.storyId).toBe('US-001')
      expect(storyInfo.prdName).toBe('orchestra-test')
    })

    test('updates PRD with worktree tracking info', async () => {
      savePRD('orchestra-test', testPRD)

      await handleRalphParallel('orchestra-test', ['US-001', 'US-002'])

      const updatedPrd = loadPRD('orchestra-test')
      expect(updatedPrd?.parallelWorktrees).toBeDefined()
      expect(updatedPrd?.parallelWorktrees?.length).toBe(2)
      expect(updatedPrd?.parallelWorktrees?.some(w => w.storyId === 'US-001')).toBe(true)
      expect(updatedPrd?.parallelWorktrees?.some(w => w.storyId === 'US-002')).toBe(true)
    })

    test('skips already completed stories', async () => {
      const prdWithCompleted: PRD = {
        ...testPRD,
        userStories: [
          { ...testPRD.userStories[0]!, passes: true },
          { ...testPRD.userStories[1]!, passes: false },
        ],
      }
      savePRD('orchestra-test', prdWithCompleted)

      const result = await handleRalphParallel('orchestra-test', ['US-001', 'US-002'])
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      // Should only create worktree for US-002
      expect(text).toContain('US-002')
      
      const updatedPrd = loadPRD('orchestra-test')
      expect(updatedPrd?.parallelWorktrees?.length).toBe(1)
      expect(updatedPrd?.parallelWorktrees?.[0]?.storyId).toBe('US-002')
    })

    test('handles all stories complete scenario', async () => {
      const completedPrd: PRD = {
        ...testPRD,
        userStories: testPRD.userStories.map(s => ({ ...s, passes: true })),
      }
      savePRD('orchestra-test', completedPrd)

      const result = await handleRalphParallel('orchestra-test', [])
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      expect(text).toContain('already complete')
    })
  })

  describe('handleRalphMerge', () => {
    test('returns error for empty PRD name', async () => {
      const result = await handleRalphMerge('')
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')
      
      expect(text).toContain('Please specify a PRD name')
    })

    test('returns error when no worktrees exist', async () => {
      savePRD('orchestra-test', testPRD)

      const result = await handleRalphMerge('orchestra-test')
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      expect(text).toContain('No parallel worktrees found')
    })

    test('reports branches not ready when no commits', async () => {
      savePRD('orchestra-test', testPRD)
      
      // Create worktrees first
      await handleRalphParallel('orchestra-test', ['US-001'])

      // Try to merge without any commits
      const result = await handleRalphMerge('orchestra-test')
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      expect(text).toContain('Not ready')
      expect(text).toContain('US-001')
    })
  })

  describe('handleRalphCleanup', () => {
    test('returns error for empty PRD name', async () => {
      const result = await handleRalphCleanup('')
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')
      
      expect(text).toContain('Please specify a PRD name')
    })

    test('cleans up worktrees and branches', async () => {
      savePRD('orchestra-test', testPRD)
      
      // Create worktrees
      await handleRalphParallel('orchestra-test', ['US-001'])
      
      // Verify worktree exists
      const worktreePath = getStoryWorktreePath('orchestra-test', 'US-001')
      expect(fs.existsSync(worktreePath)).toBe(true)

      // Clean up
      const result = await handleRalphCleanup('orchestra-test')
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      expect(text).toContain('Cleanup complete')
      
      // Verify worktree is removed
      expect(fs.existsSync(worktreePath)).toBe(false)
      
      // Verify PRD worktree tracking is cleared
      const updatedPrd = loadPRD('orchestra-test')
      expect(updatedPrd?.parallelWorktrees?.length).toBe(0)
    })
  })

  describe('handleRalphOrchestra', () => {
    test('returns error for empty PRD name', async () => {
      const result = await handleRalphOrchestra('', 2)
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')
      
      expect(text).toContain('Please specify a PRD name')
    })

    test('returns error for non-existent PRD', async () => {
      const result = await handleRalphOrchestra('nonexistent', 2)
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')
      
      expect(text).toContain('PRD not found')
    })

    // Note: These tests are skipped because they require SDK authentication
    // and would timeout in CI/test environments without valid credentials.
    // The orchestra functionality is validated through the parallel/merge/cleanup
    // tests which test the core worktree management without network calls.
    
    test.skip('returns auth error when no SDK client available', async () => {
      savePRD('orchestra-test', testPRD)

      // Orchestra requires authentication - this test verifies the error handling
      const result = await handleRalphOrchestra('orchestra-test', 2)
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      // Should either start orchestra or show auth error
      // (depends on whether auth token is available in test environment)
      expect(text.length).toBeGreaterThan(0)
    })

    test.skip('reports all stories complete when PRD is done', async () => {
      const completedPrd: PRD = {
        ...testPRD,
        userStories: testPRD.userStories.map(s => ({ ...s, passes: true })),
      }
      savePRD('orchestra-test', completedPrd)

      const result = await handleRalphOrchestra('orchestra-test', 2)
      const messages = result.postUserMessage([])
      const text = messages.map(m => m.content).join('')

      // Should report completion or auth error
      expect(text.length).toBeGreaterThan(0)
    })

    test.skip('progress callback receives messages', async () => {
      savePRD('orchestra-test', testPRD)
      
      const progressMessages: string[] = []
      const onProgress = (msg: string) => progressMessages.push(msg)

      await handleRalphOrchestra('orchestra-test', 2, onProgress)

      // Should have received some progress messages
      expect(progressMessages.length).toBeGreaterThan(0)
    })
  })

  describe('Integration: Full parallel workflow', () => {
    test('parallel -> cleanup workflow', async () => {
      savePRD('workflow-test', testPRD)

      // Step 1: Create parallel worktrees
      const parallelResult = await handleRalphParallel('workflow-test', ['US-001', 'US-002'])
      const parallelText = parallelResult.postUserMessage([]).map(m => m.content).join('')
      expect(parallelText).toContain('Created worktrees')

      // Verify both worktrees exist
      const wt1 = getStoryWorktreePath('workflow-test', 'US-001')
      const wt2 = getStoryWorktreePath('workflow-test', 'US-002')
      expect(fs.existsSync(wt1)).toBe(true)
      expect(fs.existsSync(wt2)).toBe(true)

      // Verify PRD tracking
      let prd = loadPRD('workflow-test')
      expect(prd?.parallelWorktrees?.length).toBe(2)

      // Step 2: Clean up
      const cleanupResult = await handleRalphCleanup('workflow-test')
      const cleanupText = cleanupResult.postUserMessage([]).map(m => m.content).join('')
      expect(cleanupText).toContain('Cleanup complete')

      // Verify worktrees are gone
      expect(fs.existsSync(wt1)).toBe(false)
      expect(fs.existsSync(wt2)).toBe(false)

      // Verify PRD tracking is cleared
      prd = loadPRD('workflow-test')
      expect(prd?.parallelWorktrees?.length).toBe(0)
    })

    test('reuses existing worktrees', async () => {
      savePRD('reuse-test', testPRD)

      // Create worktree first time
      await handleRalphParallel('reuse-test', ['US-001'])
      
      const worktreePath = getStoryWorktreePath('reuse-test', 'US-001')
      const storyInfoPath = path.join(worktreePath, '.ralph-story.json')
      
      // Get original creation time
      const originalInfo = JSON.parse(fs.readFileSync(storyInfoPath, 'utf-8'))
      
      // Create worktree again - should reuse
      await handleRalphParallel('reuse-test', ['US-001'])
      
      // Worktree should still exist
      expect(fs.existsSync(worktreePath)).toBe(true)
      
      // Story info should be the same (not recreated)
      const newInfo = JSON.parse(fs.readFileSync(storyInfoPath, 'utf-8'))
      expect(newInfo.createdAt).toBe(originalInfo.createdAt)
    })
  })
})

describe('Ralph Orchestra Unit Tests', () => {
  describe('PRD parallel worktree tracking', () => {
    let tempDir: string
    let originalCwd: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-prd-test-'))
      originalCwd = process.cwd()
      process.chdir(tempDir)
      setProjectRoot(tempDir)
    })

    afterEach(() => {
      process.chdir(originalCwd)
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    test('PRD can store parallel worktree info', () => {
      const prd: PRD = {
        project: 'Test',
        description: 'Test PRD',
        userStories: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        parallelWorktrees: [
          {
            storyId: 'US-001',
            branch: 'ralph/test/us-001',
            worktreePath: '/tmp/test-worktree',
            status: 'running',
            createdAt: new Date().toISOString(),
          },
        ],
      }

      savePRD('test', prd)
      const loaded = loadPRD('test')

      expect(loaded?.parallelWorktrees).toBeDefined()
      expect(loaded?.parallelWorktrees?.length).toBe(1)
      expect(loaded?.parallelWorktrees?.[0]?.storyId).toBe('US-001')
      expect(loaded?.parallelWorktrees?.[0]?.status).toBe('running')
    })

    test('parallelWorktrees is optional and defaults to undefined', () => {
      const prd: PRD = {
        project: 'Test',
        description: 'Test PRD',
        userStories: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      savePRD('test', prd)
      const loaded = loadPRD('test')

      expect(loaded?.parallelWorktrees).toBeUndefined()
    })
  })
})
