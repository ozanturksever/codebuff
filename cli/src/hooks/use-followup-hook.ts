import { useEffect } from 'react'

import { useChatStore } from '../state/chat-store'

import type { FollowupHook } from '../state/chat-store'

/**
 * React hook to register a followup hook that intercepts and transforms followups.
 *
 * The hook function receives the followups and toolCallId, and can:
 * - Filter out certain followups
 * - Modify followup text/labels
 * - Add new followups
 * - Request auto-execution of a specific followup by index
 *
 * **Important:** Wrap your hook function in `useCallback` to prevent re-registering on every render.
 *
 * **Project-based hooks:** For project-level configuration, create `.codebuff/hooks.json`:
 * ```json
 * {
 *   "followupHook": {
 *     "command": "node .codebuff/followup-hook.js",
 *     "timeout": 5000
 *   }
 * }
 * ```
 * The command receives followups as JSON on stdin and outputs a prompt to auto-execute.
 *
 * @example
 * ```tsx
 * const myHook = useCallback((followups, toolCallId) => {
 *   // Filter out "commit" suggestions
 *   const filtered = followups.filter(f => !f.prompt.includes('commit'))
 *   return { followups: filtered }
 * }, [])
 * useFollowupHook(myHook)
 * ```
 *
 * @example
 * ```tsx
 * // Auto-execute the first followup
 * const autoExecuteFirst = useCallback((followups) => ({
 *   followups,
 *   autoExecuteIndex: 0,
 * }), [])
 * useFollowupHook(autoExecuteFirst)
 * ```
 *
 * @example
 * ```tsx
 * // Conditionally auto-execute "Continue" followup
 * const autoContinue = useCallback((followups) => {
 *   const continueIndex = followups.findIndex(f =>
 *     f.label?.toLowerCase() === 'continue' ||
 *     f.prompt.toLowerCase().includes('continue')
 *   )
 *   return {
 *     followups,
 *     autoExecuteIndex: continueIndex >= 0 ? continueIndex : undefined,
 *   }
 * }, [])
 * useFollowupHook(autoContinue)
 * ```
 */
export function useFollowupHook(hook: FollowupHook): void {
  const registerFollowupHook = useChatStore(
    (state) => state.registerFollowupHook,
  )
  const unregisterFollowupHook = useChatStore(
    (state) => state.unregisterFollowupHook,
  )

  useEffect(() => {
    registerFollowupHook(hook)
    return () => {
      unregisterFollowupHook(hook)
    }
  }, [hook, registerFollowupHook, unregisterFollowupHook])
}
