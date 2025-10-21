// Deep equality check using JSON serialization
// Note: Not exported to avoid type recursion issues
function isEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

export function filterDefined<T>(array: (T | null | undefined)[]) {
  return array.filter((item) => item !== null && item !== undefined) as T[]
}

type Falsey = false | undefined | null | 0 | ''
type FalseyValueArray<T> = T | Falsey | FalseyValueArray<T>[]

export function buildArray<T>(...params: FalseyValueArray<T>[]): T[] {
  const result: any[] = []

  function flatten(arr: any): void {
    for (const item of arr) {
      if (Array.isArray(item)) {
        flatten(item)
      } else if (item) {
        result.push(item)
      }
    }
  }

  flatten(params)
  return result as T[]
}

export function groupConsecutive<T, U>(xs: T[], key: (x: T) => U) {
  if (!xs.length) {
    return []
  }
  const result: any[] = []
  let curr = { key: key(xs[0]), items: [xs[0]] }
  for (const x of xs.slice(1)) {
    const k = key(x)
    if (!isEqual(k, curr.key)) {
      result.push(curr)
      curr = { key: k, items: [x] }
    } else {
      curr.items.push(x)
    }
  }
  result.push(curr)
  return result
}
