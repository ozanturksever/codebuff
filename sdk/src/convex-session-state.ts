/**
 * Convex-specific session state management.
 *
 * This module provides session state initialization for Convex environments
 * WITHOUT any tree-sitter or @codebuff/code-map dependencies.
 *
 * ## Why This Exists
 *
 * The regular run-state.ts imports from @codebuff/code-map which uses
 * web-tree-sitter (WASM-based parser). Convex's sandboxed Node.js runtime
 * doesn't support WASM modules, so we need this alternative implementation.
 *
 * ## What's Different From Standard SDK
 *
 * 1. **No Token Scoring**: We skip `getFileTokenScores()` entirely.
 *    Token scoring uses tree-sitter to parse source files and extract
 *    function/class/variable names with importance scores. In Convex,
 *    agents rely on file tree structure and explicit file reading instead.
 *
 * 2. **No File System Access**: Project files must be passed explicitly
 *    via the `projectFiles` option rather than discovered from disk.
 *
 * 3. **No Git Integration**: Git status/diff is unavailable since we can't
 *    spawn `git` commands.
 *
 * ## Compensating Features
 *
 * To help agents navigate code without token scores:
 * - System prompts include a hierarchical file tree visualization
 * - The `read_subtree` tool lets agents explore directory structure
 * - Knowledge files are auto-derived from projectFiles if not provided
 */

import { getInitialSessionState } from '@codebuff/common/types/session-state'
import z from 'zod/v4'

import type { CustomToolDefinition } from './custom-tool'
import type { AgentDefinition } from '@codebuff/common/templates/initial-agents-dir/types/agent-definition'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { CodebuffFileSystem } from '@codebuff/common/types/filesystem'
import type {
  AgentOutput,
  SessionState,
} from '@codebuff/common/types/session-state'
import type { CodebuffSpawn } from '@codebuff/common/types/spawn'
import type {
  CustomToolDefinitions,
  FileTreeNode,
} from '@codebuff/common/util/file'

export type ConvexRunState = {
  sessionState?: SessionState
  output: AgentOutput
}

// Alias for backward compatibility
export type RunState = ConvexRunState

export type ConvexInitialSessionStateOptions = {
  cwd?: string
  projectFiles?: Record<string, string>
  knowledgeFiles?: Record<string, string>
  agentDefinitions?: AgentDefinition[]
  customToolDefinitions?: CustomToolDefinition[]
  maxAgentSteps?: number
  fs?: CodebuffFileSystem
  spawn?: CodebuffSpawn
  logger?: Logger
}

/**
 * Processes agent definitions array and converts handleSteps functions to strings
 */
function processAgentDefinitions(
  agentDefinitions: AgentDefinition[],
): Record<string, any> {
  const processedAgentTemplates: Record<string, any> = {}
  agentDefinitions.forEach((definition) => {
    const processedConfig = { ...definition } as Record<string, any>
    if (
      processedConfig.handleSteps &&
      typeof processedConfig.handleSteps === 'function'
    ) {
      processedConfig.handleSteps = processedConfig.handleSteps.toString()
    }
    if (processedConfig.id) {
      processedAgentTemplates[processedConfig.id] = processedConfig
    }
  })
  return processedAgentTemplates
}

/**
 * Processes custom tool definitions into the format expected by SessionState.
 * Converts Zod schemas to JSON Schema format so they can survive JSON serialization.
 */
function processCustomToolDefinitions(
  customToolDefinitions: CustomToolDefinition[],
): CustomToolDefinitions {
  return Object.fromEntries(
    customToolDefinitions.map((toolDefinition) => {
      // Convert Zod schema to JSON Schema format so it survives JSON serialization
      const jsonSchema = z.toJSONSchema(toolDefinition.inputSchema, {
        io: 'input',
      }) as Record<string, unknown>
      delete jsonSchema['$schema']

      return [
        toolDefinition.toolName,
        {
          inputSchema: jsonSchema,
          description: toolDefinition.description,
          endsAgentStep: toolDefinition.endsAgentStep,
          exampleInputs: toolDefinition.exampleInputs,
        },
      ]
    }),
  )
}

/**
 * Builds a hierarchical file tree from a flat list of file paths
 */
