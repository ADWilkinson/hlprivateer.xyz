import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLog, InMemoryAuditLog } from './audit'

describe('AuditLog (JSONL on disk)', () => {
  it('appends one JSON object per line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hlpv2-audit-'))
    const path = join(dir, 'audit.jsonl')
    const log = new AuditLog(path)
    await log.append({ type: 'a', correlationId: 'c-1', payload: { x: 1 } })
    await log.append({ type: 'b', correlationId: 'c-2', payload: { x: 2 } })
    const text = await readFile(path, 'utf8')
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ type: 'a', correlationId: 'c-1', payload: { x: 1 } })
    expect(JSON.parse(lines[1])).toMatchObject({ type: 'b', correlationId: 'c-2', payload: { x: 2 } })
  })
})

describe('InMemoryAuditLog', () => {
  it('keeps appends in memory for tests', async () => {
    const log = new InMemoryAuditLog()
    await log.append({ type: 't', correlationId: 'c-1', payload: 1 })
    expect(log.entries).toHaveLength(1)
  })
})
