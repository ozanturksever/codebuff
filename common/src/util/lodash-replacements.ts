// Shared lodash replacement utilities
// These functions replace lodash with native JavaScript implementations

// Deep clone using JSON serialization (works for serializable objects)
export function cloneDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

// Deep equality check using JSON serialization
export function isEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

// Fisher-Yates shuffle algorithm
export function shuffle<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Generate a range of numbers
export function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i)
}

// Sum an array by extracting numeric values with a function
export function sumBy<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((sum, item) => sum + fn(item), 0)
}

// Map values of an object
export function mapValues<T extends object, R>(
  obj: T,
  fn: (value: any, key: keyof T) => R,
): { [K in keyof T]: R } {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, fn(v, k as keyof T)]),
  ) as { [K in keyof T]: R }
}

// Union of two arrays
export function union<T>(arr1: T[], arr2: T[]): T[] {
  return Array.from(new Set([...arr1, ...arr2]))
}

// Partition an array into two arrays based on a predicate
export function partition<T, S extends T>(
  array: T[],
  predicate: (value: T) => value is S,
): [S[], Exclude<T, S>[]];
export function partition<T>(
  array: T[],
  predicate: (value: T) => boolean,
): [T[], T[]];
export function partition<T>(
  array: T[],
  predicate: (value: T) => boolean,
): [T[], T[]] {
  const truthy: T[] = []
  const falsy: T[] = []
  for (const item of array) {
    if (predicate(item)) {
      truthy.push(item)
    } else {
      falsy.push(item)
    }
  }
  return [truthy, falsy]
}
