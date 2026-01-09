import { describe, it, expect } from 'bun:test'
import { farewell } from '../farewell'

describe('farewell', () => {
  it('should return a farewell message with the provided name', () => {
    expect(farewell('Alice')).toBe('Goodbye, Alice!')
    expect(farewell('Bob')).toBe('Goodbye, Bob!')
    expect(farewell('World')).toBe('Goodbye, World!')
  })
})
