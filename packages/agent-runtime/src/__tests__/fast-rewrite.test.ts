import path from 'path'

import { TEST_USER_ID } from '@codebuff/common/old-constants'
import { TEST_AGENT_RUNTIME_IMPL } from '@codebuff/common/testing/impl/agent-runtime'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { createPatch } from 'diff'

import { rewriteWithOpenAI } from '../fast-rewrite'

import type {
  AgentRuntimeDeps,
  AgentRuntimeScopedDeps,
} from '@codebuff/common/types/contracts/agent-runtime'

describe.skip('rewriteWithOpenAI', () => {
  let agentRuntimeImpl: AgentRuntimeDeps & AgentRuntimeScopedDeps

  beforeEach(() => {
    agentRuntimeImpl = { ...TEST_AGENT_RUNTIME_IMPL }
  })

  afterAll(() => {})

  it('should correctly integrate edit snippet changes while preserving formatting', async () => {
    const testDataDir = path.join(__dirname, 'test-data', 'dex-go')
    const originalContent = await Bun.file(`${testDataDir}/original.go`).text()
    const editSnippet = await Bun.file(`${testDataDir}/edit-snippet.go`).text()
    const expectedResult = await Bun.file(`${testDataDir}/expected.go`).text()

    const result = await rewriteWithOpenAI({
      ...agentRuntimeImpl,
      oldContent: originalContent,
      editSnippet,
      clientSessionId: 'clientSessionId',
      fingerprintId: 'fingerprintId',
      userInputId: 'userInputId',
      userId: TEST_USER_ID,
      runId: 'test-run-id',
    })

    const patch = createPatch('test.ts', expectedResult, result)
    const patchLines = patch.split('\n').slice(4)
    const linesChanged = patchLines.filter(
      (line) => line.startsWith('+') || line.startsWith('-'),
    ).length
    console.log(patch)
    expect(linesChanged).toBeLessThanOrEqual(14)
  }, 240_000)
})
