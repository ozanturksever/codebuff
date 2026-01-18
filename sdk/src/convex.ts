/**
 * Convex-compatible entry point for @fatagnus/codebuff
 *
 * This module provides a subset of the SDK that works within Convex's
 * sandboxed Node.js runtime, which doesn't have access to:
 * - child_process (no terminal commands)
 * - fs (no file system access)
 * - path (limited path operations)
 * - web-tree-sitter (no WASM modules)
 *
 * This is a standalone implementation that makes direct HTTP calls
 * to the Codebuff API without using @codebuff/agent-runtime.
 *
 * Usage:
 * ```ts
 * import { ConvexCodebuffClient, run } from '@fatagnus/codebuff/convex'
 *
 * const client = new ConvexCodebuffClient({
 *   apiKey: 'your-api-key',
 *   projectFiles: { 'src/index.ts': 'console.log("hello")' },
 * })
 *
 * const result = await client.run({
 *   agent: 'base',
 *   prompt: 'Explain this code',
 * })
 * ```
 */

// TypeScript declaration for Promise.withResolvers polyfill
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>
      resolve: (value: T | PromiseLike<T>) => void
      reject: (reason?: unknown) => void
    }
  }
}

// Polyfill for Promise.withResolvers (introduced in Node.js v20)
// Required for older runtimes like Convex's sandboxed environment
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function <T>(): {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  } {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// Re-export everything from the standalone implementation
export * from './convex-standalone'
