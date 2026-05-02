export interface AbuseState {
  windowStart: number
  failures: number
  bannedUntil?: number
}

export interface SanitizeOptions {
  maxLength?: number
}

export const ABUSE_BAN_WINDOW_MS = 60_000
export const ABUSE_BAN_THRESHOLD = 8

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /system\s*prompt/i,
  /\boverride\b/i,
  /\bdelete\s+all\b/i,
  /\bexec(ute)?\b/i,
  /\bshutdown\b/i,
  /\brm\s+-rf\b/i,
  /<\s*script/i
]

export function sanitizeText(value: string, options: SanitizeOptions = {}): string {
  const maxLength = options.maxLength ?? 200
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function isPromptInjection(value: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value))
}

export function identifyClientActor(parts: { ip: string; userId?: string; entitlementId?: string }): string {
  if (parts.userId) {
    return `user:${parts.userId}`
  }

  if (parts.entitlementId) {
    return `entitlement:${parts.entitlementId}`
  }

  return `ip:${parts.ip}`
}

function getAbuseState(actor: string, windows: Map<string, AbuseState>): AbuseState {
  const now = Date.now()
  const existing = windows.get(actor)
  if (!existing || now - existing.windowStart > ABUSE_BAN_WINDOW_MS) {
    const next: AbuseState = { windowStart: now, failures: 0 }
    windows.set(actor, next)
    return next
  }

  return existing
}

export function recordFailure(
  actor: string,
  windows: Map<string, AbuseState>
): { banned: boolean; remainingSeconds: number; count: number } {
  const state = getAbuseState(actor, windows)
  state.failures += 1

  if (!state.bannedUntil && state.failures >= ABUSE_BAN_THRESHOLD) {
    state.bannedUntil = Date.now() + ABUSE_BAN_WINDOW_MS
    return {
      banned: true,
      remainingSeconds: ABUSE_BAN_WINDOW_MS / 1000,
      count: state.failures
    }
  }

  return {
    banned: false,
    remainingSeconds: state.bannedUntil ? Math.ceil((state.bannedUntil - Date.now()) / 1000) : 0,
    count: state.failures
  }
}

export function isBanned(actor: string, windows: Map<string, AbuseState>): boolean {
  const state = windows.get(actor)
  if (!state?.bannedUntil) {
    return false
  }

  if (Date.now() > state.bannedUntil) {
    windows.delete(actor)
    return false
  }

  return true
}

export function isSuspiciousPath(path: string): boolean {
  return /(?:\.\.|\\x00|<\s*script|\bjavascript:|%2e%2e|\\$\\{|`)/i.test(path)
}

export function isLargePayload(length: string | undefined): boolean {
  if (!length) {
    return false
  }

  const parsed = Number(length)
  return Number.isFinite(parsed) && parsed > 1_000_000
}
