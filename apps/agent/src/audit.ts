import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AuditEntry {
  type: string
  correlationId: string
  payload: unknown
}

// Append-only JSONL log. We dropped the SHA-256 hash chain v2 used to
// ship: the marginal value of tamper-evidence on top of an append-only
// file the operator already controls didn't justify the canonicalization
// overhead and was the most fiddly piece of v2's machinery. Operators
// who need cryptographic audit can layer it on top of the JSONL stream.
export class AuditLog {
  private ensured = false

  constructor(private readonly path: string) {}

  async append(entry: AuditEntry): Promise<void> {
    if (!this.ensured) {
      await mkdir(dirname(this.path), { recursive: true }).catch(() => undefined)
      this.ensured = true
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      type: entry.type,
      correlationId: entry.correlationId,
      payload: entry.payload
    })
    await appendFile(this.path, line + '\n')
  }
}

// In-memory variant for tests.
export class InMemoryAuditLog {
  readonly entries: Array<AuditEntry & { ts: string }> = []
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push({ ...entry, ts: new Date().toISOString() })
  }
}
