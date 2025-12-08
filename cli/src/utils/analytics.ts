import { env, IS_PROD } from '@codebuff/common/env'
import { PostHog } from 'posthog-node'

import type { AnalyticsEvent } from '@codebuff/common/constants/analytics-events'

// Prints the events to console
// It's very noisy, so recommended you set this to true
// only when you're actively adding new analytics
let DEBUG_DEV_EVENTS = false

// Store the identified user ID
let currentUserId: string | undefined
let client: PostHog | undefined

export let identified: boolean = false

enum AnalyticsErrorStage {
  Init = 'init',
  Track = 'track',
}

function isProdEnv(): boolean {
  return env.NEXT_PUBLIC_CB_ENVIRONMENT === 'prod'
}

function analyticsConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_POSTHOG_API_KEY && env.NEXT_PUBLIC_POSTHOG_HOST_URL)
}

function logAnalyticsError(error: unknown, context: Record<string, unknown>): void {
  if (!DEBUG_DEV_EVENTS) return
  const err = error instanceof Error ? error : new Error(String(error))
  console.warn('[analytics] error', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    ...context,
  })
}

export function initAnalytics() {
  if (!analyticsConfigured()) {
    // In non-prod environments we skip analytics entirely when keys are missing
    if (!isProdEnv()) {
      return
    }
    throw new Error(
      'NEXT_PUBLIC_POSTHOG_API_KEY or NEXT_PUBLIC_POSTHOG_HOST_URL is not set',
    )
  }

  try {
    client = new PostHog(env.NEXT_PUBLIC_POSTHOG_API_KEY, {
      host: env.NEXT_PUBLIC_POSTHOG_HOST_URL,
      enableExceptionAutocapture: IS_PROD,
    })
  } catch (error) {
    logAnalyticsError(error, { stage: AnalyticsErrorStage.Init })
    throw error
  }
}

export async function flushAnalytics() {
  if (!client) {
    return
  }
  try {
    await client.flush()
  } catch {
    // Silently handle PostHog network errors - don't log to console or logger
  }
}

export function trackEvent(
  event: AnalyticsEvent,
  properties?: Record<string, any>,
) {
  const distinctId = currentUserId
  if (!distinctId) {
    return
  }
  if (!client) {
    if (IS_PROD) {
      const error = new Error('Analytics client not initialized')
      logAnalyticsError(error, {
        stage: AnalyticsErrorStage.Track,
        event,
        properties,
      })
      throw error
    }
    return
  }

  if (!IS_PROD) {
    if (DEBUG_DEV_EVENTS) {
      console.log('Analytics event sent', {
        event,
        properties,
      })
    }
    return
  }

  client.capture({
    distinctId,
    event,
    properties,
  })
}

export function identifyUser(userId: string, properties?: Record<string, any>) {
  // Store the user ID for future events
  currentUserId = userId

  if (!client) {
    if (isProdEnv()) {
      throw new Error('Analytics client not initialized')
    }
    return
  }

  if (!IS_PROD) {
    if (DEBUG_DEV_EVENTS) {
      console.log('Identify event sent', {
        userId,
        properties,
      })
    }
    return
  }

  client.identify({
    distinctId: userId,
    properties,
  })
}

export function logError(
  error: any,
  userId?: string,
  properties?: Record<string, any>,
) {
  if (!client) {
    return
  }

  try {
    client.captureException(
      error,
      userId ?? currentUserId ?? 'unknown',
      properties,
    )
  } catch {
    // Silently handle PostHog errors - don't log them to console
  }
}
