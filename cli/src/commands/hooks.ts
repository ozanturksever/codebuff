import fs from 'fs'
import path from 'path'

import { getProjectRoot } from '../project-files'
import { loadProjectHooksConfig } from '../utils/project-hooks'
import { loadSettings } from '../utils/settings'
import { getSystemMessage } from '../utils/message-history'

import type { PostUserMessageFn } from '../types/contracts/send-message'

const HOOKS_CONFIG_PATH = '.codebuff/hooks.json'
const HOOKS_SCRIPT_PATH = '.codebuff/followup-hook.js'

const STARTER_CONFIG = `{
  "followupHook": {
    "command": "node .codebuff/followup-hook.js",
    "timeout": 5000
  }
}
`

const STARTER_SCRIPT = `#!/usr/bin/env node

/**
 * Codebuff Followup Hook
 * 
 * This script is called when Codebuff suggests followup actions.
 * It receives the followups as JSON on stdin and can output a prompt to auto-execute.
 * 
 * Input format (stdin):
 * {
 *   "followups": [{ "prompt": "...", "label": "..." }, ...],
 *   "toolCallId": "...",
 *   "context": {
 *     "todos": [{ "task": "...", "completed": true/false }, ...],
 *     "recentFileChanges": [{ "path": "...", "type": "created"|"modified"|"deleted" }, ...],
 *     "lastAssistantMessage": "..."
 *   }
 * }
 * 
 * Output format (stdout):
 * - JSON: { "prompt": "..." } to auto-execute a specific prompt
 * - Empty output: show followups normally without auto-execution
 * 
 * Context fields:
 * - todos: Current todo list from write_todos tool (completed/pending tasks)
 * - recentFileChanges: Files modified in recent messages (last 20)
 * - lastAssistantMessage: Summary of the last assistant message (first 500 chars)
 */

// Patterns to match "Continue" followups
const CONTINUE_PATTERNS = [
  /^continue$/i,
  /^continue with/i,
  /continue with the next step/i,
];

function isContinueFollowup(followup) {
  const textsToCheck = [followup.label, followup.prompt].filter(Boolean);
  return textsToCheck.some(text =>
    CONTINUE_PATTERNS.some(pattern => pattern.test(text))
  );
}

async function main() {
  // Read input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    return;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    console.error('Failed to parse input:', e.message);
    return;
  }

  const { followups, context } = data;
  if (!Array.isArray(followups) || followups.length === 0) {
    return;
  }

  // Example: Check if there are incomplete todos
  if (context?.todos?.length > 0) {
    const incomplete = context.todos.filter(t => !t.completed);
    const complete = context.todos.filter(t => t.completed);
    console.error(\`📋 Todos: \${complete.length}/\${context.todos.length} complete\`);
    
    if (incomplete.length > 0) {
      console.error('  Remaining:');
      incomplete.forEach(t => console.error(\`    - \${t.task}\`));
    }
  }

  // Example: Log recent file changes
  if (context?.recentFileChanges?.length > 0) {
    console.error(\`📁 Recent changes: \${context.recentFileChanges.length} files\`);
  }

  // Example: Auto-execute "Continue" followups
  const continueFollowup = followups.find(isContinueFollowup);
  if (continueFollowup) {
    // Uncomment the next line to enable auto-continue:
    // console.log(JSON.stringify({ prompt: continueFollowup.prompt }));
  }

  // Add your custom logic here!
  // Examples:
  // - Auto-continue only when all todos are complete
  // - Run tests before auto-continuing
  // - Check git status
  // - Validate changes with a linter
}

main().catch(error => {
  console.error('Hook error:', error.message);
  process.exit(1);
});
`

export function handleHooksInitCommand(): {
  postUserMessage: PostUserMessageFn
} {
  const projectRoot = getProjectRoot()
  const configPath = path.join(projectRoot, HOOKS_CONFIG_PATH)
  const scriptPath = path.join(projectRoot, HOOKS_SCRIPT_PATH)
  const codebuffDir = path.join(projectRoot, '.codebuff')

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    const postUserMessage: PostUserMessageFn = (prev) => [
      ...prev,
      getSystemMessage(
        `⚠ Hooks configuration already exists at ${HOOKS_CONFIG_PATH}\n\n` +
          'Use /hooks to view the current configuration.',
      ),
    ]
    return { postUserMessage }
  }

  // Create .codebuff directory if it doesn't exist
  if (!fs.existsSync(codebuffDir)) {
    fs.mkdirSync(codebuffDir, { recursive: true })
  }

  // Create the config file
  fs.writeFileSync(configPath, STARTER_CONFIG, 'utf-8')

  // Create the starter script if it doesn't exist
  const scriptCreated = !fs.existsSync(scriptPath)
  if (scriptCreated) {
    fs.writeFileSync(scriptPath, STARTER_SCRIPT, 'utf-8')
  }

  const lines = [
    '✓ Created hooks configuration!',
    '',
    'Files created:',
    `  • ${HOOKS_CONFIG_PATH}`,
  ]

  if (scriptCreated) {
    lines.push(`  • ${HOOKS_SCRIPT_PATH}`)
  }

  lines.push(
    '',
    'Edit the hook script to customize behavior:',
    `  ${HOOKS_SCRIPT_PATH}`,
    '',
    'The hook receives followups as JSON and can output:',
    '  • { "prompt": "..." } to auto-execute a prompt',
    '  • Empty output to show followups normally',
  )

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}

export function handleHooksCommand(): {
  postUserMessage: PostUserMessageFn
} {
  const settings = loadSettings()
  const useProjectHooks = settings.useProjectHooks ?? true
  const autoContinue = settings.autoContinue ?? false

  let configStatus: string
  let configDetails = ''

  try {
    const projectRoot = getProjectRoot()
    const configPath = path.join(projectRoot, HOOKS_CONFIG_PATH)

    if (fs.existsSync(configPath)) {
      const config = loadProjectHooksConfig()

      if (config?.followupHook?.command) {
        configStatus = '✓ Project hooks configured'
        configDetails = [
          '',
          `  Command: ${config.followupHook.command}`,
          `  Timeout: ${config.followupHook.timeout ?? 5000}ms`,
        ].join('\n')
      } else {
        configStatus = '⚠ Config file exists but no followupHook defined'
      }
    } else {
      configStatus = '○ No hooks configured'
      configDetails = `\n  Create ${HOOKS_CONFIG_PATH} to add project hooks`
    }
  } catch (error) {
    configStatus = '✗ Error loading hooks config'
    configDetails = `\n  ${error instanceof Error ? error.message : String(error)}`
  }

  const lines = [
    '📎 Project Hooks',
    '',
    `Status: ${configStatus}${configDetails}`,
    '',
    'Settings:',
    `  • Project hooks: ${useProjectHooks ? 'enabled' : 'disabled'}`,
    `  • Auto-continue: ${autoContinue ? 'enabled' : 'disabled'}`,
    '',
    'Configuration file: .codebuff/hooks.json',
    '',
    'Example configuration:',
    '  {',
    '    "followupHook": {',
    '      "command": "node .codebuff/followup-hook.js",',
    '      "timeout": 5000',
    '    }',
    '  }',
    '',
    'The hook command receives followups as JSON on stdin and can output:',
    '  • { "prompt": "..." } to auto-execute a prompt',
    '  • Empty output to show followups normally',
    '',
    'Commands:',
    '  /hooks init  - Create starter hooks configuration',
  ]

  const postUserMessage: PostUserMessageFn = (prev) => [
    ...prev,
    getSystemMessage(lines.join('\n')),
  ]

  return { postUserMessage }
}
