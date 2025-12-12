import fs from 'fs'

import { useMutation } from '@tanstack/react-query'
import open from 'open'

import { generateLoginUrl } from '../login/login-flow'
import { logger } from '../utils/logger'
import { getWebsiteUrl } from '../login/constants'

/**
 * Check if we should skip browser opening for e2e tests.
 * When CODEBUFF_E2E_NO_BROWSER=true, we print the URL instead of opening browser.
 */
function shouldSkipBrowserOpen(): boolean {
  return process.env.CODEBUFF_E2E_NO_BROWSER === 'true'
}

/**
 * Write login URL status to coordination file for e2e tests.
 * This provides reliable IPC between CLI and test runner.
 */
function writeE2ELoginStatus(status: 'pending' | 'ready' | 'error', data: { loginUrl?: string; error?: string }): void {
  const e2eUrlFile = process.env.CODEBUFF_E2E_URL_FILE
  if (!e2eUrlFile) return
  
  try {
    const payload = {
      status,
      loginUrl: data.loginUrl,
      error: data.error,
      timestamp: Date.now(),
    }
    fs.writeFileSync(e2eUrlFile, JSON.stringify(payload, null, 2))
  } catch (err) {
    // Don't fail the login flow if we can't write the coordination file
    logger.debug({ err, e2eUrlFile }, 'Failed to write e2e login status file')
  }
}

interface UseFetchLoginUrlParams {
  setLoginUrl: (url: string | null) => void
  setFingerprintHash: (hash: string | null) => void
  setExpiresAt: (expiresAt: string | null) => void
  setIsWaitingForEnter: (waiting: boolean) => void
  setHasOpenedBrowser: (opened: boolean) => void
  setError: (error: string | null) => void
}

/**
 * Custom hook that handles fetching the login URL and opening the browser
 */
export function useFetchLoginUrl({
  setLoginUrl,
  setFingerprintHash,
  setExpiresAt,
  setIsWaitingForEnter,
  setHasOpenedBrowser,
  setError,
}: UseFetchLoginUrlParams) {
  const fetchLoginUrlMutation = useMutation({
    mutationFn: async (fingerprintId: string) => {
      // Get website URL dynamically to support e2e tests with custom server URLs
      const baseUrl = getWebsiteUrl()
      
      // Debug logging for e2e tests
      if (process.env.CODEBUFF_E2E_NO_BROWSER === 'true') {
        process.stderr.write(`[E2E_FETCH] Starting mutation, baseUrl=${baseUrl}\n`)
      }
      
      logger.debug({ baseUrl }, 'Fetching login URL')
      
      // Write 'pending' status for e2e tests to confirm mutation was triggered
      writeE2ELoginStatus('pending', {})
      
      return generateLoginUrl(
        {
          logger,
        },
        {
          baseUrl,
          fingerprintId,
        },
      )
    },
    onSuccess: async (data) => {
      setLoginUrl(data.loginUrl)
      setFingerprintHash(data.fingerprintHash)
      setExpiresAt(data.expiresAt)
      setIsWaitingForEnter(true)
      setHasOpenedBrowser(true)

      // In e2e test mode, write URL to coordination file for reliable IPC
      if (shouldSkipBrowserOpen()) {
        writeE2ELoginStatus('ready', { loginUrl: data.loginUrl })
        return
      }

      // Open browser after fetching URL
      try {
        await open(data.loginUrl)
      } catch (err) {
        logger.error(err, 'Failed to open browser')
        // Don't show error, user can still click the URL
      }
    },
    onError: (err) => {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get login URL'
      setError(errorMessage)
      
      // In e2e test mode, write error to coordination file
      if (shouldSkipBrowserOpen()) {
        writeE2ELoginStatus('error', { error: errorMessage })
      }
      
      logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to get login URL',
      )
    },
  })

  return fetchLoginUrlMutation
}
