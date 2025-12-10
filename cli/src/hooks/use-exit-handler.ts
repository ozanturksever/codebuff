import { useCallback, useEffect, useRef, useState } from 'react'

import { getCurrentChatId } from '../project-files'
import { flushAnalytics } from '../utils/analytics'
import { scheduleGracefulExit } from '../utils/graceful-exit'

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
  const exitFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const exitScheduledRef = useRef(false)
  const lastCtrlCHandledAtRef = useRef<number>(0)

  useEffect(() => {
    setupExitMessageHandler()
  }, [])

  const exitNow = useCallback(() => {
    if (exitScheduledRef.current) {
      return
    }
    exitScheduledRef.current = true

    console.log('[exit-handler] exitNow invoked')

    if (exitWarningTimeoutRef.current) {
      clearTimeout(exitWarningTimeoutRef.current)
      exitWarningTimeoutRef.current = null
    }
    if (exitFallbackTimeoutRef.current) {
      clearTimeout(exitFallbackTimeoutRef.current)
      exitFallbackTimeoutRef.current = null
    }

    scheduleGracefulExit()
    // Belt-and-suspenders: if graceful exit stalls, force a SIGINT/exit shortly after.
    setTimeout(() => {
      try {
        process.kill(process.pid, 'SIGINT')
      } catch {
        // ignore
      }
    }, 80)
    setTimeout(() => {
      try {
        process.exit(0)
      } catch {
        // ignore
      }
    }, 400)
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
    const now = Date.now()
    if (now - lastCtrlCHandledAtRef.current < 50) {
      return true
    }
    lastCtrlCHandledAtRef.current = now

    if (inputValue) {
      setInputValue({ text: '', cursorPosition: 0, lastEditDueToNav: false })
      return true
    }

    if (!nextCtrlCWillExit) {
      console.log('[exit-handler] first Ctrl+C detected; showing warning')
      setNextCtrlCWillExit(true)
      exitWarningTimeoutRef.current = setTimeout(() => {
        setNextCtrlCWillExit(false)
        exitWarningTimeoutRef.current = null
      }, 2000)
      // Fallback: if a second Ctrl+C is not detected, exit after a short grace period
      exitFallbackTimeoutRef.current = setTimeout(() => {
        console.log('[exit-handler] fallback exit triggered after warning window')
        exitNow()
      }, 1200)
      return true
    }

    console.log('[exit-handler] second Ctrl+C detected; exiting')
    // Fire-and-forget analytics flush so exit is not blocked
    void flushAnalyticsWithTimeout()
    exitNow()
    return true
  }, [flushAnalyticsWithTimeout, exitNow, inputValue, setInputValue, nextCtrlCWillExit])

  useEffect(() => {
    if (!process.stdin || typeof process.stdin.on !== 'function') return

    const handleRawCtrlC = (chunk: Buffer | string) => {
      const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (!data.includes('\u0003')) {
        return
      }

      const now = Date.now()
      // Avoid double-handling the same Ctrl+C event from both keypress and raw listeners
      if (now - lastCtrlCHandledAtRef.current < 50) {
        return
      }

      handleCtrlC()
    }

    process.stdin.on('data', handleRawCtrlC)

    return () => {
      if (typeof process.stdin.off === 'function') {
        process.stdin.off('data', handleRawCtrlC)
      } else {
        process.stdin.removeListener('data', handleRawCtrlC as any)
      }
    }
  }, [handleCtrlC])

  useEffect(() => {
    const handleSigint = () => {
      console.log('[exit-handler] SIGINT received; exiting')
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
