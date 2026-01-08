import { create } from 'zustand'

/**
 * State for tracking active Ralph PRD execution session.
 * When a Ralph session is active, the auto-continue hook will
 * automatically execute "Continue to next story" followups.
 */
export interface RalphSessionState {
  /** Name of the active PRD being executed */
  activePrdName: string | null
  /** ID of the current story being executed */
  activeStoryId: string | null
  /** Whether auto-continue is enabled for this session */
  autoContinueEnabled: boolean
}

interface RalphStoreActions {
  /** Start a Ralph session for executing a PRD */
  startSession: (prdName: string, storyId: string) => void
  /** Clear the active session */
  clearSession: () => void
  /** Set auto-continue enabled/disabled */
  setAutoContinueEnabled: (enabled: boolean) => void
}

type RalphStore = RalphSessionState & RalphStoreActions

const initialState: RalphSessionState = {
  activePrdName: null,
  activeStoryId: null,
  autoContinueEnabled: true, // Enable by default for Ralph
}

export const useRalphStore = create<RalphStore>()((set) => ({
  ...initialState,

  startSession: (prdName: string, storyId: string) =>
    set({
      activePrdName: prdName,
      activeStoryId: storyId,
      autoContinueEnabled: true,
    }),

  clearSession: () =>
    set({
      activePrdName: null,
      activeStoryId: null,
    }),

  setAutoContinueEnabled: (enabled: boolean) =>
    set({ autoContinueEnabled: enabled }),
}))

/**
 * Check if a Ralph session is currently active.
 */
export function isRalphSessionActive(): boolean {
  const { activePrdName } = useRalphStore.getState()
  return activePrdName !== null
}

/**
 * Get the current Ralph session info.
 */
export function getRalphSession(): RalphSessionState {
  const { activePrdName, activeStoryId, autoContinueEnabled } =
    useRalphStore.getState()
  return { activePrdName, activeStoryId, autoContinueEnabled }
}
