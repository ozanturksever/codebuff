// Re-export commonly used hooks
export { useFollowupHook } from './use-followup-hook'

// Re-export auto-continue from components for convenience
export { useAutoContinueSetting } from '../components/auto-continue'

// Re-export project hooks utilities
export {
  loadProjectHooksConfig,
  executeFollowupHook,
  hasFollowupHook,
} from '../utils/project-hooks'
export type {
  ProjectHooksConfig,
  FollowupHookConfig,
  FollowupHookInput,
  FollowupHookOutput,
  FollowupHookContext,
  TodoItem,
  FileChange,
} from '../utils/project-hooks'
