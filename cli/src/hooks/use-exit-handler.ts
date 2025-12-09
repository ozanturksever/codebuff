import { useCallback, useEffect, useRef, useState } from 'react'

import { getCurrentChatId } from '../project-files'
import { flushAnalytics } from '../utils/analytics'

import type { InputValue } from '../state/chat-store'

interface UseExitHandlerOptions {
  inputValue: string
  setInputValue: (value: InputValue) => void
}

let exitHandlerRegistered = false

function setupExitMessageHandler() {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true

  process.on('exit', () => {
    try {
      const chatId = getCurrentChatId()
      if (chatId) {
        // This runs synchronously during the exit phase
        // OpenTUI has already cleaned up by this point
        process.stdout.write(
          `\nTo continue this session later, run:\ncodebuff --continue ${chatId}\n`,
        )
      }
    } catch {
      // Silent fail - don't block exit
    }
  })
}

export const useExitHandler = ({
  inputValue,
  setInputValue,
}: UseExitHandlerOptions) => {
  const [nextCtrlCWillExit, setNextCtrlCWillExit] = useState(false)
  const exitWarningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const exitScheduledRef = useRef(false)

  useEffect(() => {
    setupExitMessageHandler()
  }, [])

  const exitNow = useCallback(() => {
    if (exitScheduledRef.current) {
      return
    }
    exitScheduledRef.current = true

    if (exitWarningTimeoutRef.current) {
      clearTimeout(exitWarningTimeoutRef.current)
      exitWarningTimeoutRef.current = null
    }

    try {
      process.stdout.write('\nGoodbye! Exiting...\n')
      // Ensure a clear exit marker is rendered for terminal snapshots
      process.stdout.write('exit\n')
    } catch {
      // Ignore stdout write errors during shutdown
    }

    // Give the terminal a moment to render the exit message before terminating
    setTimeout(() => {
      process.exit(0)
    }, 25)
  }, [])

  const flushAnalyticsWithTimeout = useCallback(async (timeoutMs = 1000) => {
    try {
      const flushPromise = flushAnalytics()
      if (!flushPromise || typeof (flushPromise as Promise<unknown>).finally !== 'function') {
        return
      }

      await Promise.race([
        flushPromise as Promise<unknown>,
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ])
    } catch {
      // Ignore flush failures and proceed with exit
    }
  }, [])

  const handleCtrlC = useCallback(() => {
    if (inputValue) {
      setInputValue({ text: '', cursorPosition: 0, lastEditDueToNav: false })
      return true
    }

    if (!nextCtrlCWillExit) {
      setNextCtrlCWillExit(true)
      exitWarningTimeoutRef.current = setTimeout(() => {
        setNextCtrlCWillExit(false)
        exitWarningTimeoutRef.current = null
      }, 2000)
      return true
    }

    // Fire-and-forget analytics flush so exit is not blocked
    void flushAnalyticsWithTimeout()
    exitNow()
    return true
  }, [flushAnalyticsWithTimeout, exitNow, inputValue, setInputValue, nextCtrlCWillExit])

  useEffect(() => {
    const handleSigint = () => {
      void flushAnalyticsWithTimeout()
      exitNow()
    }

    process.on('SIGINT', handleSigint)
    return () => {
      process.off('SIGINT', handleSigint)
    }
  }, [exitNow, flushAnalyticsWithTimeout])

  return { handleCtrlC, nextCtrlCWillExit }
}
