import { useCallback } from 'react'

import { handleRalphRun, markStoryComplete } from '../commands/ralph'
import { useFollowupHook } from '../hooks/use-followup-hook'
import { useRalphStore } from '../state/ralph-store'

import type {
  FollowupHookResult,
  SuggestedFollowup,
} from '../state/chat-store'
import type { FollowupHookContext } from '../utils/project-hooks'

/**
 * Patterns to match Ralph "Continue" followups.
 */
const RALPH_CONTINUE_PATTERNS = [
  /continue.*next.*story/i,
  /next.*story/i,
  /continue.*ralph/i,
  /^continue$/i,
  /continue with the next/i,
]

/**
 * Checks if a followup is a Ralph "Continue to next story" suggestion.
 */
function isRalphContinueFollowup(followup: SuggestedFollowup): boolean {
  const textToCheck = [followup.label, followup.prompt].filter(Boolean)
  return textToCheck.some((text) =>
    RALPH_CONTINUE_PATTERNS.some((pattern) => pattern.test(text ?? '')),
  )
}

/**
 * Headless component that registers a followup hook for Ralph auto-continue.
 * 
 * When a Ralph session is active and the agent suggests "Continue to next story",
 * this hook will:
 * 1. Check if there are more stories in the PRD
 * 2. Replace the continue followup with the actual /ralph run command
 * 3. Auto-execute it to proceed to the next story
 */
export function RalphAutoContinue(): null {
  const activePrdName = useRalphStore((state) => state.activePrdName)
  const activeStoryId = useRalphStore((state) => state.activeStoryId)
  const autoContinueEnabled = useRalphStore((state) => state.autoContinueEnabled)
  const clearSession = useRalphStore((state) => state.clearSession)

  const ralphHook = useCallback(
    (
      followups: SuggestedFollowup[],
      _toolCallId: string,
      _context: FollowupHookContext,
    ): FollowupHookResult => {
      // Only process if Ralph session is active and auto-continue is enabled
      if (!activePrdName || !activeStoryId || !autoContinueEnabled) {
        return { followups }
      }

      // Find a Ralph continue followup
      const continueIndex = followups.findIndex(isRalphContinueFollowup)

      if (continueIndex < 0) {
        // No continue followup found - clear session
        clearSession()
        return { followups }
      }

      // Mark the current story as complete before getting the next one
      // This ensures consistency even if the agent failed to update the PRD
      markStoryComplete(activePrdName, activeStoryId)

      // Get the next story using handleRalphRun
      const runResult = handleRalphRun(activePrdName)

      // If no more stories, clear session and show completion message
      if (!runResult.storyPrompt || !runResult.storyId) {
        clearSession()
        // Return original followups - the completion message was already shown
        return { followups }
      }

      // Update session with the new story ID
      useRalphStore.getState().startSession(activePrdName, runResult.storyId)

      // Replace the continue followup with the actual story prompt
      const modifiedFollowups = [...followups]
      modifiedFollowups[continueIndex] = {
        prompt: runResult.storyPrompt,
        label: `Next: ${runResult.storyId}`,
      }

      return {
        followups: modifiedFollowups,
        autoExecuteIndex: continueIndex,
      }
    },
    [activePrdName, activeStoryId, autoContinueEnabled, clearSession],
  )

  useFollowupHook(ralphHook)

  return null
}
