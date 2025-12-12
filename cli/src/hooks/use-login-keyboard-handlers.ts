import { useKeyboard } from '@opentui/react'
import { useCallback } from 'react'

import type { KeyEvent } from '@opentui/core'

interface UseLoginKeyboardHandlersParams {
  loginUrl: string | null
  hasOpenedBrowser: boolean
  loading: boolean
  onFetchLoginUrl: () => void
  onCopyUrl: (url: string) => void
}

/**
 * Custom hook that handles keyboard input for the login modal
 * - Enter key: fetch login URL and open browser
 * - 'c' key: copy URL to clipboard
 * - Ctrl+C: exit the application
 */
export function useLoginKeyboardHandlers({
  loginUrl,
  hasOpenedBrowser,
  loading,
  onFetchLoginUrl,
  onCopyUrl,
}: UseLoginKeyboardHandlersParams) {
  useKeyboard(
    useCallback(
      (key: KeyEvent) => {
        // Debug: log ALL key events in e2e mode
        if (process.env.CODEBUFF_E2E_NO_BROWSER === 'true') {
          process.stderr.write(`[E2E_KEY] Received key: ${key.name}, loading=${loading}, hasOpenedBrowser=${hasOpenedBrowser}\n`)
        }
        
        const isEnter =
          (key.name === 'return' || key.name === 'enter') &&
          !key.ctrl &&
          !key.meta &&
          !key.shift

        const isCKey = key.name === 'c' && !key.ctrl && !key.meta && !key.shift
        const isCtrlC = key.ctrl && key.name === 'c'

        if (isCtrlC) {
          if (
            'preventDefault' in key &&
            typeof key.preventDefault === 'function'
          ) {
            key.preventDefault()
          }
          process.exit(0)
        }

        if (isEnter && !hasOpenedBrowser && !loading) {
          if (
            'preventDefault' in key &&
            typeof key.preventDefault === 'function'
          ) {
            key.preventDefault()
          }

          onFetchLoginUrl()
        }

        if (isCKey && loginUrl && hasOpenedBrowser) {
          if (
            'preventDefault' in key &&
            typeof key.preventDefault === 'function'
          ) {
            key.preventDefault()
          }

          onCopyUrl(loginUrl)
        }
      },
      [loginUrl, hasOpenedBrowser, loading, onCopyUrl, onFetchLoginUrl],
    ),
  )
}