function buildFileTree(filePaths: string[]): FileTreeNode[] {
  const tree: Record<string, FileTreeNode> = {}

  // Build the tree structure
  for (const filePath of filePaths) {
    const parts = filePath.split('/')

    for (let i = 0; i < parts.length; i++) {
      const currentPath = parts.slice(0, i + 1).join('/')
      const isFile = i === parts.length - 1

      if (!tree[currentPath]) {
        tree[currentPath] = {
          name: parts[i],
          type: isFile ? 'file' : 'directory',
          filePath: currentPath,
          children: isFile ? undefined : [],
        }
      }
    }
  }

  // Organize into hierarchical structure
  const rootNodes: FileTreeNode[] = []
  const processed = new Set<string>()

  for (const [path, node] of Object.entries(tree)) {
    if (processed.has(path)) continue

    const parentPath = path.substring(0, path.lastIndexOf('/'))
    if (parentPath && tree[parentPath]) {
      const parent = tree[parentPath]
      if (
        parent.children &&
        !parent.children.some((child) => child.filePath === path)
      ) {
        parent.children.push(node)
      }
    } else {
      rootNodes.push(node)
    }
    processed.add(path)
  }

  // Sort function for nodes
  function sortNodes(nodes: FileTreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children)
      }
    }
  }

  sortNodes(rootNodes)
  return rootNodes
}

/**
 * Selects knowledge files from a list of file paths with fallback logic.
 */
function selectKnowledgeFilePaths(allFilePaths: string[]): string[] {
  const knowledgeCandidates = allFilePaths.filter((filePath) => {
    const lowercaseFilePath = filePath.toLowerCase()
    return (
      lowercaseFilePath.endsWith('knowledge.md') ||
      lowercaseFilePath.endsWith('agents.md') ||
      lowercaseFilePath.endsWith('claude.md')
    )
  })

  // Group candidates by directory
  const byDirectory = new Map<string, string[]>()
  for (const filePath of knowledgeCandidates) {
    const lastSlash = filePath.lastIndexOf('/')
    const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : ''
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, [])
    }
    byDirectory.get(dir)!.push(filePath)
  }

  const selectedFiles: string[] = []

  for (const files of byDirectory.values()) {
    const knowledgeMd = files.find((f) =>
      f.toLowerCase().endsWith('knowledge.md'),
    )
    const agentsMd = files.find((f) => f.toLowerCase().endsWith('agents.md'))
    const claudeMd = files.find((f) => f.toLowerCase().endsWith('claude.md'))

    const selectedKnowledgeFile = knowledgeMd || agentsMd || claudeMd
    if (selectedKnowledgeFile) {
      selectedFiles.push(selectedKnowledgeFile)
    }
  }

  return selectedFiles
}

/**
 * Auto-derives knowledge files from project files if knowledgeFiles is undefined.
 */
function deriveKnowledgeFiles(
  projectFiles: Record<string, string>,
): Record<string, string> {
  const allFilePaths = Object.keys(projectFiles)
  const selectedFilePaths = selectKnowledgeFilePaths(allFilePaths)

  const knowledgeFiles: Record<string, string> = {}
  for (const filePath of selectedFilePaths) {
    knowledgeFiles[filePath] = projectFiles[filePath]
  }
  return knowledgeFiles
}

/**
 * Convex-specific initial session state.
 *
 * This version does NOT use tree-sitter for token scoring because:
 * - web-tree-sitter requires WASM which isn't supported in Convex
 * - Token scoring requires parsing source files into ASTs
 *
 * Instead, agents can use:
 * - The file tree in the system prompt to understand project structure
 * - The `read_subtree` tool to explore directories
 * - The `read_files` tool to read specific files
 */
