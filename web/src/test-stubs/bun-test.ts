/**
 * Stub for bun:test module when running in Jest.
 * Provides a mock() function that wraps jest.fn() for compatibility.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mock<T extends (...args: any[]) => any>(fn: T): T {
  // In Jest, we can use jest.fn() to create a mock that supports assertions
  // But for simplicity, just return the function as-is since the mock-db
  // utilities work without spy capabilities in Jest
  return fn
}
