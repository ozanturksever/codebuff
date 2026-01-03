import { useCallback, useEffect, useState } from 'react'

import { useFollowupHook } from '../hooks/use-followup-hook'
import {
  executeFollowupHook,
  loadProjectHooksConfig,
} from '../utils/project-hooks'
import { loadSettings, saveSettings } from '../utils/settings'

import type {
  FollowupHookResult,
  SuggestedFollowup,
} from '../state/chat-store'
import type { FollowupHookContext, ProjectHooksConfig } from '../utils/project-hooks'

/**
 * Patterns to match "Continue" followups.
 * Checks both label and prompt for flexibility.
 */
const CONTINUE_PATTERNS = [
  /^continue$/i,
  /^continue with/i,
  /continue with the next step/i,
]

/**
 * Checks if a followup is a "Continue" suggestion.
 */
function isContinueFollowup(followup: SuggestedFollowup): boolean {
  const textToCheck = [followup.label, followup.prompt].filter(Boolean)

  return textToCheck.some((text) =>
    CONTINUE_PATTERNS.some((pattern) => pattern.test(text ?? '')),
  )
}

/**
 * Hook to manage auto-continue setting state.
 * Returns the current setting and a function to toggle it.
 */
export function useAutoContinueSetting(): {
  autoContinue: boolean
  setAutoContinue: (enabled: boolean) => void
  useProjectHooks: boolean
  setUseProjectHooks: (enabled: boolean) => void
} {
  const [autoContinue, setAutoContinueState] = useState(() => {
    const settings = loadSettings()
    return settings.autoContinue ?? false
  })

  const [useProjectHooks, setUseProjectHooksState] = useState(() => {
    const settings = loadSettings()
    return settings.useProjectHooks ?? true // Default to true
  })

  const setAutoContinue = useCallback((enabled: boolean) => {
    setAutoContinueState(enabled)
    saveSettings({ autoContinue: enabled })
  }, [])

  const setUseProjectHooks = useCallback((enabled: boolean) => {
    setUseProjectHooksState(enabled)
    saveSettings({ useProjectHooks: enabled })
  }, [])

  return { autoContinue, setAutoContinue, useProjectHooks, setUseProjectHooks }
}

/**
 * Hook to load project hooks configuration.
 * Reloads on mount and caches the result.
 */
function useProjectHooksConfig(): ProjectHooksConfig | null {
  const [config, setConfig] = useState<ProjectHooksConfig | null>(null)

  useEffect(() => {
    const loadedConfig = loadProjectHooksConfig()
    setConfig(loadedConfig)
  }, [])

  return config
}

interface AutoContinueProps {
  /** Whether auto-continue is enabled (from global settings) */
  enabled: boolean
  /** Whether to use project-level hooks from .codebuff/hooks.json (default: true) */
  useProjectHooks?: boolean
}

/**
 * Headless component that registers a followup hook to auto-execute followups.
 * 
 * Supports two modes:
 * 1. **Project-based hooks** (priority): If `.codebuff/hooks.json` exists with a `followupHook.command`,
 *    that command is executed with followups as JSON input. If the command returns a non-empty
 *    prompt, that prompt is auto-executed.
 * 
 * 2. **Built-in auto-continue**: If `enabled` is true and no project hook is configured,
 *    automatically executes "Continue" followup suggestions.
 *
 * @example Project hooks config (.codebuff/hooks.json):
 * ```json
 * {
 *   "followupHook": {
 *     "command": "node .codebuff/followup-hook.js",
 *     "timeout": 5000
 *   }
 * }
 * ```
 *
 * @example Hook script (.codebuff/followup-hook.js):
 * ```javascript
 * // Reads followups from stdin, outputs prompt to stdout
 * let input = '';
 * process.stdin.on('data', chunk => input += chunk);
 * process.stdin.on('end', () => {
 *   const { followups } = JSON.parse(input);
 *   const continueFollowup = followups.find(f => 
 *     f.label?.toLowerCase() === 'continue'
 *   );
 *   if (continueFollowup) {
 *     // Output the prompt to auto-execute
 *     console.log(JSON.stringify({ prompt: continueFollowup.prompt }));
 *   }
 * });
 * ```
 */
export function AutoContinue({
  enabled,
  useProjectHooks = true,
}: AutoContinueProps): null {
  const projectConfig = useProjectHooksConfig()
  const hasProjectHook =
    useProjectHooks && Boolean(projectConfig?.followupHook?.command)

  // Create the hook callback that handles both project hooks and built-in logic
  const autoContinueHook = useCallback(
    async (
      followups: SuggestedFollowup[],
      toolCallId: string,
      context: FollowupHookContext,
    ): Promise<FollowupHookResult> => {
      // Priority 1: Project-based hook command
      if (projectConfig?.followupHook) {
        const output = await executeFollowupHook(projectConfig.followupHook, {
          followups,
          toolCallId,
          context,
        })

        if (output) {
          // If hook returned a prompt, find the matching followup index to auto-execute
          if (output.prompt) {
            const matchIndex = followups.findIndex(
              (f) => f.prompt === output.prompt,
            )
            if (matchIndex >= 0) {
              return {
                followups: output.followups ?? followups,
                autoExecuteIndex: matchIndex,
              }
            }
            // If the prompt doesn't match any followup, we can't auto-execute
            // because the system expects an index into the followups array
            // Instead, we could add the prompt as a new followup and auto-execute it
            const newFollowups = [
              ...followups,
              { prompt: output.prompt, label: 'Auto' },
            ]
            return {
              followups: newFollowups,
              autoExecuteIndex: newFollowups.length - 1,
            }
          }

          // Hook returned modified followups without auto-execute
          if (output.followups) {
            return { followups: output.followups }
          }
        }

        // Hook returned nothing or failed - return original followups
        return { followups }
      }

      // Priority 2: Built-in auto-continue logic (if enabled)
      if (!enabled) {
        return { followups }
      }

      // Find the first "Continue" followup
      const continueIndex = followups.findIndex(isContinueFollowup)

      return {
        followups,
        autoExecuteIndex: continueIndex >= 0 ? continueIndex : undefined,
      }
    },
    [enabled, projectConfig],
  )

  // Only register the hook if either project hooks or built-in auto-continue is active
  const shouldRegisterHook = hasProjectHook || enabled

  // Use conditional hook registration
  useConditionalFollowupHook(shouldRegisterHook ? autoContinueHook : null)

  return null
}

/**
 * Helper hook that conditionally registers a followup hook.
 * When hook is null, it registers a no-op passthrough.
 */
function useConditionalFollowupHook(
  hook:
    | ((
        followups: SuggestedFollowup[],
        toolCallId: string,
        context: FollowupHookContext,
      ) => FollowupHookResult | Promise<FollowupHookResult>)
    | null,
): void {
  // Create a stable wrapper that checks if we should process
  const wrapperHook = useCallback(
    (
      followups: SuggestedFollowup[],
      toolCallId: string,
      context: FollowupHookContext,
    ): FollowupHookResult | Promise<FollowupHookResult> => {
      if (hook) {
        return hook(followups, toolCallId, context)
      }
      return { followups }
    },
    [hook],
  )

  useFollowupHook(wrapperHook)
}
