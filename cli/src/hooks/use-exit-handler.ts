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

    const flushed = flushAnalytics()
    if (flushed && typeof (flushed as Promise<void>).finally === 'function') {
      ;(flushed as Promise<void>).finally(exitNow)
    } else {
      exitNow()
    }
    return true
  }, [exitNow, inputValue, setInputValue, nextCtrlCWillExit])

  useEffect(() => {
    const handleSigint = () => {
      const flushed = flushAnalytics()
      if (flushed && typeof (flushed as Promise<void>).finally === 'function') {
        ;(flushed as Promise<void>).finally(exitNow)
      } else {
        exitNow()
      }
    }

    process.on('SIGINT', handleSigint)
    return () => {
      process.off('SIGINT', handleSigint)
    }
  }, [])

  return { handleCtrlC, nextCtrlCWillExit }
}