export async function convexInitialSessionState(
  params: ConvexInitialSessionStateOptions,
): Promise<SessionState> {
  const { cwd, maxAgentSteps, fs, spawn, logger } = params
  let { agentDefinitions, customToolDefinitions, projectFiles, knowledgeFiles } =
    params

  if (!agentDefinitions) {
    agentDefinitions = []
  }
  if (!customToolDefinitions) {
    customToolDefinitions = []
  }

  // In Convex, we don't auto-discover project files (no filesystem)
  if (projectFiles === undefined) {
    projectFiles = {}
  }
  if (knowledgeFiles === undefined) {
    knowledgeFiles = projectFiles ? deriveKnowledgeFiles(projectFiles) : {}
  }

  const processedAgentTemplates =
    agentDefinitions.length > 0
      ? processAgentDefinitions(agentDefinitions)
      : {}

  const processedCustomToolDefinitions = processCustomToolDefinitions(
    customToolDefinitions,
  )

  // Build file tree from projectFiles
  // Note: Token scoring is skipped in Convex because web-tree-sitter (WASM)
  // isn't supported. Agents can still navigate using the file tree in the
  // system prompt and the read_subtree tool.
  const filePaths = Object.keys(projectFiles).sort()
  const fileTree = buildFileTree(filePaths)

  // Token scoring unavailable in Convex (requires web-tree-sitter WASM)
  // These would normally contain parsed symbol names and their importance scores
  const fileTokenScores: Record<string, any> = {}
  const tokenCallers: Record<string, any> = {}

  // No git changes in Convex (no filesystem/child_process)
  const gitChanges = {
    status: '',
    diff: '',
    diffCached: '',
    lastCommitMessages: '',
  }

  const initialState = getInitialSessionState({
    projectRoot: cwd ?? '/convex',
    cwd: cwd ?? '/convex',
    fileTree,
    fileTokenScores,
    tokenCallers,
    knowledgeFiles,
    userKnowledgeFiles: {},
    agentTemplates: processedAgentTemplates,
    customToolDefinitions: processedCustomToolDefinitions,
    gitChanges,
    changesSinceLastChat: {},
    shellConfigFiles: {},
    systemInfo: {
      platform: 'linux', // Convex runs on Linux
      shell: 'bash',
      nodeVersion: process.version,
      arch: 'x64',
      homedir: '/tmp',
      cpus: 1,
    },
  })

  if (maxAgentSteps) {
    initialState.mainAgentState.stepsRemaining = maxAgentSteps
  }

  return initialState
}

/**
 * Applies overrides to an existing session state for Convex.
 *
 * This version does NOT use tree-sitter for token scoring.
 * File tree is rebuilt when projectFiles change, but token scores
 * remain empty since WASM parsing isn't available.
 */
export async function convexApplyOverridesToSessionState(
  cwd: string | undefined,
  baseSessionState: SessionState,
  overrides: {
    projectFiles?: Record<string, string>
    knowledgeFiles?: Record<string, string>
    agentDefinitions?: AgentDefinition[]
    customToolDefinitions?: CustomToolDefinition[]
    maxAgentSteps?: number
  },
): Promise<SessionState> {
  // Deep clone to avoid mutating the original session state
  const sessionState = JSON.parse(
    JSON.stringify(baseSessionState),
  ) as SessionState

  // Apply maxAgentSteps override
  if (overrides.maxAgentSteps !== undefined) {
    sessionState.mainAgentState.stepsRemaining = overrides.maxAgentSteps
  }

  // Apply projectFiles override
  // Rebuild file tree but skip token scoring (WASM not available in Convex)
  if (overrides.projectFiles !== undefined) {
    const filePaths = Object.keys(overrides.projectFiles).sort()
    sessionState.fileContext.fileTree = buildFileTree(filePaths)
    // Token scoring requires web-tree-sitter WASM - unavailable in Convex
    sessionState.fileContext.fileTokenScores = {}
    sessionState.fileContext.tokenCallers = {}

    // Auto-derive knowledgeFiles if not explicitly provided
    if (overrides.knowledgeFiles === undefined) {
      sessionState.fileContext.knowledgeFiles = deriveKnowledgeFiles(
        overrides.projectFiles,
      )
    }
  }

  // Apply knowledgeFiles override
  if (overrides.knowledgeFiles !== undefined) {
    sessionState.fileContext.knowledgeFiles = overrides.knowledgeFiles
  }

  // Apply agentDefinitions override (merge by id, last-in wins)
  if (overrides.agentDefinitions !== undefined) {
    const processedAgentTemplates = processAgentDefinitions(
      overrides.agentDefinitions,
    )
    sessionState.fileContext.agentTemplates = {
      ...sessionState.fileContext.agentTemplates,
      ...processedAgentTemplates,
    }
  }

  // Apply customToolDefinitions override (replace by toolName)
  if (overrides.customToolDefinitions !== undefined) {
    const processedCustomToolDefinitions = processCustomToolDefinitions(
      overrides.customToolDefinitions,
    )
    sessionState.fileContext.customToolDefinitions = {
      ...sessionState.fileContext.customToolDefinitions,
      ...processedCustomToolDefinitions,
    }
  }

  return sessionState
}
