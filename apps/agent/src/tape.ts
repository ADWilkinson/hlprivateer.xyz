import type { FloorTapeLine } from './contracts'

export interface Tape {
  push(role: FloorTapeLine['role'], message: string): void
  recent(limit?: number): readonly FloorTapeLine[]
}

export function createTape(maxSize = 200): Tape {
  const buf: FloorTapeLine[] = []
  return {
    push(role, message) {
      buf.push({ ts: new Date().toISOString(), role, message })
      if (buf.length > maxSize) buf.shift()
    },
    recent(limit) {
      const n = limit ?? buf.length
      return buf.slice(-n)
    }
  }
}
