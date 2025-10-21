// Deep equality check using JSON serialization
function isEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

// Map values of an object
function mapValues<T extends object, R>(
  obj: T,
  fn: (value: any, key: keyof T) => R,
): { [K in keyof T]: R } {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, fn(v, k as keyof T)]),
  ) as { [K in keyof T]: R }
}

// Union of two arrays
function union<T>(arr1: T[], arr2: T[]): T[] {
  return Array.from(new Set([...arr1, ...arr2]))
}

export const removeUndefinedProps = <T extends object>(
  obj: T,
): {
  [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>
} => {
  const newObj: any = {}

  for (const key of Object.keys(obj)) {
    if ((obj as any)[key] !== undefined) newObj[key] = (obj as any)[key]
  }

  return newObj
}

export const removeNullOrUndefinedProps = <T extends object>(
  obj: T,
  exceptions?: string[],
): T => {
  const newObj: any = {}

  for (const key of Object.keys(obj)) {
    if (
      ((obj as any)[key] !== undefined && (obj as any)[key] !== null) ||
      (exceptions ?? []).includes(key)
    )
      newObj[key] = (obj as any)[key]
  }
  return newObj
}

export const addObjects = <T extends { [key: string]: number }>(
  obj1: T,
  obj2: T,
) => {
  const keys = union(Object.keys(obj1), Object.keys(obj2))
  const newObj = {} as any

  for (const key of keys) {
    newObj[key] = (obj1[key] ?? 0) + (obj2[key] ?? 0)
  }

  return newObj as T
}

export const subtractObjects = <T extends { [key: string]: number }>(
  obj1: T,
  obj2: T,
) => {
  const keys = union(Object.keys(obj1), Object.keys(obj2))
  const newObj = {} as any

  for (const key of keys) {
    newObj[key] = (obj1[key] ?? 0) - (obj2[key] ?? 0)
  }

  return newObj as T
}

export const hasChanges = <T extends object>(obj: T, partial: Partial<T>) => {
  const currValues = mapValues(partial, (_, key: keyof T) => obj[key])
  return !isEqual(currValues, partial as any)
}

export const hasSignificantDeepChanges = <T extends object>(
  obj: T,
  partial: Partial<T>,
  epsilonForNumbers: number,
): boolean => {
  const compareValues = (currValue: any, partialValue: any): boolean => {
    if (typeof currValue === 'number' && typeof partialValue === 'number') {
      return Math.abs(currValue - partialValue) > epsilonForNumbers
    }
    if (typeof currValue === 'object' && typeof partialValue === 'object') {
      return hasSignificantDeepChanges(
        currValue as any,
        partialValue as any,
        epsilonForNumbers,
      )
    }
    return !isEqual(currValue, partialValue)
  }

  for (const key in partial) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      if (compareValues(obj[key], partial[key])) {
        return true
      }
    }
  }

  return false
}

export const filterObject = <T extends object>(
  obj: T,
  predicate: (value: any, key: keyof T) => boolean,
): { [P in keyof T]: T[P] } => {
  const result = {} as { [P in keyof T]: T[P] }
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (predicate(obj[key], key)) {
        result[key] = obj[key]
      }
    }
  }
  return result
}

/**
 * Asserts that a condition is true. If the condition is false, it throws an error with the provided message.
 * @param condition The condition to check
 * @param message The error message to display if the condition is false
 * @throws {Error} If the condition is false
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}
