import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'

import type { PRD } from '../ralph'
import type { ChatMessage } from '../../types/chat'

// Import the functions we're testing
import {
  getNextStory,
  handleRalphHelp,
  listPRDs,
  loadPRD,
  savePRD,
  deletePRD,
  markStoryComplete,
  appendProgress,
  handleRalphList,
  handleRalphStatus,
  handleRalphNew,
  handleRalphRun,
  handleRalphDelete,
  handleRalphEdit,
  handleRalphCommand,
} from '../ralph'
import { setProjectRoot } from '../../project-files'

/** Helper to extract text content from ChatMessages */
const getMessageText = (messages: ChatMessage[]): string => {
  return messages
    .map((m) => {
      if (typeof m.content === 'string') {
        return m.content
      }
      return ''
    })
    .join('')
}

describe('ralph command', () => {
  const samplePRD: PRD = {
    project: 'Test Project',
    branchName: 'feature/test',
    description: 'A test PRD for unit testing',
    userStories: [
      {
        id: 'US-001',
        title: 'First story',
        description: 'As a user, I want to do something',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        priority: 1,
        passes: false,
        notes: '',
      },
      {
        id: 'US-002',
        title: 'Second story',
        description: 'As a user, I want to do another thing',
        acceptanceCriteria: ['Criterion A'],
        priority: 2,
        passes: false,
        notes: 'Some notes',
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }

  describe('getNextStory', () => {
    test('returns null when all stories are complete', () => {
      const completedPRD: PRD = {
        ...samplePRD,
        userStories: samplePRD.userStories.map((s) => ({ ...s, passes: true })),
      }

      const result = getNextStory(completedPRD)

      expect(result).toBeNull()
    })

    test('returns highest priority incomplete story', () => {
      const prd: PRD = {
        ...samplePRD,
        userStories: [
          { ...samplePRD.userStories[0]!, priority: 3, passes: false },
          { ...samplePRD.userStories[1]!, priority: 1, passes: false },
        ],
      }

      const result = getNextStory(prd)

      expect(result?.priority).toBe(1)
      expect(result?.id).toBe('US-002')
    })

    test('skips completed stories', () => {
      const prd: PRD = {
        ...samplePRD,
        userStories: [
          { ...samplePRD.userStories[0]!, priority: 1, passes: true },
          { ...samplePRD.userStories[1]!, priority: 2, passes: false },
        ],
      }

      const result = getNextStory(prd)

      expect(result?.id).toBe('US-002')
    })

    test('returns first story when multiple have same priority', () => {
      const prd: PRD = {
        ...samplePRD,
        userStories: [
          { ...samplePRD.userStories[0]!, priority: 1, passes: false },
          { ...samplePRD.userStories[1]!, priority: 1, passes: false },
        ],
      }

      const result = getNextStory(prd)

      expect(result?.id).toBe('US-001')
    })

    test('returns null for empty user stories', () => {
      const prd: PRD = {
        ...samplePRD,
        userStories: [],
      }

      const result = getNextStory(prd)

      expect(result).toBeNull()
    })
  })

  describe('handleRalphHelp', () => {
    test('shows help message with commands', () => {
      const { postUserMessage } = handleRalphHelp()
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('Ralph')
      expect(text).toContain('/ralph new')
      expect(text).toContain('/ralph list')
      expect(text).toContain('/ralph run')
      expect(text).toContain('/ralph edit')
      expect(text).toContain('/ralph delete')
      expect(text).toContain('prd/')
    })

    test('shows workflow instructions', () => {
      const { postUserMessage } = handleRalphHelp()
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('Workflow')
      expect(text).toContain('clarifying questions')
    })
  })

  describe('PRD structure validation', () => {
    test('PRD has required fields', () => {
      expect(samplePRD.project).toBeDefined()
      expect(samplePRD.description).toBeDefined()
      expect(samplePRD.userStories).toBeDefined()
      expect(Array.isArray(samplePRD.userStories)).toBe(true)
      expect(samplePRD.createdAt).toBeDefined()
      expect(samplePRD.updatedAt).toBeDefined()
    })

    test('UserStory has required fields', () => {
      const story = samplePRD.userStories[0]!
      expect(story.id).toBeDefined()
      expect(story.title).toBeDefined()
      expect(story.description).toBeDefined()
      expect(story.acceptanceCriteria).toBeDefined()
      expect(Array.isArray(story.acceptanceCriteria)).toBe(true)
      expect(typeof story.priority).toBe('number')
      expect(typeof story.passes).toBe('boolean')
    })

    test('branchName is optional', () => {
      const prdWithoutBranch: PRD = {
        ...samplePRD,
        branchName: undefined,
      }
      expect(prdWithoutBranch.branchName).toBeUndefined()
    })
  })
})

// Integration tests using actual ralph functions with a temp directory
describe('ralph file operations (integration)', () => {
  let tempDir: string
  let originalCwd: string

  const samplePRD: PRD = {
    project: 'Test Project',
    branchName: 'feature/test',
    description: 'A test PRD for unit testing',
    userStories: [
      {
        id: 'US-001',
        title: 'First story',
        description: 'As a user, I want to do something',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        priority: 1,
        passes: false,
        notes: '',
      },
      {
        id: 'US-002',
        title: 'Second story',
        description: 'As a user, I want to do another thing',
        acceptanceCriteria: ['Criterion A'],
        priority: 2,
        passes: false,
        notes: 'Some notes',
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
    
    // Set project root to temp directory so ralph functions work
    setProjectRoot(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('listPRDs', () => {
    test('returns empty array when prd directory does not exist', () => {
      const result = listPRDs()
      expect(result).toEqual([])
    })

    test('returns empty array when prd directory is empty', () => {
      fs.mkdirSync(path.join(tempDir, 'prd'), { recursive: true })
      const result = listPRDs()
      expect(result).toEqual([])
    })

    test('returns PRD summaries for valid JSON files', () => {
      // Save two PRDs using savePRD
      savePRD('auth-system', { ...samplePRD, project: 'Auth System' })
      savePRD('task-manager', { ...samplePRD, project: 'Task Manager' })

      const result = listPRDs()

      expect(result.length).toBe(2)
      // Should be sorted alphabetically
      expect(result[0]?.name).toBe('auth-system')
      expect(result[1]?.name).toBe('task-manager')
      expect(result[0]?.project).toBe('Auth System')
      expect(result[0]?.totalStories).toBe(2)
      expect(result[0]?.completedStories).toBe(0)
    })

    test('filters out non-JSON files', () => {
      savePRD('valid-prd', samplePRD)
      // Create a non-JSON file in the prd directory
      fs.writeFileSync(path.join(tempDir, 'prd', 'readme.md'), '# PRDs')
      fs.writeFileSync(path.join(tempDir, 'prd', 'notes.txt'), 'Some notes')

      const result = listPRDs()

      expect(result.length).toBe(1)
      expect(result[0]?.name).toBe('valid-prd')
    })

    test('skips invalid JSON files', () => {
      savePRD('valid', samplePRD)
      // Create an invalid JSON file
      fs.writeFileSync(path.join(tempDir, 'prd', 'invalid.json'), 'not valid json')

      const result = listPRDs()

      expect(result.length).toBe(1)
      expect(result[0]?.name).toBe('valid')
    })

    test('calculates completed stories correctly', () => {
      const prdWithCompleted: PRD = {
        ...samplePRD,
        userStories: [
          { ...samplePRD.userStories[0]!, passes: true },
          { ...samplePRD.userStories[1]!, passes: false },
        ],
      }
      savePRD('partial', prdWithCompleted)

      const result = listPRDs()

      expect(result[0]?.completedStories).toBe(1)
      expect(result[0]?.totalStories).toBe(2)
    })
  })

  describe('loadPRD', () => {
    test('returns null when file does not exist', () => {
      const result = loadPRD('nonexistent')
      expect(result).toBeNull()
    })

    test('returns PRD when file exists', () => {
      savePRD('test', samplePRD)

      const result = loadPRD('test')

      expect(result).not.toBeNull()
      expect(result?.project).toBe('Test Project')
      expect(result?.userStories.length).toBe(2)
    })

    test('returns null for invalid JSON', () => {
      fs.mkdirSync(path.join(tempDir, 'prd'), { recursive: true })
      fs.writeFileSync(path.join(tempDir, 'prd', 'invalid.json'), 'not json')

      const result = loadPRD('invalid')

      expect(result).toBeNull()
    })
  })

  describe('savePRD', () => {
    test('creates prd directory if it does not exist', () => {
      expect(fs.existsSync(path.join(tempDir, 'prd'))).toBe(false)

      savePRD('test', samplePRD)

      expect(fs.existsSync(path.join(tempDir, 'prd'))).toBe(true)
    })

    test('writes PRD to correct file path', () => {
      savePRD('my-feature', samplePRD)

      expect(fs.existsSync(path.join(tempDir, 'prd', 'my-feature.json'))).toBe(true)
    })

    test('updates updatedAt timestamp', async () => {
      const originalDate = samplePRD.updatedAt

      // Wait a tiny bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 5))
      
      savePRD('test', { ...samplePRD })
      const loaded = loadPRD('test')

      expect(loaded?.updatedAt).not.toBe(originalDate)
    })

    test('preserves all PRD fields', () => {
      savePRD('test', samplePRD)
      const loaded = loadPRD('test')

      expect(loaded?.project).toBe(samplePRD.project)
      expect(loaded?.branchName).toBe(samplePRD.branchName)
      expect(loaded?.description).toBe(samplePRD.description)
      expect(loaded?.userStories.length).toBe(samplePRD.userStories.length)
      expect(loaded?.userStories[0]?.id).toBe(samplePRD.userStories[0]?.id)
    })

    test('can overwrite existing PRD', () => {
      savePRD('test', samplePRD)
      savePRD('test', { ...samplePRD, project: 'Updated Project' })

      const loaded = loadPRD('test')
      expect(loaded?.project).toBe('Updated Project')
    })
  })

  describe('deletePRD', () => {
    test('returns false when file does not exist', () => {
      const result = deletePRD('nonexistent')
      expect(result).toBe(false)
    })

    test('deletes file and returns true when file exists', () => {
      savePRD('to-delete', samplePRD)
      expect(fs.existsSync(path.join(tempDir, 'prd', 'to-delete.json'))).toBe(true)

      const result = deletePRD('to-delete')

      expect(result).toBe(true)
      expect(fs.existsSync(path.join(tempDir, 'prd', 'to-delete.json'))).toBe(false)
    })

    test('does not affect other PRD files', () => {
      savePRD('keep-me', samplePRD)
      savePRD('delete-me', samplePRD)

      deletePRD('delete-me')

      expect(loadPRD('keep-me')).not.toBeNull()
      expect(loadPRD('delete-me')).toBeNull()
    })
  })

  describe('markStoryComplete', () => {
    test('returns false when PRD does not exist', () => {
      const result = markStoryComplete('nonexistent', 'US-001')
      expect(result).toBe(false)
    })

    test('returns false when story does not exist', () => {
      savePRD('test', samplePRD)

      const result = markStoryComplete('test', 'US-999')

      expect(result).toBe(false)
    })

    test('marks story as complete and saves PRD', () => {
      savePRD('test', samplePRD)

      const result = markStoryComplete('test', 'US-001')

      expect(result).toBe(true)
      const loaded = loadPRD('test')
      expect(loaded?.userStories[0]?.passes).toBe(true)
      expect(loaded?.userStories[1]?.passes).toBe(false)
    })

    test('can mark multiple stories complete', () => {
      savePRD('test', samplePRD)

      markStoryComplete('test', 'US-001')
      markStoryComplete('test', 'US-002')

      const loaded = loadPRD('test')
      expect(loaded?.userStories[0]?.passes).toBe(true)
      expect(loaded?.userStories[1]?.passes).toBe(true)
    })
  })

  describe('appendProgress', () => {
    test('creates progress directory if it does not exist', () => {
      expect(fs.existsSync(path.join(tempDir, 'prd', 'progress'))).toBe(false)

      appendProgress('test', 'First entry')

      expect(fs.existsSync(path.join(tempDir, 'prd', 'progress'))).toBe(true)
    })

    test('appends content to progress file', () => {
      appendProgress('my-prd', 'Entry 1')
      appendProgress('my-prd', 'Entry 2')

      const content = fs.readFileSync(
        path.join(tempDir, 'prd', 'progress', 'my-prd.txt'),
        'utf-8'
      )
      expect(content).toContain('Entry 1')
      expect(content).toContain('Entry 2')
    })

    test('includes timestamp in progress entries', () => {
      appendProgress('test', 'Some content')

      const content = fs.readFileSync(
        path.join(tempDir, 'prd', 'progress', 'test.txt'),
        'utf-8'
      )
      // Should contain ISO timestamp pattern
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })
})

// Integration tests for command handlers
describe('ralph command handlers (integration)', () => {
  let tempDir: string
  let originalCwd: string

  const samplePRD: PRD = {
    project: 'Test Project',
    branchName: 'feature/test',
    description: 'A test PRD for unit testing',
    userStories: [
      {
        id: 'US-001',
        title: 'First story',
        description: 'As a user, I want to do something',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        priority: 1,
        passes: false,
        notes: '',
      },
      {
        id: 'US-002',
        title: 'Second story',
        description: 'As a user, I want to do another thing',
        acceptanceCriteria: ['Criterion A'],
        priority: 2,
        passes: false,
        notes: 'Some notes',
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-cmd-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
    setProjectRoot(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('handleRalphList', () => {
    test('shows message when no PRDs exist', () => {
      const { postUserMessage } = handleRalphList()
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('No PRDs found')
      expect(text).toContain('/ralph new')
    })

    test('lists existing PRDs with status', () => {
      savePRD('auth', { ...samplePRD, project: 'Auth System' })
      savePRD('tasks', { ...samplePRD, project: 'Task Manager' })

      const { postUserMessage } = handleRalphList()
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('PRDs')
      expect(text).toContain('auth')
      expect(text).toContain('tasks')
      expect(text).toContain('0/2')
    })

    test('shows checkmark for completed PRDs', () => {
      const completedPRD: PRD = {
        ...samplePRD,
        userStories: samplePRD.userStories.map((s) => ({ ...s, passes: true })),
      }
      savePRD('done', completedPRD)

      const { postUserMessage } = handleRalphList()
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('✅')
    })
  })

  describe('handleRalphStatus', () => {
    test('shows error when PRD not found', () => {
      const { postUserMessage } = handleRalphStatus('nonexistent')
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('PRD not found')
      expect(text).toContain('nonexistent')
    })

    test('shows detailed status for existing PRD', () => {
      savePRD('test', samplePRD)

      const { postUserMessage } = handleRalphStatus('test')
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('Test Project')
      expect(text).toContain('0/2 stories complete')
      expect(text).toContain('US-001')
      expect(text).toContain('US-002')
      expect(text).toContain('feature/test')
    })

    test('shows next story when not all complete', () => {
      savePRD('test', samplePRD)

      const { postUserMessage } = handleRalphStatus('test')
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('Next up: US-001')
    })

    test('shows completion message when all stories done', () => {
      const completedPRD: PRD = {
        ...samplePRD,
        userStories: samplePRD.userStories.map((s) => ({ ...s, passes: true })),
      }
      savePRD('test', completedPRD)

      const { postUserMessage } = handleRalphStatus('test')
      const messages = postUserMessage([])
      const text = getMessageText(messages)

      expect(text).toContain('All stories complete')
    })
  })

  describe('handleRalphNew', () => {
    test('shows error when no name provided', () => {
      const { postUserMessage, prdPrompt } = handleRalphNew('')

      expect(prdPrompt).toBeUndefined()
      const messages = postUserMessage([])
      expect(getMessageText(messages)).toContain('Please provide a PRD name')
    })

    test('generates PRD creation prompt with name only', () => {
      const { prdPrompt } = handleRalphNew('auth-feature')

      expect(prdPrompt).toBeDefined()
      expect(prdPrompt).toContain('auth-feature')
      expect(prdPrompt).toContain('clarifying questions')
      expect(prdPrompt).toContain('userStories')
    })

    test('generates PRD creation prompt with name and description', () => {
      const { prdPrompt } = handleRalphNew('auth', 'Add user authentication')

      expect(prdPrompt).toBeDefined()
      expect(prdPrompt).toContain('Add user authentication')
      expect(prdPrompt).toContain('prd/auth.json')
      expect(prdPrompt).toContain('clarifying questions')
      expect(prdPrompt).toContain('userStories')
    })

    test('includes slugified filename in prompt', () => {
      const { prdPrompt } = handleRalphNew('My Feature Name!')

      expect(prdPrompt).toContain('prd/my-feature-name.json')
    })
  })

  describe('handleRalphRun', () => {
    test('shows error when no PRD name provided', () => {
      const { postUserMessage, storyPrompt } = handleRalphRun('')

      expect(storyPrompt).toBeUndefined()
      const messages = postUserMessage([])
      expect(getMessageText(messages)).toContain('Please specify a PRD name')
    })

    test('shows error when PRD not found', () => {
      const { postUserMessage, storyPrompt } = handleRalphRun('nonexistent')

      expect(storyPrompt).toBeUndefined()
      const messages = postUserMessage([])
      expect(getMessageText(messages)).toContain('PRD not found')
    })

    test('shows completion message when all stories done', () => {
      const completedPRD: PRD = {
        ...samplePRD,
        userStories: samplePRD.userStories.map((s) => ({ ...s, passes: true })),
      }
      savePRD('test', completedPRD)

      const { postUserMessage, storyPrompt } = handleRalphRun('test')

      expect(storyPrompt).toBeUndefined()
      const messages = postUserMessage([])
      expect(getMessageText(messages)).toContain('All stories')
      expect(getMessageText(messages)).toContain('complete')
    })

    test('generates story execution prompt for next story', () => {
      savePRD('test', samplePRD)

      const { storyPrompt, prdName, storyId } = handleRalphRun('test')

      expect(storyPrompt).toBeDefined()
      expect(storyPrompt).toContain('US-001')
      expect(storyPrompt).toContain('First story')
      expect(storyPrompt).toContain('Criterion 1')
      expect(prdName).toBe('test')
      expect(storyId).toBe('US-001')
    })

    test('shows progress in startup message', () => {
      savePRD('test', samplePRD)

      const { postUserMessage } = handleRalphRun('test')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('Starting Ralph')
      expect(getMessageText(messages)).toContain('Story 1/2')
    })
  })

  describe('handleRalphDelete', () => {
    test('shows error when no PRD name provided', () => {
      const { postUserMessage } = handleRalphDelete('')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('Please specify a PRD name to delete')
    })

    test('shows error when PRD not found', () => {
      const { postUserMessage } = handleRalphDelete('nonexistent')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('PRD not found')
    })

    test('confirms deletion when successful', () => {
      savePRD('to-delete', samplePRD)

      const { postUserMessage } = handleRalphDelete('to-delete')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('Deleted PRD: to-delete')
      expect(loadPRD('to-delete')).toBeNull()
    })
  })

  describe('handleRalphEdit', () => {
    test('shows error when no PRD name provided', () => {
      const { postUserMessage, editPrompt } = handleRalphEdit('')

      expect(editPrompt).toBeUndefined()
      const messages = postUserMessage([])
      expect(getMessageText(messages)).toContain('Please specify a PRD name to edit')
    })

    test('shows error when PRD not found', () => {
      const { postUserMessage, editPrompt } = handleRalphEdit('nonexistent')

      expect(editPrompt).toBeUndefined()
      const messages = postUserMessage([])
      expect(getMessageText(messages)).toContain('PRD not found')
    })

    test('generates edit prompt with current PRD content', () => {
      savePRD('test', samplePRD)

      const { editPrompt } = handleRalphEdit('test')

      expect(editPrompt).toBeDefined()
      expect(editPrompt).toContain('prd/test.json')
      expect(editPrompt).toContain('Test Project')
      expect(editPrompt).toContain('US-001')
    })
  })

  describe('handleRalphCommand', () => {
    test('routes empty args to list', () => {
      const { postUserMessage } = handleRalphCommand('')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('No PRDs found')
    })

    test('routes "list" to list handler', () => {
      const { postUserMessage } = handleRalphCommand('list')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('No PRDs found')
    })

    test('routes "status" to status handler', () => {
      savePRD('test', samplePRD)

      const { postUserMessage } = handleRalphCommand('status test')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('Test Project')
    })

    test('routes "new" to new handler with name', () => {
      const { prompt } = handleRalphCommand('new my-feature')

      expect(prompt).toContain('my-feature')
    })

    test('routes "new" to new handler with name and description', () => {
      const { prompt } = handleRalphCommand('new auth Add user authentication')

      expect(prompt).toContain('Add user authentication')
      expect(prompt).toContain('prd/auth.json')
    })

    test('routes "run" to run handler', () => {
      savePRD('test', samplePRD)

      const { prompt, prdName, storyId } = handleRalphCommand('run test')

      expect(prompt).toContain('US-001')
      expect(prdName).toBe('test')
      expect(storyId).toBe('US-001')
    })

    test('routes "edit" to edit handler', () => {
      savePRD('test', samplePRD)

      const { prompt } = handleRalphCommand('edit test')

      expect(prompt).toContain('edit the PRD')
    })

    test('routes "delete" to delete handler', () => {
      savePRD('test', samplePRD)

      const { postUserMessage } = handleRalphCommand('delete test')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('Deleted PRD')
    })

    test('routes "help" to help handler', () => {
      const { postUserMessage } = handleRalphCommand('help')
      const messages = postUserMessage([])

      expect(getMessageText(messages)).toContain('Commands')
    })

    test('routes unknown subcommand as new with name', () => {
      const { prompt } = handleRalphCommand('auth-system')

      expect(prompt).toContain('auth-system')
      expect(prompt).toContain('clarifying questions')
    })

    test('routes unknown subcommand as new with name and description', () => {
      const { prompt } = handleRalphCommand('auth Add authentication system')

      expect(prompt).toContain('Add authentication system')
      expect(prompt).toContain('prd/auth.json')
    })

    test('handles case-insensitive subcommands', () => {
      const { postUserMessage: list1 } = handleRalphCommand('LIST')
      const { postUserMessage: list2 } = handleRalphCommand('List')

      expect(getMessageText(list1([]))).toContain('No PRDs found')
      expect(getMessageText(list2([]))).toContain('No PRDs found')
    })
  })
})
