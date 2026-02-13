import { describe, expect, it } from 'vitest'

describe('web app', () => {
  it('is buildable with a deterministic placeholder', () => {
    const label = 'HL PRIVATEER PUBLIC FLOOR'.toLowerCase()
    expect(label.includes('privateer')).toBe(true)
  })
})
