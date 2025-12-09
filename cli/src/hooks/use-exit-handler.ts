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

  useEffect(() => {
    setupExitMessageHandler()
  }, [])

  const exitNow = useCallback(() => {
    if (exitWarningTimeoutRef.current) {
      clearTimeout(exitWarningTimeoutRef.current)
      exitWarningTimeoutRef.current = null
    }

    try {
      process.stdout.write('\nGoodbye! Exiting...\n')
    } catch {
      // Ignore stdout write errors during shutdown
    }
    process.exit(0)
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

  const exitAfterFlush = useCallback(() => {
    void (async () => {
      await flushAnalyticsWithTimeout()
      exitNow()
    })()
  }, [exitNow, flushAnalyticsWithTimeout])

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

    exitAfterFlush()
    return true
  }, [exitAfterFlush, inputValue, setInputValue, nextCtrlCWillExit])

  useEffect(() => {
    const handleSigint = () => {
      exitAfterFlush()
    }

    process.on('SIGINT', handleSigint)
    return () => {
      process.off('SIGINT', handleSigint)
    }
  }, [exitAfterFlush])

  return { handleCtrlC, nextCtrlCWillExit }
}
