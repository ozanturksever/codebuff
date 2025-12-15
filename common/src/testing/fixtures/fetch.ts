/**
 * Test-only fetch mock fixtures.
 *
 * Provides typed mock factories for fetch operations in tests.
 * These helpers create properly-typed mocks without requiring ugly `as unknown as` casts.
 */

import { mock } from 'bun:test'

/**
 * Type alias for the global fetch function.
 * Using this ensures our mocks match the exact signature.
 */
export type FetchFn = typeof globalThis.fetch

/**
 * Type for a mock fetch function that can be used in place of globalThis.fetch.
 * Includes the mock utilities from bun:test.
 */
export type MockFetchFn = FetchFn & {
  mock: {
    calls: Array<[RequestInfo | URL, RequestInit | undefined]>
  }
}

/**
 * Configuration for creating a mock fetch response.
 */
export interface MockFetchResponseConfig {
  /** HTTP status code (default: 200) */
  status?: number
  /** HTTP status text (default: 'OK' for 200, 'Internal Server Error' for 500, etc.) */
  statusText?: string
  /** Response body as JSON (will be stringified) */
  json?: unknown
  /** Response body as string */
  body?: string
  /** Response headers */
  headers?: Record<string, string>
}

/**
 * Default status text for common HTTP status codes.
 */
const DEFAULT_STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

/**
 * Creates a typed mock fetch function that returns a configured Response.
 *
 * @example
 * ```ts
 * // JSON response
 * const mockFetch = createMockFetch({
 *   status: 200,
 *   json: { answer: 'test', sources: [] },
 * })
 *
 * // Error response
 * const mockFetch = createMockFetch({
 *   status: 500,
 *   body: 'Internal Server Error',
 * })
 *
 * // Use in test
 * agentRuntimeImpl.fetch = mockFetch
 * ```
 */
export function createMockFetch(config: MockFetchResponseConfig = {}): FetchFn {
  const {
    status = 200,
    statusText = DEFAULT_STATUS_TEXT[status] ?? '',
    json,
    body,
    headers = {},
  } = config

  // Determine response body
  const responseBody = json !== undefined ? JSON.stringify(json) : (body ?? '')

  // Add Content-Type header if returning JSON
  const responseHeaders = { ...headers }
  if (json !== undefined && !responseHeaders['Content-Type']) {
    responseHeaders['Content-Type'] = 'application/json'
  }

  const mockFn = mock(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      return Promise.resolve(
        new Response(responseBody, {
          status,
          statusText,
          headers: responseHeaders,
        }),
      )
    },
  )

  // Add preconnect stub to match fetch interface
  const fetchFn = mockFn as unknown as FetchFn
  fetchFn.preconnect = () => {}

  return fetchFn
}

/**
 * Creates a typed mock fetch function that rejects with an error.
 * Useful for testing network failure scenarios.
 *
 * @example
 * ```ts
 * const mockFetch = createMockFetchError(new Error('Network error'))
 * agentRuntimeImpl.fetch = mockFetch
 * ```
 */
export function createMockFetchError(error: Error): FetchFn {
  const mockFn = mock(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      return Promise.reject(error)
    },
  )

  // Add preconnect stub to match fetch interface
  const fetchFn = mockFn as unknown as FetchFn
  fetchFn.preconnect = () => {}

  return fetchFn
}

/**
 * Creates a typed mock fetch function with custom implementation.
 * For advanced scenarios where you need full control over the mock behavior.
 *
 * @example
 * ```ts
 * let callCount = 0
 * const mockFetch = createMockFetchCustom(async (input, init) => {
 *   callCount++
 *   if (callCount === 1) {
 *     return new Response('First call', { status: 200 })
 *   }
 *   return new Response('Subsequent call', { status: 200 })
 * })
 * ```
 */
export function createMockFetchCustom(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): FetchFn {
  const mockFn = mock(implementation)

  // Add preconnect stub to match fetch interface
  const fetchFn = mockFn as unknown as FetchFn
  fetchFn.preconnect = () => {}

  return fetchFn
}

/**
 * Creates a typed mock fetch that returns a partial Response object.
 * Useful for tests that need to mock specific Response methods like json() or text().
 *
 * @example
 * ```ts
 * const mockFetch = createMockFetchPartial({
 *   ok: true,
 *   status: 200,
 *   json: () => Promise.resolve({ id: 'test' }),
 * })
 * ```
 */
export function createMockFetchPartial(
  response: Partial<Response> & { ok: boolean; status: number },
): FetchFn {
  const mockFn = mock(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      return Promise.resolve(response as Response)
    },
  )

  // Add preconnect stub to match fetch interface
  const fetchFn = mockFn as unknown as FetchFn
  fetchFn.preconnect = () => {}

  return fetchFn
}

/**
 * Wraps an existing mock function to make it compatible with the fetch type.
 * Use this when you need to keep track of mock.calls but want proper typing.
 *
 * @example
 * ```ts
 * const mockFn = mock(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response))
 * const typedFetch = wrapMockAsFetch(mockFn)
 * // Now you can use typedFetch without casting and still access mockFn.mock.calls
 * ```
 */
export function wrapMockAsFetch(
  mockFn: ReturnType<typeof mock>,
): FetchFn {
  const fetchFn = mockFn as unknown as FetchFn
  fetchFn.preconnect = () => {}
  return fetchFn
}
