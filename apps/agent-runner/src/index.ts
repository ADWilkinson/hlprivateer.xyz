import { ulid } from 'ulid'
import fs from 'node:fs/promises'
import path from 'node:path'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import type { EventEnvelope, AuditEvent, OperatorPosition, StrategyProposal } from '@hl/privateer-contracts'
import { parseStrategyProposal } from '@hl/privateer-contracts'
import type { PluginSignal } from '@hl/privateer-plugin-sdk'
import { env } from './config'
import { buildFlatSignature, meaningfulPositions } from './exposure'
import { fetchMetaAndAssetCtxs, type HyperliquidUniverseAsset } from './hyperliquid'
import { computePriceFeaturePack, type PriceFeature } from './price-features'
import { createCoinGeckoClient, type CoinGeckoCategorySnapshot, type CoinGeckoMarketSnapshot } from './coingecko'
import { isCommandAvailable, runClaudeStructured, runCodexStructured } from './llm'
import { buildExternalIntelPack, summarizeExternalIntel, type ExternalIntelPack } from './intel'

type Tick = {
  symbol: string
  px: number
  bid: number
  ask: number
  bidSize?: number
  askSize?: number
  updatedAt: string
}

type LlmChoice = 'claude' | 'codex' | 'none'

type FloorRole =
  | 'scout'
  | 'research'
  | 'strategist'
  | 'execution'
  | 'risk'
  | 'scribe'
  | 'ops'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(items.length, concurrency))
  const results: R[] = new Array(items.length)
  let index = 0

  const workers = new Array(limit).fill(0).map(async () => {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) {
        break
      }
      results[current] = await fn(items[current] as T)
    }
  })

  await Promise.all(workers)
  return results
}

function sanitizeLine(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function safeDateMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function msSince(valueMs: number | null, nowMs: number): number | null {
  if (!Number.isFinite(valueMs) || !valueMs) {
    return null
  }
  const ageMs = nowMs - valueMs
  return Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : 0
}

function roleActorId(role: FloorRole): string {
  return `${env.AGENT_ID}:${role}`
}

const PROPOSAL_NOTIONAL_PRECISION = 6
type AuditLevel = 'INFO' | 'WARN' | 'ERROR'
type GitHubContentPayload = {
  sha?: string
  content?: string
}
type GitHubJournalTarget = {
  localPath: string
  githubPath: string
}

type DiscordEmbedField = {
  name: string
  value: string
  inline?: boolean
}

type DiscordEmbed = {
  title: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: { text: string }
  timestamp?: string
}

const DISCORD_ACTION_SET = new Set(
  env.DISCORD_WEBHOOK_ACTIONS
    .split(',')
    .map((action) => sanitizeLine(action, 120).toLowerCase())
    .filter(Boolean)
)
const GITHUB_API_BASE_URL = env.GITHUB_API_URL.replace(/\/+$/, '')

const JOURNAL_PATH = path.resolve(process.cwd(), env.AGENT_JOURNAL_PATH)
const GITHUB_JOURNAL_PATH = env.AGENT_GITHUB_JOURNAL_PATH

let journalWriteChain: Promise<void> = Promise.resolve()
let journalDirectoryReady = new Map<string, Promise<void>>()
let githubJournalWriteChain: Promise<void> = Promise.resolve()
let githubJournalFlushChain: Promise<void> = Promise.resolve()
let githubJournalFlushTimer: ReturnType<typeof setInterval> | null = null
let pendingGitHubJournalTargets = new Map<string, GitHubJournalTarget>()
let lastDiscordNotifyByFingerprint = new Map<string, number>()

function normalizeGitHubBranch(branch = env.GITHUB_JOURNAL_BRANCH): string {
  const normalized = sanitizeLine(branch, 100)
  return normalized || 'main'
}

function normalizeGitHubPath(value: string): string {
  return sanitizeLine(value, 240).replace(/^\/+|\/+$/g, '')
}

function githubApiHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'hl-privateer-agent-runner',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
}

function githubContentsUrl(pathValue: string, branch: string, ref = false): string {
  const owner = encodeURIComponent(sanitizeLine(env.GITHUB_REPO_OWNER, 120))
  const repo = encodeURIComponent(sanitizeLine(env.GITHUB_REPO_NAME, 120))
  const encodedPath = pathValue
    .split('/')
    .map((segment) => encodeURIComponent(sanitizeLine(segment, 240)))
    .filter(Boolean)
    .join('/')
  const base = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/contents/${encodedPath}`
  if (!ref) {
    return base
  }
  return `${base}?ref=${encodeURIComponent(branch)}`
}

function normalizeJournalToken(value: string): string {
  return sanitizeLine(value, 160)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function resolveActorLabel(event: AuditEvent): string {
  const actorType = normalizeJournalToken(event.actorType || 'agent')
  const actorIdRaw = sanitizeLine(event.actorId || '', 160)

  // Prefer stable per-role files for internal agents so journals remain easy to scan.
  // Example: "privateer-floor:strategist" -> "strategist".
  const roleToken = actorIdRaw.includes(':') ? actorIdRaw.split(':').pop() ?? '' : actorIdRaw
  const role = normalizeJournalToken(roleToken)
  if (actorType === 'internal_agent' && role) {
    return role
  }

  const actorId = normalizeJournalToken(actorIdRaw || actorType)
  const combined = `${actorType}-${actorId}`
  return normalizeJournalToken(combined) || `agent-${env.AGENT_ID}`
}

function resolveJournalDirectory(templatePath: string): string {
  const absolute = path.isAbsolute(templatePath) ? templatePath : path.resolve(process.cwd(), templatePath)
  const baseName = path.basename(absolute)
  if (/\.ndjson$/i.test(baseName)) {
    return path.dirname(absolute)
  }
  return absolute
}

function resolveGitHubJournalDirectory(templatePath: string): string {
  const normalized = normalizeGitHubPath(templatePath)
  const segments = normalized.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  if (last && /\.ndjson$/i.test(last)) {
    segments.pop()
  }
  return segments.join('/')
}

function resolveJournalPaths(event: AuditEvent): GitHubJournalTarget {
  const actorLabel = resolveActorLabel(event)
  const localDirectory = resolveJournalDirectory(JOURNAL_PATH)
  const localPath = path.join(localDirectory, `journal-${actorLabel}.ndjson`)
  const githubDirectory = resolveGitHubJournalDirectory(GITHUB_JOURNAL_PATH)
  const githubPath = githubDirectory ? `${githubDirectory}/journal-${actorLabel}.ndjson` : `journal-${actorLabel}.ndjson`
  return { localPath, githubPath }
}

function isGitHubJournalFlushEnabled(): boolean {
  return env.AGENT_GITHUB_JOURNAL_FLUSH_INTERVAL_MS > 0
}

function isGitHubJournalEnabled(): boolean {
  return (
    env.AGENT_GITHUB_JOURNAL_ENABLED &&
    env.GITHUB_TOKEN.length > 0 &&
    normalizeGitHubPath(GITHUB_JOURNAL_PATH).length > 0 &&
    normalizeGitHubBranch().length > 0 &&
    sanitizeLine(env.GITHUB_REPO_OWNER, 120).length > 0 &&
    sanitizeLine(env.GITHUB_REPO_NAME, 120).length > 0
  )
}

async function ensureGitHubJournalFileState(
  pathValue: string,
  branch: string,
): Promise<{ sha?: string; content: string }> {
  const headers = githubApiHeaders()
  const readUrl = githubContentsUrl(pathValue, branch, true)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.GITHUB_JOURNAL_TIMEOUT_MS)

  try {
    const response = await (async () => {
      try {
        return await fetch(readUrl, { headers, signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
    })()

    if (response.status === 404) {
      return { content: '' }
    }
    if (!response.ok) {
      const raw = await response.text()
      throw new Error(`GitHub journal read failed status=${response.status} body=${sanitizeLine(raw, 320)}`)
    }
    const payload = (await response.json()) as GitHubContentPayload
    const sha = sanitizeLine(payload.sha ?? '', 80)
    let content = ''
    if (typeof payload.content === 'string' && payload.content.trim()) {
      content = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8')
    }
    return { sha, content }
  } catch (error) {
    throw error
  }
}

async function syncGitHubJournalFile(remotePath: string, nextContent: string, action: string): Promise<void> {
  if (!isGitHubJournalEnabled()) {
    return
  }

  const branch = normalizeGitHubBranch()
  const pathValue = normalizeGitHubPath(remotePath)
  if (!pathValue) {
    return
  }

  const headers = githubApiHeaders()
  const contentsUrl = githubContentsUrl(pathValue, branch)

  try {
    const { sha: existingSha } = await ensureGitHubJournalFileState(pathValue, branch)
    const putPayload = {
      message: `chore(agent-journal): ${sanitizeLine(action, 120)} [${new Date().toISOString()}]`,
      content: Buffer.from(nextContent).toString('base64'),
      branch,
      ...(existingSha ? { sha: existingSha } : {})
    }
    const putController = new AbortController()
    const putTimeout = setTimeout(() => putController.abort(), env.GITHUB_JOURNAL_TIMEOUT_MS)
    const response = await (async () => {
      try {
        return await fetch(contentsUrl, {
          method: 'PUT',
          headers,
          signal: putController.signal,
          body: JSON.stringify(putPayload)
        })
      } finally {
        clearTimeout(putTimeout)
      }
    })()
    if (!response.ok) {
      const raw = await response.text()
      throw new Error(`GitHub journal write failed status=${response.status} body=${sanitizeLine(raw, 320)}`)
    }
  } catch (error) {
    console.error(`agent journal github sync failed path=${pathValue}`, error)
  }
}

async function appendGitHubJournalLine(line: string, action: string, remotePath: string): Promise<void> {
  const normalizedPath = normalizeGitHubPath(remotePath)
  if (!normalizedPath) {
    return
  }

  try {
    const branch = normalizeGitHubBranch()
    const state = await ensureGitHubJournalFileState(normalizedPath, branch)
    const nextText = state.content ? `${state.content.replace(/\s*$/, '')}\n${line}` : line
    await syncGitHubJournalFile(normalizedPath, nextText, `append ${sanitizeLine(action, 120)}`)
  } catch (error) {
    console.error(`agent journal github append failed path=${normalizedPath}`, error)
  }
}

function markGitHubJournalForIntervalFlush(target: GitHubJournalTarget): void {
  if (!isGitHubJournalFlushEnabled()) {
    return
  }
  pendingGitHubJournalTargets.set(target.githubPath, target)
}

async function flushGitHubJournalFiles(): Promise<void> {
  if (!isGitHubJournalEnabled() || !isGitHubJournalFlushEnabled()) {
    return
  }

  await journalWriteChain
  const targets = Array.from(pendingGitHubJournalTargets.values())
  if (targets.length === 0) {
    return
  }
  pendingGitHubJournalTargets = new Map()

  for (const target of targets) {
    try {
      const localText = await fs.readFile(target.localPath, 'utf8')
      await syncGitHubJournalFile(target.githubPath, localText, 'interval sync')
    } catch (error) {
      console.error(`agent journal github interval sync failed path=${target.githubPath}`, error)
    }
  }
}

function scheduleGitHubJournalIntervalFlush(): void {
  if (githubJournalFlushTimer) {
    return
  }
  if (!isGitHubJournalEnabled() || !isGitHubJournalFlushEnabled()) {
    return
  }

  const intervalMs = Math.max(30_000, env.AGENT_GITHUB_JOURNAL_FLUSH_INTERVAL_MS)
  githubJournalFlushTimer = setInterval(() => {
    githubJournalFlushChain = githubJournalFlushChain.then(() => flushGitHubJournalFiles())
  }, intervalMs)
}

function ensureJournalDirectoryForPath(filePath: string): Promise<void> {
  const directory = path.dirname(filePath)
  const cached = journalDirectoryReady.get(directory)
  if (cached) {
    return cached
  }
  const next = fs.mkdir(directory, { recursive: true }).then(() => undefined)
  journalDirectoryReady.set(directory, next)
  return next
}

function normalizeProposalNotional(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Number(Math.abs(value).toFixed(PROPOSAL_NOTIONAL_PRECISION))
}

function deriveAuditLevel(event: AuditEvent): AuditLevel {
  const action = String(event.action ?? '')
  const lowered = action.toLowerCase()
  if (lowered.startsWith('error.') || lowered.includes('.error') || lowered.endsWith('_error') || lowered.endsWith('.fatal')) {
    return 'ERROR'
  }
  if (event.action === 'agent.error') {
    return 'ERROR'
  }
  if (event.action === 'agent.proposal.invalid') {
    return 'WARN'
  }
  if (event.action === 'risk.decision') {
    const decision = String((event.details as Record<string, unknown>)?.decision ?? '').toUpperCase()
    if (decision === 'DENY' || decision === 'ALLOW_REDUCE_ONLY') {
      return 'WARN'
    }
    return 'INFO'
  }
  if (event.action === 'risk.report') {
    const posture = String((event.details as Record<string, unknown>).posture ?? '').toUpperCase()
    if (posture === 'RED') {
      return 'WARN'
    }
    return 'INFO'
  }
  if (event.action === 'agent.proposal') {
    return 'WARN'
  }
  return 'INFO'
}

function isDiscordNotificationEnabled(): boolean {
  if (!env.DISCORD_WEBHOOK_ENABLED || !env.DISCORD_WEBHOOK_URL) {
    return false
  }

  if (DISCORD_ACTION_SET.size === 0) {
    return false
  }

  return true
}

function isDiscordActionAllowed(action: string): boolean {
  if (!isDiscordNotificationEnabled()) {
    return false
  }

  const normalized = sanitizeLine(action, 120).toLowerCase()
  if (!normalized) {
    return false
  }

  if (DISCORD_ACTION_SET.has('*')) {
    return true
  }

  return DISCORD_ACTION_SET.has(normalized)
}

function summarizeDetailsForDiscord(value: unknown, maxLength: number): string {
  try {
    const raw = JSON.stringify(value)
    if (!raw) {
      return ''
    }
    return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw
  } catch {
    return sanitizeLine(String(value), maxLength)
  }
}

function fmtUsd(value: unknown): string {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (num === null) return '--'
  const abs = Math.abs(num)
  const formatted = abs >= 1000 ? `$${Math.round(abs).toLocaleString('en-US')}` : `$${abs.toFixed(2)}`
  return num < 0 ? `-${formatted}` : formatted
}

function fmtPct(value: unknown): string {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (num === null) return '--'
  return `${Math.round(num * 100)}%`
}

function fmtBulletList(items: unknown[], max: number): string {
  const lines = items
    .slice(0, max)
    .map((item) => `- ${sanitizeLine(String(item), 200)}`)
  if (items.length > max) lines.push(`- ... +${items.length - max} more`)
  return lines.join('\n')
}

function fmtLegs(legs: unknown[]): string {
  return legs
    .slice(0, 10)
    .map((leg) => {
      if (!leg || typeof leg !== 'object') return null
      const r = leg as Record<string, unknown>
      const symbol = sanitizeLine(String(r.symbol ?? ''), 24).toUpperCase()
      const side = sanitizeLine(String(r.side ?? ''), 8).toUpperCase()
      if (!symbol) return null
      return `${symbol} ${side || '--'} ${fmtUsd(r.notionalUsd)}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

type DiscordEmbedResult = { description?: string; fields?: DiscordEmbedField[] }

function formatResearchReportEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const headline = sanitizeLine(String(d.headline ?? d.title ?? d.summary ?? ''), 256)
  const fields: DiscordEmbedField[] = []
  if (d.regime != null) fields.push({ name: 'Regime', value: sanitizeLine(String(d.regime), 64).toUpperCase(), inline: true })
  if (d.confidence != null) fields.push({ name: 'Confidence', value: fmtPct(d.confidence), inline: true })
  const rec = d.recommendation ?? d.action ?? d.signal
  if (rec != null) fields.push({ name: 'Recommendation', value: sanitizeDiscordMultiline(String(rec), 1024) })
  return { description: headline ? `**${headline}**` : undefined, fields }
}

function formatRiskReportEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const headline = sanitizeLine(String(d.headline ?? d.title ?? d.summary ?? ''), 256)
  const fields: DiscordEmbedField[] = []
  if (d.posture != null) fields.push({ name: 'Posture', value: sanitizeLine(String(d.posture), 32).toUpperCase(), inline: true })
  if (d.confidence != null) fields.push({ name: 'Confidence', value: fmtPct(d.confidence), inline: true })
  const risks = Array.isArray(d.risks) ? d.risks : []
  if (risks.length > 0) fields.push({ name: 'Risks', value: sanitizeDiscordMultiline(fmtBulletList(risks, 6), 1024) })
  if (d.policy != null) fields.push({ name: 'Policy', value: sanitizeDiscordMultiline(String(d.policy), 512) })
  return { description: headline ? `**${headline}**` : undefined, fields }
}

function formatRiskDecisionEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const decision = sanitizeLine(String(d.decision ?? ''), 32).toUpperCase()
  const reasons = Array.isArray(d.reasons) ? (d.reasons as unknown[]) : []
  const fields: DiscordEmbedField[] = []
  if (reasons.length > 0) {
    const reasonLines = reasons
      .slice(0, 8)
      .map((r) => {
        if (!r || typeof r !== 'object') return sanitizeLine(String(r), 160)
        const rec = r as Record<string, unknown>
        const code = sanitizeLine(String(rec.code ?? ''), 48).toUpperCase()
        const msg = sanitizeLine(String(rec.message ?? ''), 160)
        return code ? `**${code}**: ${msg}` : msg
      })
      .filter(Boolean)
    if (reasonLines.length > 0) fields.push({ name: 'Reasons', value: sanitizeDiscordMultiline(reasonLines.join('\n'), 1024) })
  }
  return { description: decision ? `**${decision}**` : undefined, fields }
}

function formatStrategistDirectiveEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const decision = sanitizeLine(String(d.decision ?? d.directive ?? ''), 64).toUpperCase()
  const rationale = sanitizeLine(String(d.rationale ?? ''), 256)
  const desc = [decision, rationale].filter(Boolean).join(' — ')
  const fields: DiscordEmbedField[] = []
  if (d.confidence != null) fields.push({ name: 'Confidence', value: fmtPct(d.confidence), inline: true })
  if (d.horizon != null) fields.push({ name: 'Horizon', value: sanitizeLine(String(d.horizon), 32), inline: true })
  const legs = Array.isArray(d.legs ?? d.plan) ? (d.legs ?? d.plan) as unknown[] : []
  const legStr = fmtLegs(legs)
  if (legStr) fields.push({ name: 'Legs', value: sanitizeDiscordMultiline(legStr, 1024) })
  if (d.riskBudget != null) fields.push({ name: 'Risk Budget', value: fmtUsd(d.riskBudget), inline: true })
  if (d.notes != null) fields.push({ name: 'Notes', value: sanitizeDiscordMultiline(String(d.notes), 512) })
  return { description: desc ? `**${desc}**` : undefined, fields }
}

function formatAgentProposalEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const summary = sanitizeLine(String(d.summary ?? d.rationale ?? ''), 256)
  const fields: DiscordEmbedField[] = []
  if (d.decision != null) fields.push({ name: 'Decision', value: sanitizeLine(String(d.decision), 32).toUpperCase(), inline: true })
  if (d.requestedMode != null) fields.push({ name: 'Mode', value: sanitizeLine(String(d.requestedMode), 24).toUpperCase(), inline: true })
  if (d.confidence != null) fields.push({ name: 'Confidence', value: fmtPct(d.confidence), inline: true })
  const legs = Array.isArray(d.plan) ? (d.plan as unknown[]) : []
  const legStr = fmtLegs(legs)
  if (legStr) fields.push({ name: 'Plan', value: sanitizeDiscordMultiline(legStr, 1024) })
  const recovery = d.recovery ?? d.recoveryPlan
  if (recovery != null) fields.push({ name: 'Recovery', value: sanitizeDiscordMultiline(String(recovery), 512) })
  return { description: summary ? `**${summary}**` : undefined, fields }
}

function formatProposalInvalidEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const errors = Array.isArray(d.errors) ? d.errors : Array.isArray(d.issues) ? d.issues : []
  const fields: DiscordEmbedField[] = []
  if (errors.length > 0) {
    const numbered = errors.slice(0, 10).map((e, i) => `${i + 1}. ${sanitizeLine(String(e), 160)}`).join('\n')
    fields.push({ name: 'Errors', value: sanitizeDiscordMultiline(numbered, 1024) })
  }
  return { description: '**Proposal validation failed**', fields }
}

function formatAnalysisReportEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const headline = sanitizeLine(String(d.headline ?? d.title ?? d.summary ?? ''), 256)
  const fields: DiscordEmbedField[] = []
  if (d.confidence != null) fields.push({ name: 'Confidence', value: fmtPct(d.confidence), inline: true })
  if (d.thesis != null) fields.push({ name: 'Thesis', value: sanitizeDiscordMultiline(String(d.thesis), 512) })
  const risks = Array.isArray(d.risks) ? d.risks : []
  if (risks.length > 0) fields.push({ name: 'Risks', value: sanitizeDiscordMultiline(fmtBulletList(risks, 6), 1024) })
  return { description: headline ? `**${headline}**` : undefined, fields }
}

function formatAgentErrorEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const msg = sanitizeLine(String(d.message ?? d.error ?? ''), 420)
  return { description: msg ? `**${msg}**` : undefined }
}

function formatIntelRefreshEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const symbols = Array.isArray(d.symbols) ? d.symbols.map((s) => String(s)).join(', ') : sanitizeLine(String(d.symbols ?? ''), 128)
  const fields: DiscordEmbedField[] = []

  const twitter = d.twitter as Record<string, unknown> | null | undefined
  if (twitter && typeof twitter === 'object') {
    const ok = twitter.ok ? 'ok' : 'degraded'
    const queryCount = typeof twitter.queryCount === 'number' ? twitter.queryCount : 0
    const totalTweets = Array.isArray(twitter.queries)
      ? (twitter.queries as Array<Record<string, unknown>>).reduce((sum, q) => sum + (typeof q.tweetCount === 'number' ? q.tweetCount : 0), 0)
      : 0
    const errorQueries = Array.isArray(twitter.queries)
      ? (twitter.queries as Array<Record<string, unknown>>).filter((q) => q.error).length
      : 0
    const parts = [`${ok} (${queryCount} queries, ${totalTweets} tweets)`]
    if (errorQueries > 0) parts.push(`${errorQueries} failed`)
    fields.push({ name: 'Twitter', value: sanitizeLine(parts.join(', '), 128), inline: true })

    const allTweets = Array.isArray(twitter.queries)
      ? (twitter.queries as Array<Record<string, unknown>>).flatMap((q) => Array.isArray(q.topTweets) ? q.topTweets as Array<Record<string, unknown>> : [])
      : []
    if (allTweets.length > 0) {
      const top = allTweets.slice(0, 3).map((t) => sanitizeLine(String(t.text ?? ''), 200)).filter(Boolean)
      if (top.length > 0) fields.push({ name: 'Top Tweets', value: sanitizeDiscordMultiline(fmtBulletList(top, 3), 1024) })
    }
  } else if (twitter != null) {
    fields.push({ name: 'Twitter', value: sanitizeLine(String(twitter), 64), inline: true })
  }

  const fng = d.fearGreed as Record<string, unknown> | null | undefined
  if (fng && typeof fng === 'object') {
    const value = typeof fng.value === 'number' ? fng.value : null
    const classification = typeof fng.classification === 'string' ? fng.classification : null
    const label = value !== null && classification ? `${value} (${classification})` : value !== null ? String(value) : classification ?? (fng.ok ? 'ok' : 'unavailable')
    fields.push({ name: 'Fear & Greed', value: sanitizeLine(label, 64), inline: true })
  } else if (fng != null) {
    fields.push({ name: 'Fear & Greed', value: sanitizeLine(String(fng), 32), inline: true })
  }

  return { description: symbols ? `Intel refresh: ${symbols}` : 'Intel refresh', fields }
}

function formatUniverseSelectedEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const fields: DiscordEmbedField[] = []
  const symbols = Array.isArray(d.symbols) ? d.symbols.map((s) => String(s)).join(', ') : null
  if (symbols) fields.push({ name: 'Symbols', value: sanitizeLine(symbols, 256), inline: true })
  if (d.target != null) fields.push({ name: 'Target', value: sanitizeLine(String(d.target), 32), inline: true })
  if (d.candidates != null) fields.push({ name: 'Candidates', value: sanitizeLine(String(d.candidates), 32), inline: true })
  if (d.rationale != null) fields.push({ name: 'Rationale', value: sanitizeDiscordMultiline(String(d.rationale), 512) })
  if (d.context != null) fields.push({ name: 'Context', value: sanitizeDiscordMultiline(String(d.context), 512) })
  return { description: '**Universe Selected**', fields }
}

function formatModeChangeEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const oldMode = sanitizeLine(String(d.oldMode ?? d.from ?? ''), 24).toUpperCase()
  const newMode = sanitizeLine(String(d.newMode ?? d.to ?? ''), 24).toUpperCase()
  const desc = oldMode && newMode ? `**${oldMode} -> ${newMode}**` : undefined
  const fields: DiscordEmbedField[] = []
  if (!desc && typeof d.mode === 'string' && d.mode.trim()) {
    fields.push({ name: 'Mode', value: sanitizeLine(d.mode, 64).toUpperCase(), inline: true })
  }
  return { description: desc, fields }
}

function formatTradeExecutedEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const symbol = sanitizeLine(String(d.symbol ?? ''), 24).toUpperCase()
  const side = sanitizeLine(String(d.side ?? d.direction ?? ''), 12).toUpperCase()
  const size = d.size ?? d.qty ?? d.quantity ?? null
  const price = d.price ?? d.px ?? null
  const pnl = d.pnlUsd ?? d.pnlImpactUsd ?? d.pnlImpact ?? null
  const parts = [symbol, side].filter(Boolean)
  const desc = parts.length > 0 ? parts.join(' ') : 'Trade executed'
  const fields: DiscordEmbedField[] = []
  if (size != null) fields.push({ name: 'Size', value: sanitizeLine(String(size), 32), inline: true })
  if (price != null) fields.push({ name: 'Price', value: sanitizeLine(String(price), 32), inline: true })
  if (pnl != null) fields.push({ name: 'PnL', value: fmtUsd(typeof pnl === 'string' ? Number(pnl) : pnl), inline: true })
  return { description: `**${desc}**`, fields }
}

function fallbackJsonEmbed(details: unknown): DiscordEmbedResult {
  const json = summarizeDetailsForDiscord(details, 1800).replace(/```/g, '``')
  return { description: json ? `\`\`\`json\n${sanitizeDiscordMultiline(json, 1800)}\n\`\`\`` : undefined }
}

const DISCORD_FORMATTERS: Record<string, (d: Record<string, unknown>) => DiscordEmbedResult> = {
  'research.report': formatResearchReportEmbed,
  'risk.report': formatRiskReportEmbed,
  'risk.decision': formatRiskDecisionEmbed,
  'strategist.directive': formatStrategistDirectiveEmbed,
  'agent.proposal': formatAgentProposalEmbed,
  'agent.proposal.invalid': formatProposalInvalidEmbed,
  'analysis.report': formatAnalysisReportEmbed,
  'agent.error': formatAgentErrorEmbed,
  'intel.refresh': formatIntelRefreshEmbed,
  'universe.selected': formatUniverseSelectedEmbed,
  'mode.change': formatModeChangeEmbed,
  'execution.mode': formatModeChangeEmbed,
  'trade.executed': formatTradeExecutedEmbed,
}

function queueJournalWrite(event: AuditEvent): void {
  const shouldWriteGitHub = env.AGENT_GITHUB_JOURNAL_ENABLED && isGitHubJournalEnabled()
  const shouldWriteLocal = env.AGENT_JOURNAL_ENABLED || (shouldWriteGitHub && isGitHubJournalFlushEnabled())
  if (!shouldWriteLocal && !shouldWriteGitHub) {
    return
  }
  const { localPath, githubPath } = resolveJournalPaths(event)

  const record = {
    ...event,
    source: 'agent-runner',
    level: deriveAuditLevel(event),
    writtenAt: new Date().toISOString()
  }
  const line = (() => {
    try {
      return `${JSON.stringify(record)}\n`
    } catch {
      return `${JSON.stringify({
        ...record,
        details: typeof record.details === 'object' ? '[unserializable]' : String(record.details)
      })}\n`
    }
  })()
  const localPromise = async () => {
    if (!shouldWriteLocal) {
      return
    }

    try {
      await ensureJournalDirectoryForPath(localPath)
      await fs.appendFile(localPath, line, 'utf8')
    } catch (error) {
      console.error(`agent journal append failed path=${localPath}`, error)
    }
  }
  const githubPromise = async () => {
    if (!shouldWriteGitHub) {
      return
    }

    if (isGitHubJournalFlushEnabled()) {
      markGitHubJournalForIntervalFlush({ localPath, githubPath })
      return
    }

    await appendGitHubJournalLine(line, String(record.action), githubPath)
  }

  journalWriteChain = journalWriteChain.then(localPromise)
  githubJournalWriteChain = githubJournalWriteChain.then(githubPromise)
}

function discordFingerprint(event: AuditEvent): string {
  return `${event.resource}:${event.action}:${event.correlationId}`
}

function truncateWithEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

function sanitizeDiscordMultiline(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/\r\n/g, '\n')
  return truncateWithEllipsis(cleaned, maxLength)
}

function discordEmbedColor(level: AuditLevel): number {
  if (level === 'ERROR') return 0xff0000
  if (level === 'WARN') return 0xffaa00
  return 0x00ff00
}


async function notifyDiscord(event: AuditEvent): Promise<void> {
  if (!isDiscordActionAllowed(event.action)) {
    return
  }

  const action = sanitizeLine(event.action, 120)
  const correlationId = sanitizeLine(event.correlationId, 120)
  const fingerprint = discordFingerprint(event)
  const nowMs = Date.now()
  const lastSent = lastDiscordNotifyByFingerprint.get(fingerprint) ?? 0
  if (nowMs - lastSent < env.DISCORD_WEBHOOK_COOLDOWN_MS) {
    return
  }

  const level = deriveAuditLevel(event)
  const title = level === 'ERROR' ? `💀 ${action}` : action
  const embedFields: DiscordEmbedField[] = [
    { name: 'resource', value: sanitizeLine(event.resource, 256) || '--', inline: true },
    { name: 'actor', value: sanitizeLine(`${event.actorType}/${event.actorId}`, 256) || '--', inline: true },
    { name: 'correlation', value: correlationId || '--', inline: true },
  ]

  const detailsRecord = (event.details && typeof event.details === 'object') ? (event.details as Record<string, unknown>) : {}

  const tradeActions = event.action === 'trade.executed' || event.action === 'execution' || event.action.startsWith('trade.')
  const formatterKey = tradeActions && !DISCORD_FORMATTERS[event.action] ? 'trade.executed' : event.action
  const formatter = DISCORD_FORMATTERS[formatterKey]
  const result = formatter ? formatter(detailsRecord) : fallbackJsonEmbed(event.details)
  if (result.fields) embedFields.push(...result.fields)
  const description = result.description

  const embed: DiscordEmbed = {
    title,
    color: discordEmbedColor(level),
    fields: embedFields,
    description,
    footer: { text: sanitizeLine(event.ts, 2048) || new Date().toISOString() },
    timestamp: sanitizeLine(event.ts, 40) || undefined,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.DISCORD_WEBHOOK_TIMEOUT_MS)
  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: controller.signal
    })

    if (!response.ok) {
      console.error(`discord webhook failed status=${response.status} action=${action}`)
      return
    }

    lastDiscordNotifyByFingerprint.set(fingerprint, nowMs)
  } catch (error) {
    console.error(`discord webhook error action=${action}`, error)
  } finally {
    clearTimeout(timeout)
  }
}

let codexDisabledUntilMs = 0

function parseCodexUsageLimit(message: string): { summary: string; tryAgainAtMs: number | null } | null {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const usageLine = lines.find((line) => line.includes("You've hit your usage limit for"))
  if (!usageLine) {
    return null
  }

  const normalized = usageLine.replace(/^ERROR:\s*/i, '')
  const match = normalized.match(/Try again at\s+(.+?)\.?$/i)
  if (!match) {
    return { summary: normalized, tryAgainAtMs: null }
  }

  const raw = match[1] ?? ''
  // The CLI message uses ordinal suffixes (e.g. "14th"), which Date.parse won't understand.
  const cleaned = raw.replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1').trim()
  const parsed = Date.parse(cleaned)
  const tryAgainAtMs = Number.isFinite(parsed) ? parsed : null
  return { summary: normalized, tryAgainAtMs }
}

function summarizeCodexError(error: unknown): string {
  const message = String(error ?? '')
  const usage = parseCodexUsageLimit(message)
  if (usage) {
    return sanitizeLine(usage.summary, 200)
  }

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  // Prefer the most specific failure line, when present.
  const lastErrorLine = [...lines].reverse().find((line) => line.startsWith('ERROR:'))
  if (lastErrorLine) {
    return sanitizeLine(lastErrorLine.replace(/^ERROR:\s*/i, ''), 200)
  }

  return sanitizeLine(message, 200)
}

function maybeDisableCodexFromError(error: unknown, nowMs: number): { untilMs: number; reason: string } | null {
  const message = String(error ?? '')
  const usage = parseCodexUsageLimit(message)
  if (!usage) {
    return null
  }

  // Fail-closed: if we can't parse the time, back off briefly to avoid hammering the CLI.
  const untilMs = usage.tryAgainAtMs ?? nowMs + 60_000
  if (untilMs <= codexDisabledUntilMs) {
    return null
  }

  codexDisabledUntilMs = untilMs
  return { untilMs, reason: usage.summary }
}

function llmForRole(role: FloorRole, nowMs = Date.now()): LlmChoice {
  const base = env.AGENT_LLM
  let chosen: LlmChoice = base
  if (role === 'research') {
    chosen = env.AGENT_RESEARCH_LLM ?? base
  } else if (role === 'risk') {
    chosen = env.AGENT_RISK_LLM ?? base
  } else if (role === 'strategist' || role === 'execution') {
    chosen = env.AGENT_STRATEGIST_LLM ?? base
  } else if (role === 'scribe') {
    chosen = env.AGENT_SCRIBE_LLM ?? base
  }

  // Circuit-break Codex when its CLI reports a usage limit to avoid repeated failures.
  if (chosen === 'codex' && codexDisabledUntilMs > nowMs) {
    return 'claude'
  }

  return chosen
}

function computeTargetNotional(baseTargetNotional: number, signals: PluginSignal[]): number {
  const latestVolatility = [...signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestFunding = [...signals].reverse().find((signal) => signal.signalType === 'funding')

  let scale = 1
  if (latestVolatility) {
    const volatilityScale = 1 - Math.min(0.4, Math.abs(latestVolatility.value) / 25)
    scale *= Math.max(0.6, volatilityScale)
  }

  if (latestFunding) {
    scale *= latestFunding.value > 0 ? 0.95 : 1.05
  }

  return Number(Math.max(100, baseTargetNotional * scale).toFixed(2))
}

function leverageAwareBaseTargetNotionalUsd(fallbackBaseUsd: number): number {
  const base = Math.max(100, Number(fallbackBaseUsd) || 0)
  const accountValueUsd = Number((lastStateUpdate as { accountValueUsd?: unknown } | null)?.accountValueUsd)
  if (!Number.isFinite(accountValueUsd) || accountValueUsd <= 0) {
    return base
  }

  const policy = resolveRiskLimitsForContext()
  const leverageCap = Math.max(0.1, policy.maxLeverage)
  const rawTarget = Number.isFinite(policy.targetLeverage) && policy.targetLeverage > 0 ? policy.targetLeverage : leverageCap
  const targetLeverage = clamp(rawTarget, 0.1, leverageCap)

  const leverageTarget = accountValueUsd * targetLeverage
  const cappedByExposure = policy.maxExposureUsd > 0 ? Math.min(leverageTarget, policy.maxExposureUsd) : leverageTarget
  return Number(Math.max(base, cappedByExposure).toFixed(2))
}

function bucketNotional(notionalUsd: number): 'XS' | 'S' | 'M' | 'L' | 'XL' {
  const n = Math.abs(notionalUsd)
  if (n < 50) return 'XS'
  if (n < 250) return 'S'
  if (n < 1000) return 'M'
  if (n < 5000) return 'L'
  return 'XL'
}

function renderLegSummary(legs: Array<{ symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number }>): string {
  return legs
    .map((leg) => `${leg.side} ${leg.symbol} [${bucketNotional(leg.notionalUsd)}]`)
    .join(' | ')
}

function computeExecutionTactics(params: { signals: PluginSignal[] }): { expectedSlippageBps: number; maxSlippageBps: number } {
  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const volPct = latestVolatility ? Math.abs(latestVolatility.value) : 0

  // Heuristic: scale expected slippage with volatility; cap at 12 bps expected.
  const expected = clamp(Math.round(2 + volPct * 0.25), 2, 12)
  const policy = resolveRiskLimitsForContext()
  const policyCap = Math.max(1, Math.round(policy.maxSlippageBps))

  // Keep max within policy.
  const max = clamp(Math.round(expected * 2), expected, policyCap)

  return { expectedSlippageBps: expected, maxSlippageBps: max }
}

const COMMON_AGENT_PROMPT_PREAMBLE: string[] = [
  'Core floor rules:',
  '- Objective: create fully discretionary long, short, and pair structures with explicit rationale and bounded risk.',
  '- Do not assume any fixed alpha symbol or fixed directional bias.',
  '- No direct order routing or execution control lives in this model; runtime + risk-engine are authoritative.',
  '- If context is stale, contradictory, or incomplete, choose conservative actions.',
  '- Never invent symbols, metrics, or events not present in context.',
  '- Return strictly structured JSON only, no commentary.',
  '- Prioritize stability and avoid unnecessary churn.',
  '- Use latest risk decisions to drive recovery: when a recent DENY cites DRAWDOWN/EXPOSURE/LEVERAGE/SAFE_MODE/DEPENDENCY_FAILURE, require immediate risk-reduction first.',
  '- If risk posture requires reduction, do not scale up notional or propose growth-facing changes.',
  '- Preserve risk budgets: prioritize reduced gross/uncertainty first, then re-enable sizing only after reduced-risk state is confirmed.',
  '- All non-EXIT proposals must state expected gross/notional outcome and never exceed recovery constraints.',
  '- Treat SAFE_MODE and DEPENDENCY_FAILURE as hard-reduce states: request only flat/close actions until state is cleared.',
  '- Budget caps are explicit in floor context: max leverage/exposure/drawdown/slippage are hard constraints; do not propose beyond them.',
  '- Use runtime recovery policy context in prompts before proposing growth; execution control is runtime-owned and available recovery command is /flatten.',
  '- Read the floor context memory every cycle: active directive, target risk caps, recent risk/posture tape, and current exposure before sizing any leg.',
  '- Keep proposals explicit about leverage and gross/notional impact; avoid growth when risk posture is constrained.',
  '- Proposals must reference current positions summary (gross/net/mode), estimated leverage, and strategy thesis before proposing any directional exposure.',
  '- Execution interactions are limited to runtime channels: /flatten and /risk-policy are available for safety interventions when caps should be tightened or growth blocked.'
]

const AGENT_DATA_SOURCES_PRESET: string[] = [
  'Mandatory research stack for this system:',
  '1) Hyperliquid orderbook + market controls',
  '   - https://api.hyperliquid.xyz/info',
  '   - https://api.hyperliquid.xyz/exchange',
  '   - https://api.hyperliquid.xyz/ws',
  '   - /apps/runtime (market-data consumer + risk gate)',
  '2) Social + narrative intelligence',
  '   - Twitter/X v2 recent search: https://api.twitter.com/2/tweets/search/recent',
  '   - Twitter/X docs: https://docs.x.com/x-api',
  `   - Credentials file (server): ${env.OPENCLAW_TWITTER_CREDS_PATH}`,
  '3) OpenClaw local data tooling (structured outputs)',
  `   - ${env.OPENCLAW_MARKET_DATA_PATH} snapshot`,
  `   - ${env.OPENCLAW_MARKET_DATA_PATH} funding`,
  `   - ${env.OPENCLAW_MARKET_DATA_PATH} tvl`,
  '4) Reference + SDK integration stack',
  '   - https://api.llama.fi',
  '   - https://yields.llama.fi',
  '   - https://docs.hyperliquid.xyz',
  '5) Broad market + sentiment context',
  '   - https://api.coingecko.com/api/v3/coins/list',
  '   - https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
  '   - https://api.coingecko.com/api/v3/global',
  '   - https://api.coingecko.com/api/v3/global/decentralized_finance_defi',
  '   - https://api.alternative.me/fng/',
  `   - Brave Search API: ${env.BRAVE_API_URL}`,
  '   - https://data-api.binance.com',
]

function buildAgentSourceAppendix(): string[] {
  return [...AGENT_DATA_SOURCES_PRESET]
}

const FLOOR_TAPE_CONTEXT_LINES = 12
const STRATEGY_CONTEXT_MAX_AGE_MS = 120_000
const DECK_STATUS_HEARTBEAT_MS = 60_000
const STRATEGIST_NO_ACTION_SUPPRESS_MS = 60_000

type FloorTapeLine = {
  ts: string
  role: string
  level: 'INFO' | 'WARN' | 'ERROR'
  line: string
}

type FloorTapePromptEntry = {
  role: string
  level: 'INFO' | 'WARN' | 'ERROR'
  ageMs: number | null
  line: string
}

const RISK_RECOVERY_FORCE_EXIT_CODES = new Set([
  'FAIL_CLOSED',
  'ACTOR_NOT_ALLOWED',
  'DRAWDOWN',
  'EXPOSURE',
  'LEVERAGE',
  'SAFE_MODE',
  'DEPENDENCY_FAILURE',
  'NOTIONAL_PARITY',
  'SYSTEM_GATED',
  'STALE_DATA',
  'LIQUIDITY',
  'SLIPPAGE_BREACH',
  'SYSTEM_GATED'
])
const RISK_RECOVERY_TTL_MS = 120_000
const RISK_POLICY_TUNING_COOLDOWN_MS = 120_000

let claudeAvailableCached: boolean | null = null

async function isClaudeAvailable(): Promise<boolean> {
  if (claudeAvailableCached !== null) {
    return claudeAvailableCached
  }

  const available = await isCommandAvailable('claude')
  claudeAvailableCached = available
  return available
}

type RuntimeRiskReason = {
  code: string
  message: string
  details?: Record<string, unknown>
}

type RuntimeRiskDecision = {
  decision?: 'ALLOW' | 'ALLOW_REDUCE_ONLY' | 'DENY'
  reasons?: RuntimeRiskReason[]
  computedAt?: string
  computed?: {
    grossExposureUsd: number
    netExposureUsd: number
    projectedDrawdownPct: number
    notionalImbalancePct: number
  }
  decisionId?: string
  proposalCorrelation?: string
}

type RuntimeStateRiskMessage = {
  atMs: number
  message: string
  reasonCodes: string[]
  signature: string
}

type InterAgentRoleContext = {
  lastRunAtMs: number | null
  ageMs: number | null
  status: 'never' | 'stale' | 'fresh'
  source: 'memory' | 'heartbeat'
}

function summarizeInterAgentContext(nowMs = Date.now()): Record<string, InterAgentRoleContext> {
  const staleThresholdMs = Math.max(STRATEGY_CONTEXT_MAX_AGE_MS, env.AGENT_OPS_INTERVAL_MS * 3)

  const entries: Record<string, InterAgentRoleContext> = {}
  entries.research = toInterAgentRoleContext(lastResearchAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.risk = toInterAgentRoleContext(lastRiskAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.strategist = toInterAgentRoleContext(lastDirectiveAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.scribe = toInterAgentRoleContext(lastAnalysisAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.ops = toInterAgentRoleContext(lastOpsAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.scout = toInterAgentRoleContext(lastProposalPublishedAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.execution = toInterAgentRoleContext(lastProposalPublishedAt, nowMs, staleThresholdMs, 'heartbeat')
  return entries
}

function toInterAgentRoleContext(
  lastAtMs: number,
  nowMs: number,
  staleThresholdMs: number,
  source: 'memory' | 'heartbeat'
): InterAgentRoleContext {
  const ageMs = msSince(lastAtMs, nowMs)
  if (ageMs === null) {
    return { lastRunAtMs: null, ageMs: null, status: 'never', source }
  }
  return {
    lastRunAtMs: lastAtMs,
    ageMs,
    status: ageMs > staleThresholdMs ? 'stale' : 'fresh',
    source
  }
}

const floorTapeHistory: FloorTapeLine[] = []
let lastDeckStatusSignature = ''
let lastDeckStatusHeartbeatAtMs = 0

function compactReportFields(report: unknown, keep: readonly string[]): Record<string, unknown> | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return null
  }

  const source = report as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of keep) {
    if (!(key in source)) {
      continue
    }
    const value = source[key]
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 4)
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, 260)
    } else {
      out[key] = value
    }
  }
  return out
}

type LatestSignalEntry = {
  pluginId: string
  value: number
  ts: string
  ageMs: number | null
}

function summarizeLatestSignals(nowMs = Date.now()): Record<string, LatestSignalEntry[]> {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now()
  const latest: Record<string, LatestSignalEntry[]> = {}

  for (const signal of latestSignals.values()) {
    if (typeof signal.signalType !== 'string' || !Number.isFinite(signal.value)) {
      continue
    }

    const tsMs = safeDateMs(signal.ts)
    if (tsMs === null) {
      continue
    }
    const entries = latest[signal.signalType] ?? []
    entries.push({
      pluginId: String(signal.pluginId ?? 'unknown'),
      value: Number(signal.value),
      ts: typeof signal.ts === 'string' ? signal.ts : new Date(tsMs).toISOString(),
      ageMs: msSince(tsMs, safeNowMs)
    })
    latest[signal.signalType] = entries
  }

  const out: Record<string, LatestSignalEntry[]> = {}
  for (const [signalType, entries] of Object.entries(latest)) {
    out[signalType] = entries
      .map((entry) => ({ ...entry }))
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, 3)
  }
  return out
}

function latestSignalFromPack(
  signals: Record<string, LatestSignalEntry[]>,
  signalType: string
): { value: number; ts: string } | null {
  const latest = signals[signalType]?.[0]
  if (!latest || !Number.isFinite(latest.value)) {
    return null
  }
  return {
    value: latest.value,
    ts: latest.ts
  }
}

function summarizePositionsForPrompt(positions: OperatorPosition[]): {
  count: number
  symbols: string[]
  longNotionalUsd: number
  shortNotionalUsd: number
  grossNotionalUsd: number
  netNotionalUsd: number
  drift: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'
  posture: 'GREEN' | 'AMBER' | 'RED'
  topPositions: Array<{
    symbol: string
    side: 'LONG' | 'SHORT'
    notionalBucket: string
    absNotionalUsd: number
  }>
} {
  const drift = summarizePositionsForAgents(positions)
  let longNotionalUsd = 0
  let shortNotionalUsd = 0

  const topPositions = positions
    .filter((position) => Number.isFinite(position.notionalUsd))
    .map((position) => {
      const side = position.side
      const absNotionalUsd = Math.abs(position.notionalUsd)
      if (side === 'LONG') {
        longNotionalUsd += absNotionalUsd
      } else {
        shortNotionalUsd += absNotionalUsd
      }

      return {
        symbol: String(position.symbol ?? '').toUpperCase(),
        side,
        notionalBucket: bucketNotional(absNotionalUsd),
        absNotionalUsd: Number(absNotionalUsd.toFixed(2))
      }
    })
    .sort((a, b) => b.absNotionalUsd - a.absNotionalUsd)
    .slice(0, 12)

  return {
    count: positions.length,
    symbols: [...new Set(positions.map((position) => String(position.symbol ?? '').toUpperCase()))].sort(),
    longNotionalUsd: Number(longNotionalUsd.toFixed(2)),
    shortNotionalUsd: Number(shortNotionalUsd.toFixed(2)),
    grossNotionalUsd: Number((longNotionalUsd + shortNotionalUsd).toFixed(2)),
    netNotionalUsd: Number((longNotionalUsd - shortNotionalUsd).toFixed(2)),
    drift: drift.drift,
    posture: drift.posture,
    topPositions
  }
}

function summarizeFloorTapeForPrompt(nowMs = Date.now()): FloorTapePromptEntry[] {
  return floorTapeHistory.map((entry) => ({
    role: entry.role,
    level: entry.level,
    ageMs: msSince(safeDateMs(entry.ts) ?? nowMs, nowMs),
    line: entry.line
  }))
}

function summarizeProposalForContext(proposal: StrategyProposal | null): Record<string, unknown> | null {
  if (!proposal) {
    return null
  }

  const firstAction = proposal.actions?.[0]
  return {
    proposalId: proposal.proposalId,
    summary: proposal.summary,
    actionType: firstAction?.type,
    confidence: proposal.confidence,
    requestedMode: proposal.requestedMode,
    rationale: firstAction?.rationale,
    expectedSlippageBps: firstAction?.expectedSlippageBps,
    maxSlippageBps: firstAction?.maxSlippageBps
  }
}

function ageBucket(ms: number | null): 'fresh' | 'aging' | 'stale' | 'absent' {
  if (ms === null) {
    return 'absent'
  }
  if (ms <= 30_000) {
    return 'fresh'
  }
  if (ms <= 120_000) {
    return 'aging'
  }
  return 'stale'
}

function resolveRiskLimitsForContext(): {
  maxLeverage: number
  targetLeverage: number
  maxDrawdownPct: number
  maxExposureUsd: number
  maxSlippageBps: number
  staleDataMs: number
  liquidityBufferPct: number
  notionalParityTolerance: number
} {
  const policy = lastStateUpdate?.riskPolicy
  return {
    maxLeverage: Number.isFinite(policy?.maxLeverage as number | undefined) ? (policy?.maxLeverage as number) : env.RISK_MAX_LEVERAGE,
    targetLeverage: Number.isFinite(policy?.targetLeverage as number | undefined)
      ? (policy?.targetLeverage as number)
      : Number.isFinite(policy?.maxLeverage as number | undefined)
        ? (policy?.maxLeverage as number)
        : env.RISK_MAX_LEVERAGE,
    maxDrawdownPct: Number.isFinite(policy?.maxDrawdownPct as number | undefined) ? (policy?.maxDrawdownPct as number) : env.RISK_MAX_DRAWDOWN_PCT,
    maxExposureUsd: Number.isFinite(policy?.maxExposureUsd as number | undefined) ? (policy?.maxExposureUsd as number) : env.RISK_MAX_NOTIONAL_USD,
    maxSlippageBps: Number.isFinite(policy?.maxSlippageBps as number | undefined) ? (policy?.maxSlippageBps as number) : env.RISK_MAX_SLIPPAGE_BPS,
    staleDataMs: Number.isFinite(policy?.staleDataMs as number | undefined) ? (policy?.staleDataMs as number) : env.RISK_STALE_DATA_MS,
    liquidityBufferPct: Number.isFinite(policy?.liquidityBufferPct as number | undefined)
      ? (policy?.liquidityBufferPct as number)
      : env.RISK_LIQUIDITY_BUFFER_PCT,
    notionalParityTolerance: Number.isFinite(policy?.notionalParityTolerance as number | undefined)
      ? (policy?.notionalParityTolerance as number)
      : env.RISK_NOTIONAL_PARITY_TOLERANCE
  }
}

function summarizeActiveBasketContext(context: UniverseSelection['context'] | undefined): Record<string, unknown> | null {
  if (!context) {
    return null
  }

  return {
    featureWindowMin: context.featureWindowMin,
    hasPriceBase: !!context.priceBase,
    priceSymbols: Object.keys(context.priceBySymbol ?? {}).sort().slice(0, 12),
    coingecko: context.coingecko
      ? {
        enabled: true,
        coveragePct: context.coingecko.coveragePct,
        sectorTopGainers: (context.coingecko.sectorTopGainers ?? []).slice(0, 3),
        sectorTopLosers: (context.coingecko.sectorTopLosers ?? []).slice(0, 3)
      }
      : null
  }
}

const PROMPT_CONTEXT_MAX_CHARS = 65000

function toPromptPayload(value: unknown): string {
  const raw = JSON.stringify(value)
  if (raw.length <= PROMPT_CONTEXT_MAX_CHARS) {
    return raw
  }

  const fallback = {
    truncated: true,
    length: raw.length,
    limit: PROMPT_CONTEXT_MAX_CHARS,
    payload: raw.slice(0, Math.max(0, PROMPT_CONTEXT_MAX_CHARS - 200))
  }
  return JSON.stringify(fallback)
}

function buildCrewFloorContext(nowMs = Date.now()): Record<string, unknown> {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const signals = summarizeLatestSignals(now)
  const marketUniverse = [
    ...new Set([
      ...activeBasket.symbols,
      ...lastPositions.map((position) => String(position.symbol ?? '').trim().toUpperCase()).filter(Boolean)
    ])
  ]
  const marketFeed = tickStalenessMs(marketUniverse)
  const signalAges = Object.values(signals)
    .flatMap((entries) => entries.map((entry) => entry.ageMs ?? null))
    .filter((entry): entry is number => entry !== null)

  const freshSignalAges = signalAges.filter((ageMs) => ageMs <= 30_000).length
  const staleSignalAges = signalAges.filter((ageMs) => ageMs > 120_000).length

  const basketAgeMs = msSince(Date.parse(activeBasket.selectedAt), now)

  return {
    objective: `Fully discretionary long, short, and pair structure planning with bounded risk and explicit thesis.`,
    generatedAt: new Date(now).toISOString(),
    mode: lastMode,
    requestedMode: requestedModeFromEnv(),
    stateUpdate: lastStateUpdate ?? null,
    risk: {
      autoHaltActive,
      autoHaltHealthySinceMs: autoHaltHealthySinceMs > 0 ? now - autoHaltHealthySinceMs : 0,
      lastRiskDecision
    },
    market: {
      universe: marketUniverse,
      tickAgeMs: marketFeed.maxAgeMs,
      missingTickSymbols: marketFeed.missing,
      stalenessBucket: ageBucket(marketFeed.maxAgeMs),
      signalCoverage: {
        signalTypes: Object.keys(signals).length,
        latestSignalCount: signalAges.length,
        freshSignalCount: freshSignalAges,
        staleSignalCount: staleSignalAges
      }
    },
    signals: signals,
    positions: summarizePositionsForPrompt(lastPositions),
    directive: activeDirective,
    universe: {
      symbols: activeBasket.symbols,
      rationale: activeBasket.rationale,
      selectedAt: activeBasket.selectedAt,
      ageMs: basketAgeMs,
      ageBucket: ageBucket(basketAgeMs),
      context: summarizeActiveBasketContext(activeBasket.context)
    },
    pivot:
      basketPivot === null
        ? null
      : {
          startedAt: new Date(basketPivot.startedAtMs).toISOString(),
          expiresAt: new Date(basketPivot.expiresAtMs).toISOString(),
          remainingMs: basketPivot.expiresAtMs - Date.now(),
          symbols: basketPivot.basketSymbols
        },
	    floorAgents: {
	      heartbeatMs: STRATEGY_CONTEXT_MAX_AGE_MS,
	      roles: summarizeInterAgentContext(now),
	      lastReports: {
	        research: compactReportFields(lastResearchReport, ['headline', 'regime', 'recommendation', 'confidence', 'computedAt']),
        risk: compactReportFields(lastRiskReport, ['headline', 'posture', 'risks', 'confidence', 'computedAt']),
        scribe: compactReportFields(lastScribeAnalysis, ['headline', 'thesis', 'risks', 'confidence', 'computedAt']),
        strategistDirective: {
          decision: activeDirective.decision,
          plan: activeDirective.plan === null ? null : {
            timeHorizonHours: activeDirective.plan.timeHorizonHours,
            riskBudget: activeDirective.plan.riskBudget,
            notes: activeDirective.plan.notes
          },
          decidedAt: activeDirective.decidedAt,
          rationale: activeDirective.rationale,
          confidence: activeDirective.confidence
        },
        latestProposal: summarizeProposalForContext(lastProposal)
	      },
	      tape: summarizeFloorTapeForPrompt(now).slice(-FLOOR_TAPE_CONTEXT_LINES)
	    },
	    intel: lastExternalIntel ? summarizeExternalIntel(lastExternalIntel) : null,
	    memory: {
	      lastProposal: lastProposal
	        ? {
	          proposalId: lastProposal.proposalId,
	          actionType: lastProposal.actions?.[0]?.type,
          summary: lastProposal.summary,
          requestedMode: lastProposal.requestedMode,
          confidence: lastProposal.confidence
        }
        : null,
      research: compactReportFields(lastResearchReport, ['headline', 'regime', 'recommendation', 'confidence', 'computedAt']),
      risk: compactReportFields(lastRiskReport, ['headline', 'posture', 'risks', 'confidence', 'computedAt']),
      scribe: compactReportFields(lastScribeAnalysis, ['headline', 'thesis', 'risks', 'confidence', 'computedAt'])
    },
    governance: {
      universeSize: env.AGENT_UNIVERSE_SIZE,
      featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
      targetNotionalUsd: env.AGENT_TARGET_NOTIONAL_USD,
      minLegNotionalUsd: env.AGENT_MIN_REBALANCE_LEG_USD,
      riskLimits: {
        ...resolveRiskLimitsForContext()
      },
      runtimeRecovery: {
        automaticExitSignal: 'AUTO_EXIT when risk decisions block with DRAWDOWN/EXPOSURE/LEVERAGE/SAFE_MODE/DEPENDENCY_FAILURE/LIQUIDITY/STALE_DATA/SYSTEM_GATED',
        defaultRecoveryCommand: '/flatten'
      }
    }
  }
}

const EXIT_NOTIONAL_EPSILON_USD = env.RUNTIME_FLAT_DUST_NOTIONAL_USD

function parseRiskReasonCodes(decision: RuntimeRiskDecision | null): string[] {
  if (!decision || !Array.isArray(decision.reasons)) {
    return []
  }

  return decision.reasons
    .map((entry) => String(entry?.code ?? '').trim().toUpperCase())
    .filter((code) => code.length > 0)
}

function parseRiskStateMessageReasonCodes(message: string): string[] {
  const normalized = message.trim().toUpperCase()
  if (!/RISK DENIED/.test(normalized) && !/\bRED:/.test(normalized)) {
    return []
  }

  const normalizedCandidates = new Set<string>()
  const knownCodes = [
    'DRAWDOWN',
    'EXPOSURE',
    'LEVERAGE',
    'SAFE_MODE',
    'DEPENDENCY_FAILURE',
    'STALE_DATA',
    'LIQUIDITY',
    'SYSTEM_GATED',
    'NOTIONAL_PARITY',
    'SLIPPAGE_BREACH',
    'ACTOR_NOT_ALLOWED',
    'FAIL_CLOSED',
    'FAILSAFE_CLOSED'
  ]

  for (const code of knownCodes) {
    if (normalized.includes(code)) {
      normalizedCandidates.add(code)
    }
  }

  const tokenCodes = normalized.match(/[A-Z_]{3,}/g) ?? []
  for (const token of tokenCodes) {
    if (RISK_RECOVERY_FORCE_EXIT_CODES.has(token)) {
      normalizedCandidates.add(token)
    }
  }

  if (/\b(HOLD FLAT|CONSERVATIVE|FLATTEN|CLEAN|BLOCK|BLOCKED)\b/.test(normalized)) {
    normalizedCandidates.add('SYSTEM_GATED')
  }

  if (/\bDRAWDOWN\b/.test(normalized)) {
    normalizedCandidates.add('DRAWDOWN')
  }

  if (/\bSTALE\b/.test(normalized)) {
    normalizedCandidates.add('STALE_DATA')
  }

  return normalizeReasonCodes(Array.from(normalizedCandidates))
}

function normalizeReasonCodes(reasonCodes: string[]): string[] {
  const unique = Array.from(new Set(reasonCodes.filter((code) => code.length > 0)))
  unique.sort()
  return unique
}

function parseRiskStateMessage(message: string, observedAtMs: number): RuntimeStateRiskMessage | null {
  const reasonCodes = parseRiskStateMessageReasonCodes(message)
  if (!reasonCodes.length) {
    if (!/RISK DENIED/.test(message.toUpperCase())) {
      return null
    }

    return {
      atMs: observedAtMs,
      message: message.trim(),
      reasonCodes: ['UNSPECIFIED_DENY'],
      signature: 'UNSPECIFIED_DENY'
    }
  }

  return {
    atMs: observedAtMs,
    message: message.trim(),
    reasonCodes,
    signature: reasonCodes.join('|')
  }
}

function buildRiskRecoveryFromDecision(nowMs: number): {
  active: boolean
  signature: string
  reasonCodes: string[]
  computed: RuntimeRiskDecision['computed'] | undefined
  reasonMessage: string
} {
  if (!lastRiskDecision || lastRiskDecision.decision !== 'DENY' || !lastRiskDecision.computedAt) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  const parsedAt = Date.parse(lastRiskDecision.computedAt)
  if (!Number.isFinite(parsedAt) || !Number.isFinite(nowMs - parsedAt) || nowMs - parsedAt > RISK_RECOVERY_TTL_MS) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  const reasonCodes = normalizeReasonCodes(parseRiskReasonCodes(lastRiskDecision))
  if (reasonCodes.length === 0) {
    return {
      active: true,
      signature: 'UNSPECIFIED_DENY',
      reasonCodes: ['UNSPECIFIED_DENY'],
      computed: lastRiskDecision.computed,
      reasonMessage: 'risk denied without structured reason codes'
    }
  }

  const blockingCodes = reasonCodes.filter((code) => RISK_RECOVERY_FORCE_EXIT_CODES.has(code))
  if (blockingCodes.length === 0) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  return {
    active: true,
    signature: blockingCodes.join('|'),
    reasonCodes: blockingCodes,
    computed: lastRiskDecision.computed,
    reasonMessage: `risk denied for ${blockingCodes.join(', ')}`
  }
}

function buildRiskRecoveryFromStateUpdate(nowMs: number): {
  active: boolean
  signature: string
  reasonCodes: string[]
  reasonMessage: string
} {
  if (!lastStateRiskMessage) {
    return { active: false, signature: '', reasonCodes: [], reasonMessage: '' }
  }

  if (!Number.isFinite(lastStateRiskMessage.atMs)) {
    return { active: false, signature: '', reasonCodes: [], reasonMessage: '' }
  }

  if (nowMs - lastStateRiskMessage.atMs > RISK_RECOVERY_TTL_MS) {
    return { active: false, signature: '', reasonCodes: [], reasonMessage: '' }
  }

  if (!lastStateRiskMessage.reasonCodes.length) {
    return { active: false, signature: '', reasonCodes: [], reasonMessage: '' }
  }

  const reasonCodes = normalizeReasonCodes(lastStateRiskMessage.reasonCodes)
  const blockingCodes = reasonCodes.filter((code) => RISK_RECOVERY_FORCE_EXIT_CODES.has(code))
  if (blockingCodes.length === 0) {
    return { active: false, signature: '', reasonCodes: [], reasonMessage: '' }
  }

  return {
    active: true,
    signature: blockingCodes.join('|'),
    reasonCodes: blockingCodes,
    reasonMessage: `risk denied for ${blockingCodes.join(', ')}`
  }
}

function buildRiskPolicyArgsFromRecommendations(
  recommendations: RiskPolicyRecommendation
): { args: string[]; reason: string } | null {
  const args: string[] = []

  if (typeof recommendations.maxDrawdownPct === 'number') {
    args.push(`maxDrawdownPct=${recommendations.maxDrawdownPct.toFixed(2)}`)
  }
  if (typeof recommendations.maxLeverage === 'number') {
    args.push(`maxLeverage=${recommendations.maxLeverage.toFixed(3)}`)
  }
  if (typeof recommendations.maxExposureUsd === 'number') {
    args.push(`maxExposureUsd=${Math.round(recommendations.maxExposureUsd)}`)
  }
  if (typeof recommendations.maxSlippageBps === 'number') {
    args.push(`maxSlippageBps=${Math.round(recommendations.maxSlippageBps)}`)
  }
  if (typeof recommendations.notionalParityTolerance === 'number') {
    args.push(`notionalParityTolerance=${recommendations.notionalParityTolerance.toFixed(4)}`)
  }

  if (args.length === 0) {
    return null
  }

  return {
    args,
    reason: 'risk agent policy recommendation'
  }
}

function shouldForceRiskRecovery(nowMs: number, _positions: OperatorPosition[]): {
  active: boolean
  signature: string
  reasonCodes: string[]
  computed: RuntimeRiskDecision['computed'] | undefined
  reasonMessage: string
} {
  const decisionRecovery = buildRiskRecoveryFromDecision(nowMs)
  const stateRecovery = buildRiskRecoveryFromStateUpdate(nowMs)
  const reasonCodes = normalizeReasonCodes([...decisionRecovery.reasonCodes, ...stateRecovery.reasonCodes])
  const hasBlockingCode = reasonCodes.some((code) => RISK_RECOVERY_FORCE_EXIT_CODES.has(code))
  const hasUnspecifiedDeny = reasonCodes.includes('UNSPECIFIED_DENY')

  if (reasonCodes.length === 0) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  if (!hasBlockingCode && !hasUnspecifiedDeny) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  const signature = reasonCodes.join('|')
  const explicitReasonCodes = reasonCodes.filter((code) => code !== 'UNSPECIFIED_DENY')
  const effectiveReasonCodes = hasBlockingCode ? explicitReasonCodes : ['UNSPECIFIED_DENY']
  const reasonMessage =
    effectiveReasonCodes.length > 0
      ? `risk denied for ${effectiveReasonCodes.join(', ')}`
      : 'risk denied'

  return {
    active: true,
    signature,
    reasonCodes: effectiveReasonCodes,
    computed: decisionRecovery.computed,
    reasonMessage
  }
}

function buildAgentPrompt(params: {
  role: string
  mission: string
  rules: readonly string[]
  schemaHint: string
  context: Record<string, unknown>
}): string {
  const nowMs = Date.now()
  return [
    `You are HL Privateer ${params.role}.`,
    `Mission: ${params.mission}`,
    '',
    ...COMMON_AGENT_PROMPT_PREAMBLE,
    '',
    'Data-source stack you can pull from autonomously:',
    ...buildAgentSourceAppendix(),
    '',
    'Role-specific constraints:',
    ...params.rules.map((rule) => `- ${rule}`),
    '',
    params.schemaHint,
    '',
    `BUILD_CONTEXT_MS=${nowMs}`,
    `FLOOR_CONTEXT=${toPromptPayload(buildCrewFloorContext(nowMs))}`,
    `TASK_CONTEXT=${toPromptPayload(params.context)}`
  ].join('\n')
}

const coinGeckoApiKey = env.COINGECKO_API_KEY?.trim()
const coinGecko = coinGeckoApiKey
  ? createCoinGeckoClient({
    apiKey: coinGeckoApiKey,
    baseUrl: env.COINGECKO_BASE_URL,
    timeoutMs: env.COINGECKO_TIMEOUT_MS
  })
  : null

type UniverseCandidate = {
  symbol: string
  maxLeverage: number
  dayNtlVlmUsd: number
  openInterest: number
  openInterestUsd: number
  funding: number
  premium: number
  markPx: number
}

type DirectivePlan = {
  legs: DiscretionaryLeg[]
  timeHorizonHours: number | null
  riskBudget: {
    maxGrossNotionalUsd: number | null
    maxNetNotionalUsd: number | null
    maxLeverage: number | null
  }
  notes: string
}

type DiscretionaryLeg = {
  symbol: string
  side: 'LONG' | 'SHORT'
  notionalUsd: number
}

type UniverseSelection = {
  symbols: string[]
  rationale: string
  selectedAt: string
  context?: {
    featureWindowMin: number
    priceBase: PriceFeature | null
    priceBySymbol: Record<string, PriceFeature>
    coingecko?: {
      marketsBySymbol: Record<string, CoinGeckoMarketSnapshot>
      coinCategoriesBySymbol: Record<string, string[]>
      sectorTopLosers: Array<{ name: string; marketCapChange24hPct: number | null }>
      sectorTopGainers: Array<{ name: string; marketCapChange24hPct: number | null }>
      coveragePct: number
    }
  }
}

type StrategistDirectiveDecision = 'OPEN' | 'REBALANCE' | 'EXIT' | 'HOLD'

type StrategistDirective = {
  decision: StrategistDirectiveDecision
  plan: DirectivePlan | null
  rationale: string
  confidence: number
  decidedAt: string
}

function basketFromPositions(positions: OperatorPosition[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const position of positions) {
    const symbol = String(position.symbol ?? '').trim()
    if (!symbol) continue
    const key = symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(symbol)
  }

  // Stable ordering keeps audits/tape consistent across cycles.
  out.sort((a, b) => a.localeCompare(b))
  return out
}

function sameBasket(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].toUpperCase() !== right[i].toUpperCase()) return false
  }
  return true
}

function syncActiveBasketFromPositions(positions: OperatorPosition[]): void {
  if (positions.length === 0) {
    return
  }

  if (basketPivot) {
    const nowMs = Date.now()
    if (nowMs < basketPivot.expiresAtMs) {
      return
    }
    basketPivot = null
  }

  const heldBasket = basketFromPositions(positions)
  if (heldBasket.length === 0) {
    return
  }

  if (sameBasket(activeBasket.symbols, heldBasket)) {
    return
  }

  activeBasket = {
    symbols: heldBasket,
    rationale: 'synced from live positions',
    selectedAt: new Date().toISOString()
  }
}

let activeBasket: UniverseSelection = {
  symbols: [],
  rationale: 'seeded from dynamic strategy',
  selectedAt: new Date(0).toISOString()
}
let activeDirective: StrategistDirective = {
  decision: 'HOLD',
  plan: null,
  rationale: 'default directive',
  confidence: 0.3,
  decidedAt: new Date(0).toISOString()
}
let basketSelectInFlight = false
let directiveInFlight = false
let lastExitProposalSignature: string | null = null
let cachedUniverse: { assets: HyperliquidUniverseAsset[]; fetchedAtMs: number } = { assets: [], fetchedAtMs: 0 }
let basketPivot: { basketSymbols: string[]; startedAtMs: number; expiresAtMs: number } | null = null

async function fetchUniverseAssetsCached(nowMs: number): Promise<HyperliquidUniverseAsset[]> {
  // Keep a short cache to avoid hammering the info endpoint.
  if (cachedUniverse.assets.length > 0 && nowMs - cachedUniverse.fetchedAtMs < 60_000) {
    return cachedUniverse.assets
  }

  const assets = await fetchMetaAndAssetCtxs(env.HL_INFO_URL)
  cachedUniverse = { assets, fetchedAtMs: nowMs }
  return assets
}

function buildBasketCandidates(params: {
  assets: HyperliquidUniverseAsset[]
  perSymbolLiquidityBudgetUsd: number
  universeSize: number
}): UniverseCandidate[] {
  const all = params.assets
    .filter((asset) => asset.symbol && !asset.isDelisted)
    .map((asset) => ({
      symbol: asset.symbol,
      maxLeverage: asset.maxLeverage,
      dayNtlVlmUsd: asset.dayNtlVlmUsd,
      openInterest: asset.openInterest,
      openInterestUsd: asset.openInterest > 0 && asset.markPx > 0 ? asset.openInterest * asset.markPx : 0,
      funding: asset.funding,
      premium: asset.premium,
      markPx: asset.markPx
    }))
    .filter((asset) => Number.isFinite(asset.dayNtlVlmUsd) && asset.dayNtlVlmUsd > 0)
    .sort((a, b) => b.dayNtlVlmUsd - a.dayNtlVlmUsd)

  const minDayNtlVlmUsd = Math.max(0, params.perSymbolLiquidityBudgetUsd) * 100
  const filtered = minDayNtlVlmUsd > 0 ? all.filter((asset) => asset.dayNtlVlmUsd >= minDayNtlVlmUsd) : all

  // If we filter too aggressively for the configured size, fall back to the raw top-of-book list.
  const pool = filtered.length >= params.universeSize ? filtered : all
  return pool.slice(0, env.AGENT_UNIVERSE_CANDIDATE_LIMIT)
}

async function generateBasketSelection(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ basketSymbols: string[]; rationale: string }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      basketSymbols: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
      rationale: { type: 'string' }
    },
    required: ['basketSymbols', 'rationale']
  } as const

  if (params.llm === 'none') {
    return {
      basketSymbols: [],
      rationale: 'llm disabled'
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'universe-selector',
      mission: 'Select a high-quality discretionary opportunity set for the next strategy cycle.',
      rules: [
        'Choose ONLY from the provided candidate symbols.',
        'Prefer high liquidity (day notional volume + open interest).',
        'Prefer symbols with clear and recent signal clarity, but avoid crowded or unstable conditions.',
        'Favor diversified, liquid selections over concentrated micro-cap names.',
        'If context is weak, keep the opportunity set smaller and more conservative.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: {
        ...params.input,
        activeDirective: activeDirective
      }
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  return {
    basketSymbols: Array.isArray(raw.basketSymbols) ? raw.basketSymbols.map((s) => String(s)).slice(0, 12) : [],
    rationale: String(raw.rationale ?? '').slice(0, 600)
  }
}

function validateBasketSelection(params: { requested: string[]; allowed: UniverseCandidate[]; size: number }): string[] {
  const allowedByUpper = new Map<string, string>()
  for (const candidate of params.allowed) {
    allowedByUpper.set(candidate.symbol.toUpperCase(), candidate.symbol)
  }

  const picked: string[] = []
  for (const raw of params.requested) {
    const upper = String(raw).trim().toUpperCase()
    const canonical = allowedByUpper.get(upper)
    if (!canonical) {
      continue
    }
    if (picked.some((sym) => sym.toUpperCase() === canonical.toUpperCase())) {
      continue
    }
    picked.push(canonical)
    if (picked.length >= params.size) {
      break
    }
  }

  return picked
}

async function maybeSelectBasket(params: {
  targetNotionalUsd: number
  signals: PluginSignal[]
  positions: OperatorPosition[]
  force?: boolean
}): Promise<void> {
  const nowMs = Date.now()
  if (basketSelectInFlight) {
    return
  }
  if (params.positions.length > 0 && !params.force) {
    return
  }

  const needsRefresh =
    params.force ||
    activeBasket.symbols.length !== env.AGENT_UNIVERSE_SIZE ||
    nowMs - Date.parse(activeBasket.selectedAt) > env.AGENT_UNIVERSE_REFRESH_MS
  if (!needsRefresh) {
    return
  }

  basketSelectInFlight = true
  try {
    const universe = await fetchUniverseAssetsCached(nowMs)
    const perSymbolLiquidityBudgetUsd = Number((params.targetNotionalUsd / Math.max(1, env.AGENT_UNIVERSE_SIZE)).toFixed(2))
    const candidates = buildBasketCandidates({
      assets: universe,
      perSymbolLiquidityBudgetUsd,
      universeSize: env.AGENT_UNIVERSE_SIZE
    })
    const candidateSymbols = candidates.map((candidate) => candidate.symbol)
    const baseSymbol = candidateSymbols[0] ?? 'BTC'
    const pricePack = await computePriceFeaturePack({
      infoUrl: env.HL_INFO_URL,
      baseSymbol,
      symbols: candidateSymbols,
      windowMin: env.AGENT_FEATURE_WINDOW_MIN,
      interval: '1m',
      timeoutMs: 1500,
      concurrency: env.AGENT_FEATURE_CONCURRENCY
    })

    let cgMarketsBySymbol: Record<string, CoinGeckoMarketSnapshot> = {}
    let cgIdsBySymbol: Record<string, string> = {}
    let cgSectorTopLosers: Array<{ name: string; marketCapChange24hPct: number | null }> = []
    let cgSectorTopGainers: Array<{ name: string; marketCapChange24hPct: number | null }> = []
    let cgCoveragePct = 0

    if (coinGecko) {
      try {
        const concurrency = Math.min(env.AGENT_FEATURE_CONCURRENCY, 4)
        const resolved = await mapWithConcurrency(candidateSymbols, concurrency, async (symbol) => {
          const id = await coinGecko.getCoinIdForSymbol(symbol)
          return { symbol, id }
        })

        for (const entry of resolved) {
          if (entry?.id) {
            cgIdsBySymbol[entry.symbol] = entry.id
          }
        }

        const ids = [...new Set(Object.values(cgIdsBySymbol))]
        const markets = await coinGecko.fetchMarkets(ids)
        const marketById = new Map<string, CoinGeckoMarketSnapshot>()
        for (const market of markets) {
          marketById.set(market.id, market)
        }

        for (const [symbol, id] of Object.entries(cgIdsBySymbol)) {
          const market = marketById.get(id)
          if (market) {
            cgMarketsBySymbol[symbol] = market
          }
        }

        cgCoveragePct = candidateSymbols.length > 0 ? (Object.keys(cgMarketsBySymbol).length / candidateSymbols.length) * 100 : 0

        try {
          const categories = await coinGecko.fetchCategories()
          const withChange = categories.filter(
            (category) => typeof category.marketCapChange24hPct === 'number' && Number.isFinite(category.marketCapChange24hPct)
          )
          withChange.sort((a, b) => (a.marketCapChange24hPct ?? 0) - (b.marketCapChange24hPct ?? 0))
          cgSectorTopLosers = withChange
            .slice(0, 5)
            .map((category) => ({ name: category.name, marketCapChange24hPct: category.marketCapChange24hPct }))
          cgSectorTopGainers = withChange
            .slice(Math.max(0, withChange.length - 5))
            .reverse()
            .map((category) => ({ name: category.name, marketCapChange24hPct: category.marketCapChange24hPct }))
        } catch {
          // optional
        }
      } catch {
        cgMarketsBySymbol = {}
        cgIdsBySymbol = {}
        cgCoveragePct = 0
      }
    }

    const candidatesForLlm = candidates.map((candidate) => ({
      ...candidate,
      hist: pricePack.bySymbol[candidate.symbol] ?? null,
      cg: cgMarketsBySymbol[candidate.symbol] ?? null
    }))
    const signalPack = summarizeLatestSignals(nowMs)
    const latestBasketSignals = {
      volatility: latestSignalFromPack(signalPack, 'volatility')?.value ?? null,
      correlation: latestSignalFromPack(signalPack, 'correlation')?.value ?? null,
      funding: latestSignalFromPack(signalPack, 'funding')?.value ?? null
    }

    const input = {
      ts: new Date().toISOString(),
      mode: lastMode,
      universeSize: env.AGENT_UNIVERSE_SIZE,
      targetNotionalUsd: params.targetNotionalUsd,
      candidateFilter: {
        // Pre-filter candidates by daily notional volume as a rough proxy for tradability at size.
        minDayNtlVlmUsd: Number((Math.max(0, perSymbolLiquidityBudgetUsd) * 100).toFixed(2))
      },
      featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
      priceBase: pricePack.base,
      coingecko: coinGecko
        ? {
          enabled: true,
          coveragePct: Number(cgCoveragePct.toFixed(1)),
          sectorTopLosers: cgSectorTopLosers,
          sectorTopGainers: cgSectorTopGainers
        }
        : { enabled: false },
      candidates: candidatesForLlm,
      signals: {
        all: signalPack,
        latest: latestBasketSignals
      }
    }

    const llm = llmForRole('strategist', nowMs)
    const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

    let chosen: { basketSymbols: string[]; rationale: string } | null = null
    try {
      chosen = await generateBasketSelection({ llm, model, input })
    } catch (primaryError) {
      if (llm === 'codex') {
        const canUseClaude = await isClaudeAvailable()
        if (canUseClaude) {
          try {
            chosen = await generateBasketSelection({ llm: 'claude', model: env.CLAUDE_MODEL, input })
            const disabled = maybeDisableCodexFromError(primaryError, nowMs)
            const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `basket codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
            })
          } catch (fallbackError) {
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `basket selection failed after codex+claude fallback: ${String(fallbackError).slice(0, 120)}`
            })
            return
          }
        } else {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: 'basket codex failed: codex and claude unavailable; skipping basket refresh'
          })
          return
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `basket selection failed: ${String(primaryError).slice(0, 120)}`
        })
        return
      }
    }

    if (!chosen) {
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: 'basket selection returned empty payload, skipping basket refresh'
      })
      return
    }

    const validated = validateBasketSelection({ requested: chosen.basketSymbols, allowed: candidates, size: env.AGENT_UNIVERSE_SIZE })
    if (validated.length === 0) {
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `universe selection empty (0 valid symbols from ${chosen.basketSymbols.length} requested); skipping`
      })
      return
    }

    const finalBasket = validated

    const priceBySymbol: Record<string, PriceFeature> = {}
    for (const symbol of finalBasket) {
      const feature = pricePack.bySymbol[symbol]
      if (feature) {
        priceBySymbol[symbol] = feature
      }
    }

    const cgMarketsSelected: Record<string, CoinGeckoMarketSnapshot> = {}
    for (const symbol of finalBasket) {
      const market = cgMarketsBySymbol[symbol]
      if (market) {
        cgMarketsSelected[symbol] = market
      }
    }

    const cgCoinCategoriesBySymbol: Record<string, string[]> = {}
    if (coinGecko) {
      const tasks = finalBasket
        .map((symbol) => ({ symbol, id: cgIdsBySymbol[symbol] }))
        .filter((task): task is { symbol: string; id: string } => Boolean(task.id))

      const rows = await mapWithConcurrency(tasks, Math.min(tasks.length, 3), async (task) => ({
        symbol: task.symbol,
        categories: await coinGecko.fetchCoinCategories(task.id)
      }))

      for (const row of rows) {
        if (row.categories.length > 0) {
          cgCoinCategoriesBySymbol[row.symbol] = row.categories
        }
      }
    }

    activeBasket = {
      symbols: finalBasket,
      rationale: chosen.rationale || 'selected',
      selectedAt: new Date().toISOString(),
      context: {
        featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
        priceBase: pricePack.base,
        priceBySymbol,
        coingecko: coinGecko
          ? {
            marketsBySymbol: cgMarketsSelected,
            coinCategoriesBySymbol: cgCoinCategoriesBySymbol,
            sectorTopLosers: cgSectorTopLosers,
            sectorTopGainers: cgSectorTopGainers,
            coveragePct: Number(cgCoveragePct.toFixed(1))
          }
          : undefined
      }
    }

    void maybePublishWatchlist({ symbols: activeBasket.symbols, reason: 'universe selected' }).catch(() => undefined)

    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      line: `universe selected: ${activeBasket.symbols.join(',')} (size=${activeBasket.symbols.length})`
    })

    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'universe.selected',
      resource: 'agent.universe',
      correlationId: ulid(),
      details: {
        symbols: activeBasket.symbols,
        rationale: activeBasket.rationale,
        targetNotionalUsd: params.targetNotionalUsd,
        candidateCount: candidates.length,
        context: activeBasket.context
      }
    })
  } catch (error) {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'WARN',
      line: `universe selection failed: ${String(error).slice(0, 140)}`
    })
  } finally {
    basketSelectInFlight = false
  }
}

function signedNotionalBySymbol(positions: OperatorPosition[]): Map<string, number> {
  const currentBySymbol = new Map<string, number>()
  for (const position of positions) {
    const signed = position.side === 'LONG' ? Math.abs(position.notionalUsd) : -Math.abs(position.notionalUsd)
    currentBySymbol.set(position.symbol, (currentBySymbol.get(position.symbol) ?? 0) + signed)
  }
  return currentBySymbol
}

function normalizeDirectivePlan(params: {
  plan: DirectivePlan | null
  fallbackTargetNotionalUsd: number
}): DirectivePlan | null {
  const rawPlan = params.plan
  if (!rawPlan || !Array.isArray(rawPlan.legs) || rawPlan.legs.length === 0) {
    return null
  }

  const minLegUsd = Math.max(0, env.AGENT_MIN_REBALANCE_LEG_USD)
  const fallbackTargetNotionalUsd = Math.max(0, params.fallbackTargetNotionalUsd)
  const netCap = Number(rawPlan.riskBudget?.maxNetNotionalUsd)
  const grossCap = Number(rawPlan.riskBudget?.maxGrossNotionalUsd)

  const bySymbol = new Map<string, number>()
  for (const leg of rawPlan.legs) {
    const symbol = String(leg?.symbol ?? '').trim().toUpperCase()
    if (!symbol) {
      continue
    }
    const side = String((leg as { side?: unknown }).side)
    if (side !== 'LONG' && side !== 'SHORT') {
      continue
    }
    const notionalUsd = Math.abs(Number((leg as { notionalUsd?: unknown }).notionalUsd))
    if (!Number.isFinite(notionalUsd) || notionalUsd < minLegUsd) {
      continue
    }
    const signedNotionalUsd = side === 'LONG' ? notionalUsd : -notionalUsd
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + signedNotionalUsd)
  }

  if (bySymbol.size === 0) {
    return null
  }

  let normalizedLegs = [...bySymbol.entries()]
    .map(([symbol, signedNotionalUsd]) => ({
      symbol,
      side: signedNotionalUsd >= 0 ? ('LONG' as const) : ('SHORT' as const),
      notionalUsd: Math.abs(signedNotionalUsd)
    }))
    .filter((leg) => leg.notionalUsd >= minLegUsd)

  const grossUsd = normalizedLegs.reduce((sum, leg) => sum + leg.notionalUsd, 0)
  const netUsd = Math.abs(normalizedLegs.reduce((sum, leg) => sum + (leg.side === 'LONG' ? leg.notionalUsd : -leg.notionalUsd), 0))

  let scale = 1
  const effectiveGrossCap = Number.isFinite(grossCap) && grossCap > 0 ? grossCap : fallbackTargetNotionalUsd
  if (grossUsd > 0 && effectiveGrossCap > 0) {
    scale = Math.min(scale, effectiveGrossCap / grossUsd)
  }
  if (netUsd > 0 && Number.isFinite(netCap) && netCap > 0) {
    scale = Math.min(scale, netCap / netUsd)
  }
  scale = clamp(scale, 0, 1)

  if (scale < 1) {
    normalizedLegs = normalizedLegs
      .map((leg) => ({ ...leg, notionalUsd: normalizeProposalNotional(leg.notionalUsd * scale) }))
      .filter((leg) => leg.notionalUsd >= minLegUsd)
  }

  if (normalizedLegs.length === 0) {
    return null
  }

  return {
    legs: normalizedLegs,
    timeHorizonHours: Number(rawPlan.timeHorizonHours) || null,
    riskBudget: {
      maxGrossNotionalUsd:
        typeof rawPlan.riskBudget?.maxGrossNotionalUsd === 'number' && Number.isFinite(rawPlan.riskBudget.maxGrossNotionalUsd) && rawPlan.riskBudget.maxGrossNotionalUsd > 0
          ? rawPlan.riskBudget.maxGrossNotionalUsd
          : null,
      maxNetNotionalUsd:
        typeof rawPlan.riskBudget?.maxNetNotionalUsd === 'number' && Number.isFinite(rawPlan.riskBudget.maxNetNotionalUsd) && rawPlan.riskBudget.maxNetNotionalUsd > 0
          ? rawPlan.riskBudget.maxNetNotionalUsd
          : null,
      maxLeverage:
        typeof rawPlan.riskBudget?.maxLeverage === 'number' && Number.isFinite(rawPlan.riskBudget.maxLeverage) && rawPlan.riskBudget.maxLeverage > 0
          ? rawPlan.riskBudget.maxLeverage
          : null
    },
    notes: typeof rawPlan.notes === 'string' ? rawPlan.notes.slice(0, 1_000) : ''
  }
}

function buildDiscretionaryProposal(params: {
  createdBy: string
  plan: DirectivePlan
  positions: OperatorPosition[]
  signals: PluginSignal[]
  requestedMode: 'SIM' | 'LIVE'
  executionTactics: { expectedSlippageBps: number; maxSlippageBps: number }
  confidence?: number
  rationale?: string
  summaryPrefix?: string
}): StrategyProposal | null {
  if (params.plan.legs.length === 0) {
    return null
  }

  const desiredBySymbol = new Map<string, number>()
  for (const leg of params.plan.legs) {
    const symbol = String(leg.symbol).trim().toUpperCase()
    if (!symbol) {
      continue
    }
    const signedNotional = leg.side === 'LONG' ? leg.notionalUsd : -leg.notionalUsd
    const previous = desiredBySymbol.get(symbol) ?? 0
    desiredBySymbol.set(symbol, previous + signedNotional)
  }

  // Close unmentioned current symbols to avoid stale drift.
  for (const position of params.positions) {
    const symbol = String(position.symbol).trim().toUpperCase()
    if (symbol && !desiredBySymbol.has(symbol)) {
      desiredBySymbol.set(symbol, 0)
    }
  }

  const currentBySymbol = signedNotionalBySymbol(params.positions)
  const minLegUsd = Math.max(0, env.AGENT_MIN_REBALANCE_LEG_USD)
  const deltas = [...desiredBySymbol.entries()]
    .map(([symbol, desiredNotional]) => {
      const current = currentBySymbol.get(symbol) ?? 0
      const delta = desiredNotional - current
      if (!Number.isFinite(delta) || Math.abs(delta) < minLegUsd) {
        return null
      }
      const side: 'BUY' | 'SELL' = delta > 0 ? 'BUY' : 'SELL'
      const notionalUsd = normalizeProposalNotional(delta)
      if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
        return null
      }
      const reduces =
        (current > 0 && side === 'SELL') ||
        (current < 0 && side === 'BUY')
      return { symbol, side, notionalUsd, reduces }
    })
    .filter((leg): leg is { symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number; reduces: boolean } => Boolean(leg))

  if (deltas.length === 0) {
    return null
  }

  // Place reducing legs first to minimize transient gross exposure under risk constraints.
  deltas.sort((a, b) => {
    if (a.reduces !== b.reduces) return a.reduces ? -1 : 1
    return a.symbol.localeCompare(b.symbol)
  })

  const legs = deltas.map(({ symbol, side, notionalUsd }) => ({ symbol, side, notionalUsd }))

  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestCorrelation = [...params.signals].reverse().find((signal) => signal.signalType === 'correlation')
  const latestFunding = [...params.signals].reverse().find((signal) => signal.signalType === 'funding')
  const signalSummary = [
    latestVolatility ? `vol=${latestVolatility.value.toFixed(3)}` : 'vol=na',
    latestCorrelation ? `corr=${latestCorrelation.value.toFixed(3)}` : 'corr=na',
    latestFunding ? `funding=${latestFunding.value.toFixed(6)}` : 'funding=na'
  ].join(' ')

  const actionNotionalUsd = legs.reduce((sum, leg) => sum + leg.notionalUsd, 0)
  const proposalId = ulid()
  const actionType = params.positions.length > 0 ? 'REBALANCE' : 'ENTER'
  const summaryPrefix = params.summaryPrefix ?? 'agent discretion'
  const confidence = typeof params.confidence === 'number' ? clamp(params.confidence, 0, 1) : 0.65
  const rationale =
    params.rationale ??
    (typeof params.plan.notes === 'string' && params.plan.notes.length > 0 ? params.plan.notes : 'agent-driven discretionary proposal')

  return {
    proposalId,
    cycleId: ulid(),
    summary: `${summaryPrefix} (${signalSummary})`,
    confidence,
    requestedMode: params.requestedMode,
    createdBy: params.createdBy,
    actions: [
      {
        type: actionType,
        rationale,
        notionalUsd: normalizeProposalNotional(actionNotionalUsd),
        expectedSlippageBps: params.executionTactics.expectedSlippageBps,
        maxSlippageBps: params.executionTactics.maxSlippageBps,
        legs
      }
    ]
  }
}

function buildExitProposal(params: {
  createdBy: string
  positions: OperatorPosition[]
  signals: PluginSignal[]
  requestedMode: 'SIM' | 'LIVE'
  executionTactics: { expectedSlippageBps: number; maxSlippageBps: number }
  confidence?: number
  rationale?: string
}): StrategyProposal | null {
  if (params.positions.length === 0) {
    return null
  }

  const currentBySymbol = signedNotionalBySymbol(params.positions)
  const symbols = [...new Set(params.positions.map((position) => position.symbol))].sort((a, b) => a.localeCompare(b))
  const minLegUsd = Math.max(0, env.AGENT_MIN_REBALANCE_LEG_USD)

  const legs = symbols
    .map((symbol) => {
      const current = currentBySymbol.get(symbol) ?? 0
      if (!Number.isFinite(current) || Math.abs(current) < minLegUsd) {
        return null
      }
      const side: 'BUY' | 'SELL' = current > 0 ? 'SELL' : 'BUY'
      return { symbol, side, notionalUsd: normalizeProposalNotional(current) }
    })
    .filter((leg): leg is { symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number } => Boolean(leg))

  if (legs.length === 0) {
    return null
  }

  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestCorrelation = [...params.signals].reverse().find((signal) => signal.signalType === 'correlation')
  const latestFunding = [...params.signals].reverse().find((signal) => signal.signalType === 'funding')
  const signalSummary = [
    latestVolatility ? `vol=${latestVolatility.value.toFixed(3)}` : 'vol=na',
    latestCorrelation ? `corr=${latestCorrelation.value.toFixed(3)}` : 'corr=na',
    latestFunding ? `funding=${latestFunding.value.toFixed(6)}` : 'funding=na'
  ].join(' ')

  const actionNotionalUsd = legs.reduce((sum, leg) => sum + leg.notionalUsd, 0)
  const proposalId = ulid()
  const confidence = typeof params.confidence === 'number' ? clamp(params.confidence, 0, 1) : 0.6
  const rationale = params.rationale ?? 'risk-off: exit to flat'

  return {
    proposalId,
    cycleId: ulid(),
    summary: `agent exit to flat (${signalSummary})`,
    confidence,
    requestedMode: params.requestedMode,
    createdBy: params.createdBy,
    actions: [
      {
        type: 'EXIT',
        rationale,
        notionalUsd: normalizeProposalNotional(actionNotionalUsd),
        expectedSlippageBps: params.executionTactics.expectedSlippageBps,
        maxSlippageBps: params.executionTactics.maxSlippageBps,
        legs
      }
    ]
  }
}

async function generateAnalysis(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; thesis: string; risks: string[]; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      thesis: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      confidence: { type: 'number' }
    },
    required: ['headline', 'thesis', 'risks', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Delta-to-target rebalance',
      thesis: 'Maintain discretionary directional balance by rebalancing symbol-level notionals to the requested plan.',
      risks: ['Funding regime shift', 'Liquidity slippage during volatility', 'Model-free signal blindness'],
      confidence: 0.4
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'scribe',
      mission: 'Write concise post-decision floor analysis tied to execution rationale and current risk posture.',
      rules: [
        'Use the latest floor context before writing interpretation.',
        'Keep output tight and concrete.',
        'If confidence is low, reflect uncertainty explicitly.',
        'Do not include raw order tickets, signatures, or venue credentials.',
        'Each risk item should be specific and observable.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const confidence = clamp(Number(raw.confidence), 0, 1)
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'HL Privateer Analysis',
    thesis: String(raw.thesis ?? '').slice(0, 1200),
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence
  }
}

type ResearchReportResult = {
  headline: string
  regime: string
  recommendation: string
  confidence: number
  suggestedTwitterQueries: string[]
}

async function generateResearchReport(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<ResearchReportResult> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      regime: { type: 'string' },
      recommendation: { type: 'string' },
      confidence: { type: 'number' },
      suggestedTwitterQueries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 8 Twitter/X search queries to run next cycle. Use Twitter v2 search operators: OR, AND, -is:retweet, lang:en, $cashtag. Focus on narratives, catalysts, liquidation events, or sentiment shifts relevant to current regime and watchlist.'
      }
    },
    required: ['headline', 'regime', 'recommendation', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Research pulse',
      regime: 'range / mean-reversion bias',
      recommendation: 'keep pair structure stable; watch correlation + funding for regime shifts',
      confidence: 0.35,
      suggestedTwitterQueries: []
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'research-agent',
      mission: 'Classify current market regime and return one actionable recommendation.',
      rules: [
      'Use only context and observed signals; do not speculate on external events.',
      'Output one recommendation, not a portfolio plan.',
      'If data indicates regime shift, indicate it explicitly in regime.',
      'Prefer position-structure stability guidance when correlation deteriorates or signals are mixed.',
      'Include suggestedTwitterQueries: up to 8 Twitter/X v2 search queries for the NEXT intel cycle. Target narratives, catalysts, liquidations, or sentiment shifts relevant to current regime and universe. Use operators: OR, -is:retweet, lang:en, $cashtag. Keep queries focused and concise (<280 chars each).'
    ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<ResearchReportResult>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<ResearchReportResult>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const suggestedQueries = Array.isArray(raw.suggestedTwitterQueries)
    ? raw.suggestedTwitterQueries
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim().slice(0, 280))
        .slice(0, 8)
    : []

  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'Research pulse',
    regime: String(raw.regime ?? '').slice(0, 160) || 'unknown',
    recommendation: String(raw.recommendation ?? '').slice(0, 240),
    confidence: clamp(Number(raw.confidence), 0, 1),
    suggestedTwitterQueries: suggestedQueries
  }
}

type RiskPolicyRecommendation = {
  maxDrawdownPct?: number
  maxLeverage?: number
  maxExposureUsd?: number
  maxSlippageBps?: number
  notionalParityTolerance?: number
}

type RiskReportResult = {
  headline: string
  posture: 'GREEN' | 'AMBER' | 'RED'
  risks: string[]
  confidence: number
  policyRecommendations: RiskPolicyRecommendation | null
}

async function generateRiskReport(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<RiskReportResult> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      posture: { type: 'string', enum: ['GREEN', 'AMBER', 'RED'] },
      risks: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      confidence: { type: 'number' },
      policyRecommendations: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          maxDrawdownPct: { type: 'number' },
          maxLeverage: { type: 'number' },
          maxExposureUsd: { type: 'number' },
          maxSlippageBps: { type: 'number' },
          notionalParityTolerance: { type: 'number' }
        }
      }
    },
    required: ['headline', 'posture', 'risks', 'confidence', 'policyRecommendations']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Risk posture',
      posture: 'GREEN',
      risks: ['Volatility spike', 'Liquidity gaps', 'Correlation break'],
      confidence: 0.35,
      policyRecommendations: null
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'risk-agent',
      mission: 'Assess immediate risk posture, list concrete risks, and recommend risk policy parameter changes if warranted.',
      rules: [
        'Only return posture GREEN/AMBER/RED.',
        'Prioritize stale data, volatility regime, and drift imbalance.',
        'Tie each risk item to specific observable context.',
        'When posture is RED, favor conservative action and explicit blockers.',
        'Do not output execution mechanics.',
        'POLICY MANAGEMENT: You control the live risk policy parameters. The current policy is included in context under "currentRiskPolicy".',
        'Set policyRecommendations to an object with any parameters you want to change, or null to keep current policy.',
        'LEVERAGE PHILOSOPHY: Default to MAXIMUM leverage for capital efficiency. The system should always operate at the highest leverage the risk environment permits.',
        'Only REDUCE leverage when there is a concrete, observable threat (extreme volatility spike, liquidity crisis, correlation breakdown, drawdown approaching hard cap).',
        'When the threat passes, IMMEDIATELY restore leverage to maximum. Do not leave leverage reduced out of caution — capital efficiency is the priority.',
        'You may TIGHTEN other parameters (reduce exposure, tighten slippage) in volatile/uncertain markets while keeping leverage high.',
        'DRAWDOWN POLICY: maxDrawdownPct is set to 100 (effectively unlimited). Do NOT recommend changes to maxDrawdownPct. The operator accepts full drawdown risk.',
        'Focus risk management on position sizing, exposure limits, and leverage — not drawdown caps.',
        'Only recommend changes with clear justification tied to observable market conditions. Do not change params arbitrarily.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<RiskReportResult>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<RiskReportResult>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const posture = raw.posture === 'GREEN' || raw.posture === 'AMBER' || raw.posture === 'RED' ? raw.posture : 'AMBER'
  const recommendations = raw.policyRecommendations && typeof raw.policyRecommendations === 'object'
    ? Object.fromEntries(
        Object.entries(raw.policyRecommendations).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      ) as RiskPolicyRecommendation
    : null
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'Risk posture',
    posture,
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence: clamp(Number(raw.confidence), 0, 1),
    policyRecommendations: recommendations && Object.keys(recommendations).length > 0 ? recommendations : null
  }
}

async function generateStrategistDirective(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ decision: StrategistDirectiveDecision; plan: DirectivePlan | null; rationale: string; confidence: number }> {
  const planSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      legs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symbol: { type: 'string' },
            side: { type: 'string', enum: ['LONG', 'SHORT'] },
            notionalUsd: { type: 'number' }
          },
          required: ['symbol', 'side', 'notionalUsd']
        },
        minItems: 1,
        maxItems: 12
      },
      timeHorizonHours: { type: ['number', 'null'] },
      riskBudget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxGrossNotionalUsd: { type: ['number', 'null'] },
          maxNetNotionalUsd: { type: ['number', 'null'] },
          maxLeverage: { type: ['number', 'null'] }
        },
        required: ['maxGrossNotionalUsd', 'maxNetNotionalUsd', 'maxLeverage']
      },
      notes: { type: 'string' }
    },
    required: ['legs', 'timeHorizonHours', 'riskBudget', 'notes']
  } as const

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: ['OPEN', 'REBALANCE', 'EXIT', 'HOLD'] },
      plan: planSchema,
      rationale: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['decision', 'rationale', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      decision: 'HOLD',
      plan: null,
      rationale: 'llm disabled',
      confidence: 0.25
    }
  }

  const prompt = [
	    buildAgentPrompt({
	      role: 'strategist-directive agent',
	      mission: 'Choose the best execution directive and provide an explicit discretionary long/short plan (directional or paired) when active.',
	      rules: [
	        'Allowed decisions: OPEN, REBALANCE, EXIT, HOLD only.',
	        'OPEN: if a new discretionary position set should be established.',
	        'REBALANCE: revise existing exposure using explicit plan legs.',
        'HOLD: keep current exposure and plan should be omitted.',
        'EXIT: flatten all exposure immediately (LLM should still include no plan).',
        'When context is favorable for risk-taking, build one explicit plan with leg-level notional.',
        'When uncertainty or risk posture is constrained, prefer HOLD or EXIT with concise rationale.',
        'If lastRiskDecision contains blocking DENY codes (DRAWDOWN, EXPOSURE, LEVERAGE, SAFE_MODE, STALE_DATA, LIQUIDITY), force EXIT / flat-first behavior.',
        'Risk budgets and timeHorizonHours should be realistic and conservative by design.',
        'Do not propose both plan and decision HOLD.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ decision: StrategistDirectiveDecision; plan?: DirectivePlan; rationale: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ decision: StrategistDirectiveDecision; plan?: DirectivePlan; rationale: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const decision: StrategistDirectiveDecision =
    raw.decision === 'EXIT' || raw.decision === 'REBALANCE' || raw.decision === 'OPEN' || raw.decision === 'HOLD'
      ? raw.decision
      : 'HOLD'

  let plan: DirectivePlan | null = null
  if (raw.plan && (decision === 'OPEN' || decision === 'REBALANCE')) {
    plan = normalizeDirectivePlan({
      plan: raw.plan as DirectivePlan | null,
      fallbackTargetNotionalUsd: env.AGENT_TARGET_NOTIONAL_USD
    })
  }
  if ((decision === 'OPEN' || decision === 'REBALANCE') && plan === null) {
    plan = null
  }

  return {
    decision,
    plan,
    rationale: String(raw.rationale ?? '').slice(0, 600),
    confidence: clamp(Number(raw.confidence), 0, 1)
  }
}

const bus = env.REDIS_URL
  ? new RedisEventBus(env.REDIS_URL, env.REDIS_STREAM_PREFIX, 'agent-runner')
  : new InMemoryEventBus()

const latestTicks = new Map<string, Tick>()
const latestSignals = new Map<string, PluginSignal>()
let lastPositions: OperatorPosition[] = []
let lastMode: string = 'INIT'
let lastProposalAt = 0
let lastAnalysisAt = 0
let lastResearchAt = 0
let lastRiskAt = 0
let lastOpsAt = 0
let lastDirectiveAt = 0
let lastPipelineAt = 0
let lastUrgencyLevel: UrgencyLevel = 'IDLE'
let lastProposal: StrategyProposal | null = null
let lastProposalPublishedAt = 0
let lastRiskDecision: RuntimeRiskDecision | null = null
let lastRiskRecoverySignature = ''
let lastRiskRecoveryNoticeAt = 0
let lastRiskPolicyTuneSignature = ''
let lastRiskPolicyTuneAt = 0
let lastStrategistNoActionSignature = ''
let lastStrategistNoActionAtMs = 0
let lastStrategyProposalSignature = ''
let lastStateRiskMessage: RuntimeStateRiskMessage | null = null
let lastStateUpdateAtMs = 0
let lastStateUpdate:
	| {
	    mode?: string
	    pnlPct?: number
	    realizedPnlUsd?: number
	    accountValueUsd?: number
	    driftState?: string
	    lastUpdateAt?: string
	    message?: string
	    riskPolicy?: {
	      maxLeverage?: number
	      targetLeverage?: number
	      maxDrawdownPct?: number
	      maxExposureUsd?: number
	      maxSlippageBps?: number
	      staleDataMs?: number
	      liquidityBufferPct?: number
	      notionalParityTolerance?: number
	    }
	  }
	  | null = {
	    riskPolicy: {
	      maxLeverage: env.RISK_MAX_LEVERAGE,
	      targetLeverage: env.RISK_MAX_LEVERAGE,
	      maxDrawdownPct: env.RISK_MAX_DRAWDOWN_PCT,
	      maxExposureUsd: env.RISK_MAX_NOTIONAL_USD,
	      maxSlippageBps: env.RISK_MAX_SLIPPAGE_BPS,
	      staleDataMs: env.RISK_STALE_DATA_MS,
	      liquidityBufferPct: env.RISK_LIQUIDITY_BUFFER_PCT,
	      notionalParityTolerance: env.RISK_NOTIONAL_PARITY_TOLERANCE
	    }
	  }
let lastResearchReport: (ResearchReportResult & { computedAt: string }) | null = null
let lastRiskReport: (RiskReportResult & { computedAt: string }) | null = null
let lastScribeAnalysis: { headline: string; thesis: string; risks: string[]; confidence: number; computedAt: string } | null = null
let lastExternalIntel: ExternalIntelPack | null = null
let agentSuggestedTwitterQueries: string[] = []
let autoHaltActive = false
let autoHaltHealthySinceMs = 0
let lastRiskDecisionAuditSignature = ''
let lastRiskDecisionAuditAtMs = 0

async function publishAudit(event: AuditEvent): Promise<void> {
  queueJournalWrite(event)
  void notifyDiscord(event)

  await bus.publish('hlp.audit.events', {
    type: 'AGENT_ANALYSIS',
    stream: 'hlp.audit.events',
    source: 'agent-runner',
    correlationId: event.correlationId,
    actorType: event.actorType,
    actorId: event.actorId,
    payload: event
  })
}

async function publishProposal(params: { actorId: string; proposal: StrategyProposal }): Promise<void> {
  await bus.publish('hlp.strategy.proposals', {
    type: 'STRATEGY_PROPOSAL',
    stream: 'hlp.strategy.proposals',
    source: 'agent-runner',
    correlationId: params.proposal.proposalId,
    actorType: 'internal_agent',
    actorId: params.actorId,
    payload: params.proposal
  })
}

async function publishTape(params: { correlationId: string; role: string; line: string; level?: 'INFO' | 'WARN' | 'ERROR' }): Promise<void> {
  const line = sanitizeLine(params.line, 240)
  const role = sanitizeLine(params.role, 32)
  const level: 'INFO' | 'WARN' | 'ERROR' = params.level ?? 'INFO'
  const ts = new Date().toISOString()
  if (!line) {
    return
  }
  floorTapeHistory.push({ ts, role, level, line })
  if (floorTapeHistory.length > FLOOR_TAPE_CONTEXT_LINES) {
    floorTapeHistory.splice(0, floorTapeHistory.length - FLOOR_TAPE_CONTEXT_LINES)
  }

  await bus.publish('hlp.ui.events', {
    type: 'FLOOR_TAPE',
    stream: 'hlp.ui.events',
    source: 'agent-runner',
    correlationId: params.correlationId,
    actorType: 'internal_agent',
    actorId: env.AGENT_ID,
    payload: {
      ts,
      role,
      level,
      line
    }
  })
}

let lastWatchlistKey = ''
let lastWatchlistPublishedAtMs = 0

function normalizeSymbolList(symbols: string[]): string[] {
  return symbols
    .map((symbol) => String(symbol).trim())
    .filter(Boolean)
}

function watchlistKey(symbols: string[]): string {
  return normalizeSymbolList(symbols)
    .map((symbol) => symbol.toUpperCase())
    .join(',')
}

async function maybePublishWatchlist(params: { symbols: string[]; reason: string }): Promise<void> {
  const normalized = normalizeSymbolList(params.symbols)
  if (normalized.length === 0) {
    return
  }

  const nowMs = Date.now()
  const key = watchlistKey(normalized)
  const changed = key !== lastWatchlistKey
  const stale = nowMs - lastWatchlistPublishedAtMs > 30_000
  if (!changed && !stale) {
    return
  }

  lastWatchlistKey = key
  lastWatchlistPublishedAtMs = nowMs
  await bus.publish('hlp.market.watchlist', {
    type: 'MARKET_WATCHLIST',
    stream: 'hlp.market.watchlist',
    source: 'agent-runner',
    correlationId: ulid(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    payload: {
      ts: new Date().toISOString(),
      symbols: normalized,
      reason: sanitizeLine(params.reason, 120)
    }
  })
}

async function publishAgentCommand(params: {
  command: '/halt' | '/resume' | '/flatten' | '/risk-policy'
  reason: string
  args?: string[]
}): Promise<void> {
  await bus.publish('hlp.commands', {
    type: 'agent.command',
    stream: 'hlp.commands',
    source: 'agent-runner',
    correlationId: ulid(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    payload: {
      command: params.command,
      args: params.args ?? [],
      reason: sanitizeLine(params.reason, 160),
      actorRole: 'operator_admin',
      capabilities: ['command.execute']
    }
  })
}

function requestedModeFromEnv(): 'SIM' | 'LIVE' {
  if (!env.DRY_RUN && env.ENABLE_LIVE_OMS) {
    return 'LIVE'
  }
  return 'SIM'
}

function summarizePositionsForAgents(positions: OperatorPosition[]): { drift: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'; posture: 'GREEN' | 'AMBER' | 'RED' } {
  if (positions.length === 0) {
    return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
  }

  const longs = positions
    .filter((position) => position.side === 'LONG')
    .reduce((sum, position) => sum + Math.max(0, Math.abs(position.notionalUsd)), 0)
  const shorts = positions
    .filter((position) => position.side === 'SHORT')
    .reduce((sum, position) => sum + Math.max(0, Math.abs(position.notionalUsd)), 0)

  const gross = longs + shorts
  if (gross <= 0) {
    return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
  }

  const mismatch = Math.abs(longs - shorts) / (gross / 2)
  if (mismatch > 0.2) {
    return { drift: 'BREACH', posture: 'RED' }
  }
  if (mismatch > 0.05) {
    return { drift: 'POTENTIAL_DRIFT', posture: 'AMBER' }
  }
  return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
}

function tickStalenessMs(symbols: string[]): { maxAgeMs: number; missing: string[] } {
  const missing: string[] = []
  let maxAgeMs = 0

  for (const symbol of symbols) {
    const tick = latestTicks.get(symbol)
    if (!tick) {
      missing.push(symbol)
      maxAgeMs = Math.max(maxAgeMs, 60_000)
      continue
    }

    const updatedAt = safeDateMs(tick.updatedAt)
    if (updatedAt === null) {
      maxAgeMs = Math.max(maxAgeMs, 60_000)
      continue
    }

    maxAgeMs = Math.max(maxAgeMs, Date.now() - updatedAt)
  }

  return { maxAgeMs, missing }
}

async function runOpsAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastOpsAt < env.AGENT_OPS_INTERVAL_MS) {
    return
  }
  lastOpsAt = now

  const universe = [...activeBasket.symbols]
  const { maxAgeMs, missing } = tickStalenessMs(universe)

  const level: 'INFO' | 'WARN' | 'ERROR' = maxAgeMs > 15000 || missing.length > 0 ? 'WARN' : 'INFO'
  const deckStatusLine = `deck status mode=${lastMode} feedAgeMs=${Math.round(maxAgeMs)} missing=${missing.length}`
  const deckStatusSignature = `${level}|mode=${lastMode}|missing=${missing.length}`
  const shouldPublishDeckStatus =
    deckStatusSignature !== lastDeckStatusSignature || now - lastDeckStatusHeartbeatAtMs >= DECK_STATUS_HEARTBEAT_MS
  if (shouldPublishDeckStatus) {
    lastDeckStatusSignature = deckStatusSignature
    lastDeckStatusHeartbeatAtMs = now
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level,
      line: deckStatusLine
    })
  }

  // Runtime can source ticks for dynamic basket symbols on-demand via l2Book snapshots.
  void maybePublishWatchlist({ symbols: universe, reason: 'ops heartbeat' }).catch(() => undefined)

  const healthy = maxAgeMs <= 15_000 && missing.length === 0

  // Auto-resume only if we were the party that auto-halted.
  if (autoHaltActive) {
    if (lastMode !== 'HALT') {
      autoHaltActive = false
      autoHaltHealthySinceMs = 0
    } else if (healthy) {
      if (autoHaltHealthySinceMs === 0) {
        autoHaltHealthySinceMs = now
      }
      if (now - autoHaltHealthySinceMs > 30_000) {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: 'auto-resume: market data recovered'
        })
        await publishAgentCommand({ command: '/resume', reason: 'auto-resume: market data recovered' })
        autoHaltActive = false
        autoHaltHealthySinceMs = 0
      }
    } else {
      autoHaltHealthySinceMs = 0
    }
  }

  if (env.OPS_AUTO_HALT && lastMode !== 'HALT' && !healthy) {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'ERROR',
      line: 'auto-halt: market data stale'
    })
    await publishAgentCommand({ command: '/halt', reason: 'auto-halt: market data stale' })
    autoHaltActive = true
    autoHaltHealthySinceMs = 0
  }
}

type UrgencyLevel = 'IDLE' | 'WATCHING' | 'ACTIVE' | 'ELEVATED' | 'CRITICAL'

function classifyUrgency(): { level: UrgencyLevel; intervalMs: number } {
  const summary = summarizePositionsForAgents(lastPositions)
  const signalPack = summarizeLatestSignals(Date.now())
  const latestVol = latestSignalFromPack(signalPack, 'volatility')
  const vol = latestVol?.value ?? 0
  const pnlPct = lastStateUpdate?.pnlPct ?? 0
  const hasPositions = lastPositions.length > 0

  if (lastRiskDecision?.decision === 'DENY') {
    return { level: 'CRITICAL', intervalMs: 60_000 }
  }
  if (summary.posture === 'RED') {
    return { level: 'CRITICAL', intervalMs: 60_000 }
  }
  if (lastMode === 'SAFE_MODE' && hasPositions) {
    return { level: 'CRITICAL', intervalMs: 60_000 }
  }
  if (hasPositions && Math.abs(vol) > 15) {
    return { level: 'ELEVATED', intervalMs: env.AGENT_PIPELINE_MIN_MS }
  }
  if (hasPositions && summary.drift === 'POTENTIAL_DRIFT') {
    return { level: 'ELEVATED', intervalMs: env.AGENT_PIPELINE_MIN_MS }
  }
  if (hasPositions && pnlPct < -5) {
    return { level: 'ELEVATED', intervalMs: env.AGENT_PIPELINE_MIN_MS }
  }
  if (hasPositions) {
    return { level: 'ACTIVE', intervalMs: 15 * 60_000 }
  }
  if (Math.abs(vol) > 10 || lastRiskDecision?.decision === 'ALLOW_REDUCE_ONLY') {
    return { level: 'WATCHING', intervalMs: 20 * 60_000 }
  }
  return { level: 'IDLE', intervalMs: env.AGENT_PIPELINE_BASE_MS }
}

async function runStrategyPipeline(): Promise<void> {
  const now = Date.now()
  const { level, intervalMs } = classifyUrgency()

  if (now - lastPipelineAt < intervalMs) return

  if (level !== lastUrgencyLevel) {
    lastUrgencyLevel = level
    await publishTape({ correlationId: ulid(), role: 'ops', line: `urgency=${level} interval=${intervalMs}ms` })
  }

  lastPipelineAt = now

  await runResearchAgent()
  await runRiskAgent()
  await runStrategistCycle()
}

async function runResearchAgent(): Promise<void> {
  const now = Date.now()
  lastResearchAt = now

  const signalPack = summarizeLatestSignals(now)
  const latestVol = latestSignalFromPack(signalPack, 'volatility')
  const latestCorr = latestSignalFromPack(signalPack, 'correlation')
  const latestFunding = latestSignalFromPack(signalPack, 'funding')
	  const regime =
	    latestVol && Math.abs(latestVol.value) > 15
	      ? 'high vol'
	      : latestCorr && latestCorr.value < 0.1
	        ? 'correlation break risk'
	        : 'stable'

	  let intelSummary: Record<string, unknown> | null = null
	  if (env.AGENT_INTEL_ENABLED) {
	    try {
	      lastExternalIntel = await buildExternalIntelPack({
	        symbols: activeBasket.symbols,
	        twitterCredsPath: env.OPENCLAW_TWITTER_CREDS_PATH,
	        twitterBearerToken: env.TWITTER_BEARER_TOKEN || undefined,
	        twitterEnabled: env.AGENT_INTEL_TWITTER_ENABLED,
	        twitterMaxResults: env.AGENT_INTEL_TWITTER_MAX_RESULTS,
	        timeoutMs: env.AGENT_INTEL_TIMEOUT_MS,
	        customQueries: agentSuggestedTwitterQueries.length > 0 ? agentSuggestedTwitterQueries : undefined
	      })
	      intelSummary = summarizeExternalIntel(lastExternalIntel)

	      await publishAudit({
	        id: ulid(),
	        ts: new Date().toISOString(),
	        actorType: 'internal_agent',
	        actorId: roleActorId('research'),
	        action: 'intel.refresh',
	        resource: 'agent.intel',
	        correlationId: ulid(),
	        details: intelSummary
	      })
	    } catch (error) {
	      await publishTape({
	        correlationId: ulid(),
	        role: 'ops',
	        level: 'WARN',
	        line: `intel refresh failed: ${String(error).slice(0, 140)}`
	      })
	    }
	  }

	  const input = {
	    ts: new Date().toISOString(),
	    mode: lastMode,
	    universeSymbols: activeBasket.symbols.join(','),
	    externalIntel: intelSummary,
	    signals: {
	      all: signalPack,
	      latest: {
	        vol: latestVol?.value ?? null,
	        corr: latestCorr?.value ?? null,
	        funding: latestFunding?.value ?? null
	      }
	    },
	    inferredRegime: regime
	  }

  const llm = llmForRole('research', now)
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

  let report: ResearchReportResult | null = null
  try {
    report = await generateResearchReport({ llm, model, input })
  } catch (primaryError) {
    if (llm === 'codex') {
      const canUseClaude = await isClaudeAvailable()
      if (canUseClaude) {
        try {
          report = await generateResearchReport({ llm: 'claude', model: env.CLAUDE_MODEL, input })
          const disabled = maybeDisableCodexFromError(primaryError, now)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `research codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
          })
        } catch (fallbackError) {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `research codex+claude failed; skipping research refresh: ${String(fallbackError).slice(0, 120)}`
          })
          return
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: 'research codex failed: codex and claude unavailable; skipping research refresh'
        })
        return
      }
    } else {
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `research llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
      return
    }
  }

  if (!report) {
    return
  }

  if (report.suggestedTwitterQueries.length > 0) {
    agentSuggestedTwitterQueries = report.suggestedTwitterQueries
  }

  lastResearchReport = { ...report, computedAt: new Date().toISOString() }

  await publishTape({
    correlationId: ulid(),
    role: 'research',
    line: `${report.headline}: regime=${report.regime}`
  })

  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('research'),
    action: 'research.report',
    resource: 'agent.research',
    correlationId: ulid(),
    details: {
      ...report,
      input
    }
  })
}

async function runRiskAgent(): Promise<void> {
  const now = Date.now()
  lastRiskAt = now

  const summary = summarizePositionsForAgents(lastPositions)
  const signalPack = summarizeLatestSignals(now)
  const latestVol = latestSignalFromPack(signalPack, 'volatility')

	  const currentRiskPolicy = resolveRiskLimitsForContext()
	  const input = {
	    ts: new Date().toISOString(),
	    mode: lastMode,
	    drift: summary.drift,
	    postureHint: summary.posture,
	    pnlPct: lastStateUpdate?.pnlPct ?? null,
	    accountValueUsd: lastStateUpdate?.accountValueUsd ?? null,
	    vol1hPct: latestVol?.value ?? null,
	    signalCoverage: {
	      types: Object.keys(signalPack).length,
	      signalCount: Object.values(signalPack).reduce((count, entries) => count + entries.length, 0)
	    },
	    signals: signalPack,
	    externalIntel: lastExternalIntel ? summarizeExternalIntel(lastExternalIntel) : null,
	    lastRiskDecision,
	    currentRiskPolicy
	  }

  const llm = llmForRole('risk', now)
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

  let report: RiskReportResult | null = null
  try {
    report = await generateRiskReport({ llm, model, input })
  } catch (primaryError) {
    if (llm === 'codex') {
      const canUseClaude = await isClaudeAvailable()
      if (canUseClaude) {
        try {
          report = await generateRiskReport({ llm: 'claude', model: env.CLAUDE_MODEL, input })
          const disabled = maybeDisableCodexFromError(primaryError, now)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `risk codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
          })
        } catch (fallbackError) {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `risk codex+claude failed; skipping risk refresh: ${String(fallbackError).slice(0, 120)}`
          })
          return
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: 'risk codex failed: codex and claude unavailable; skipping risk refresh'
        })
        return
      }
    } else {
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `risk llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
      return
    }
  }

  if (!report) {
    return
  }

  lastRiskReport = { ...report, computedAt: new Date().toISOString() }

  await publishTape({
    correlationId: ulid(),
    role: 'risk',
    line: `${report.headline}: ${report.posture} drift=${summary.drift}`
  })

  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('risk'),
    action: 'risk.report',
    resource: 'agent.risk',
    correlationId: ulid(),
    details: {
      ...report,
      derived: summary,
      input
    }
  })

  if (report.policyRecommendations) {
    const policyUpdate = buildRiskPolicyArgsFromRecommendations(report.policyRecommendations)
    if (policyUpdate && Date.now() - lastRiskPolicyTuneAt >= RISK_POLICY_TUNING_COOLDOWN_MS) {
      lastRiskPolicyTuneAt = Date.now()
      lastRiskPolicyTuneSignature = policyUpdate.args.sort().join('|')
      await publishAgentCommand({
        command: '/risk-policy',
        args: policyUpdate.args,
        reason: policyUpdate.reason
      })

      await publishTape({
        correlationId: ulid(),
        role: 'risk',
        level: 'WARN',
        line: `risk agent policy update: ${policyUpdate.args.join(', ')}`
      })
    }
  }
}

async function maybeRefreshStrategistDirective(params: { signals: PluginSignal[]; targetNotionalUsd: number; positions: OperatorPosition[] }): Promise<void> {
  const nowMs = Date.now()
  if (directiveInFlight) {
    return
  }

  // Deterministic safety: SAFE_MODE should bias to risk-off without waiting for an LLM decision.
  if (lastMode === 'SAFE_MODE' && params.positions.length > 0) {
    if (activeDirective.decision === 'EXIT') {
      return
    }
    lastDirectiveAt = nowMs
    activeDirective = {
      decision: 'EXIT',
      plan: null,
      rationale: 'SAFE_MODE: force exit to flat',
      confidence: 1,
      decidedAt: new Date().toISOString()
    }
    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      level: 'WARN',
      line: `directive: EXIT (safe mode)`
    })
    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'strategist.directive',
      resource: 'agent.strategist',
      correlationId: ulid(),
      details: activeDirective
    })
    return
  }

  directiveInFlight = true
  try {
    const summary = summarizePositionsForAgents(params.positions)
    const heldSymbols = basketFromPositions(params.positions)
    const signalPack = summarizeLatestSignals(nowMs)
    const latestVol = latestSignalFromPack(signalPack, 'volatility')
    const latestCorr = latestSignalFromPack(signalPack, 'correlation')
    const latestFunding = latestSignalFromPack(signalPack, 'funding')

    const input = {
      ts: new Date().toISOString(),
      mode: lastMode,
      state: lastStateUpdate ?? null,
      drift: summary.drift,
      postureHint: summary.posture,
      targetNotionalUsd: params.targetNotionalUsd,
      heldSymbols,
      activeUniverse: {
        symbols: activeBasket.symbols,
        rationale: activeBasket.rationale,
        selectedAt: activeBasket.selectedAt,
        context: activeBasket.context ?? null
      },
      positions: params.positions.map((position) => ({
        symbol: position.symbol,
        side: position.side,
        notionalBucket: bucketNotional(position.notionalUsd),
        updatedAt: position.updatedAt
      })),
	      signals: {
	        all: signalPack,
	        latest: {
	          volatility: latestVol?.value ?? null,
	          correlation: latestCorr?.value ?? null,
	          funding: latestFunding?.value ?? null
	        }
	      },
	      externalIntel: lastExternalIntel ? summarizeExternalIntel(lastExternalIntel) : null,
	      lastRiskDecision,
	      lastResearchReport,
	      lastRiskReport,
	      lastScribeAnalysis,
	      currentDirective: activeDirective
	    }

    const llm = llmForRole('strategist', nowMs)
    const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

    let raw: { decision: StrategistDirectiveDecision; plan: DirectivePlan | null; rationale: string; confidence: number }
    try {
      raw = await generateStrategistDirective({ llm, model, input })
    } catch (primaryError) {
      if (llm === 'codex') {
        const canUseClaude = await isClaudeAvailable()
        if (canUseClaude) {
          try {
            raw = await generateStrategistDirective({ llm: 'claude', model: env.CLAUDE_MODEL, input })
            const disabled = maybeDisableCodexFromError(primaryError, nowMs)
            const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `directive codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
            })
          } catch (fallbackError) {
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `directive refresh failed after codex+claude fallback: ${String(fallbackError).slice(0, 120)}`
            })
            return
          }
        } else {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: 'directive refresh failed: codex and claude unavailable, holding previous directive'
          })
          return
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `directive refresh failed: ${String(primaryError).slice(0, 120)}`
        })
        return
      }
    }

    activeDirective = {
      decision: raw.decision,
      plan: raw.decision === 'OPEN' || raw.decision === 'REBALANCE' ? raw.plan : null,
      rationale: raw.rationale || 'directive',
      confidence: clamp(Number(raw.confidence), 0, 1),
      decidedAt: new Date().toISOString()
    }
    lastDirectiveAt = nowMs

    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      line: `directive: ${activeDirective.decision}${activeDirective.plan ? ` with ${activeDirective.plan.legs.length} legs` : ' (no plan)'}`
    })

    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'strategist.directive',
      resource: 'agent.strategist',
      correlationId: ulid(),
      details: {
        ...activeDirective,
        input
      }
    })
  } finally {
    directiveInFlight = false
  }
}

async function runStrategistCycle(): Promise<void> {
  const now = Date.now()
  lastProposalAt = now

  if (lastMode === 'HALT') {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'WARN',
      line: `strategy paused (mode=${lastMode})`
    })
    return
  }

	  if (lastMode === 'SAFE_MODE' && lastPositions.length === 0) {
	    return
	  }

	  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
	  const leverageAwareBase = leverageAwareBaseTargetNotionalUsd(env.AGENT_TARGET_NOTIONAL_USD)
	  const baseTargetNotionalUsd = computeTargetNotional(leverageAwareBase, signals)
	  const tactics = computeExecutionTactics({ signals })
	  const nowMs = Date.now()
	  const hasFreshUniverse =
	    activeBasket.symbols.length >= 1 && nowMs - Date.parse(activeBasket.selectedAt) <= env.AGENT_UNIVERSE_REFRESH_MS

  syncActiveBasketFromPositions(lastPositions)

  // Ensure universe is populated even during HOLD so it's ready when directives change.
  if (!hasFreshUniverse && lastMode !== 'HALT') {
    await maybeSelectBasket({ targetNotionalUsd: baseTargetNotionalUsd, signals, positions: lastPositions, force: activeBasket.symbols.length === 0 })
  }

  await maybeRefreshStrategistDirective({ signals, targetNotionalUsd: baseTargetNotionalUsd, positions: lastPositions })
  const riskRecovery = shouldForceRiskRecovery(now, lastPositions)
  if (riskRecovery.active) {
    if (riskRecovery.signature !== lastRiskRecoverySignature) {
      lastRiskRecoverySignature = riskRecovery.signature
      const computed = riskRecovery.computed
      const safeExposure = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : 'na')
      const exposure = computed
        ? ` gross=${safeExposure(computed.grossExposureUsd)} net=${safeExposure(computed.netExposureUsd)} drawdown=${safeExposure(computed.projectedDrawdownPct)}%`
        : ''

      if (now - lastRiskRecoveryNoticeAt > 60_000) {
        lastRiskRecoveryNoticeAt = now
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk recovery enforced: ${riskRecovery.reasonMessage}${exposure}`
        })
      }
    }

    if (activeDirective.decision !== 'EXIT') {
      activeDirective = {
        decision: 'EXIT',
        plan: null,
        rationale: riskRecovery.reasonMessage,
        confidence: 1,
        decidedAt: new Date().toISOString()
      }
      lastDirectiveAt = now
    }
  } else {
    lastRiskRecoverySignature = ''
  }

  const scaledTargetNotionalUsd = Number(
    Math.max(100, baseTargetNotionalUsd).toFixed(2)
  )

  let proposal: StrategyProposal | null = null
  if (activeDirective.decision !== 'EXIT') {
    lastExitProposalSignature = null
  }

  if (activeDirective.decision === 'EXIT') {
    const exitSignature = buildFlatSignature(lastPositions, EXIT_NOTIONAL_EPSILON_USD)
    if (exitSignature === 'FLAT') {
      const noActionLine = `no action (mode=${lastMode} already flat)`
      const now = Date.now()
      const shouldPublishNoAction =
        noActionLine !== lastStrategistNoActionSignature || now - lastStrategistNoActionAtMs >= STRATEGIST_NO_ACTION_SUPPRESS_MS
      if (shouldPublishNoAction) {
        lastStrategistNoActionAtMs = now
        lastStrategistNoActionSignature = noActionLine
        await publishTape({
          correlationId: ulid(),
          role: 'scout',
          line: noActionLine
        })
      }

      lastExitProposalSignature = 'FLAT'
      if (
        activeDirective.decision === 'EXIT' &&
        !riskRecovery.active &&
        lastMode !== 'SAFE_MODE' &&
        lastMode !== 'HALT'
      ) {
        activeDirective = {
          decision: 'HOLD',
          plan: null,
          rationale: 'recovered to flat: resume discretionary holding',
          confidence: 0.8,
          decidedAt: new Date().toISOString()
        }
        lastDirectiveAt = now
        lastExitProposalSignature = null
        await publishTape({
          correlationId: ulid(),
          role: 'strategist',
          line: 'directive: HOLD (recovery complete, resume discretionary operation)'
        })
      }
      return
    }
    if (lastExitProposalSignature === exitSignature) {
      return
    }
    lastExitProposalSignature = exitSignature
  }

  if (activeDirective.decision === 'EXIT') {
    proposal = buildExitProposal({
      createdBy: roleActorId('strategist'),
      positions: lastPositions,
      signals,
      requestedMode: requestedModeFromEnv(),
      executionTactics: tactics,
      confidence: activeDirective.confidence,
      rationale: activeDirective.rationale
    })
  } else if (activeDirective.decision === 'OPEN' || activeDirective.decision === 'REBALANCE') {
    if (!activeDirective.plan) {
      const noActionLine = `no action (mode=${lastMode} missing plan for ${activeDirective.decision})`
      const now = Date.now()
      const shouldPublishNoAction =
        noActionLine !== lastStrategistNoActionSignature || now - lastStrategistNoActionAtMs >= STRATEGIST_NO_ACTION_SUPPRESS_MS
      if (shouldPublishNoAction) {
        lastStrategistNoActionAtMs = now
        lastStrategistNoActionSignature = noActionLine
        await publishTape({
          correlationId: ulid(),
          role: 'scout',
          line: noActionLine
        })
      }
      return
    }

    if (lastPositions.length === 0 && !hasFreshUniverse) {
      await maybeSelectBasket({ targetNotionalUsd: scaledTargetNotionalUsd, signals, positions: lastPositions, force: true })
      if (activeBasket.symbols.length === 0) {
        const noActionLine = `no action (mode=${lastMode} awaiting fresh universe selection)`
        const now = Date.now()
        const shouldPublishNoAction =
          noActionLine !== lastStrategistNoActionSignature || now - lastStrategistNoActionAtMs >= STRATEGIST_NO_ACTION_SUPPRESS_MS
        if (shouldPublishNoAction) {
          lastStrategistNoActionAtMs = now
          lastStrategistNoActionSignature = noActionLine
          await publishTape({
            correlationId: ulid(),
            role: 'scout',
            line: noActionLine
          })
        }
        return
      }
    }

    proposal = buildDiscretionaryProposal({
      createdBy: roleActorId('strategist'),
      plan: activeDirective.plan,
      positions: lastPositions,
      signals,
      requestedMode: requestedModeFromEnv(),
      executionTactics: tactics,
      confidence: activeDirective.confidence,
      rationale: activeDirective.rationale,
      summaryPrefix: activeDirective.decision === 'REBALANCE' ? 'agent rebalance' : 'agent autonomous'
    })
  } else {
    const noActionLine = `no action (mode=${lastMode} holding)`
    const now = Date.now()
    const shouldPublishNoAction =
      noActionLine !== lastStrategistNoActionSignature || now - lastStrategistNoActionAtMs >= STRATEGIST_NO_ACTION_SUPPRESS_MS
    if (shouldPublishNoAction) {
      lastStrategistNoActionAtMs = now
      lastStrategistNoActionSignature = noActionLine
      await publishTape({
        correlationId: ulid(),
        role: 'scout',
        line: noActionLine
      })
    }
    return
  }
  if (!proposal) {
    const noActionLine = `no action (mode=${lastMode})`
    const now = Date.now()
    const shouldPublishNoAction =
      noActionLine !== lastStrategistNoActionSignature || now - lastStrategistNoActionAtMs >= STRATEGIST_NO_ACTION_SUPPRESS_MS
    if (shouldPublishNoAction) {
      lastStrategistNoActionAtMs = now
      lastStrategistNoActionSignature = noActionLine
      await publishTape({
        correlationId: ulid(),
        role: 'scout',
        line: noActionLine
      })
    }
    return
  }

  const parsed = parseStrategyProposal(proposal)
  if (!parsed.ok) {
    const audit: AuditEvent = {
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: env.AGENT_ID,
      action: 'agent.proposal.invalid',
      resource: 'agent.proposal',
      correlationId: ulid(),
      details: { errors: parsed.errors }
    }
    await publishAudit(audit)
    return
  }

  const proposalSummary = renderLegSummary(parsed.proposal.actions[0]?.legs ?? [])
  const proposalSignature = [
    riskRecovery.active ? `risk:${riskRecovery.signature}` : 'risk:clear',
    activeDirective.decision,
    parsed.proposal.requestedMode,
    proposalSummary ?? parsed.proposal.summary
  ].join('|')
  if (proposalSignature === lastStrategyProposalSignature) {
    return
  }
  lastStrategyProposalSignature = proposalSignature

  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'scout',
    line: `proposal ${parsed.proposal.actions[0]?.type ?? 'ACTION'}: ${proposalSummary ?? parsed.proposal.summary}`
  })

  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'execution',
    line: `tactics slippage=${tactics.expectedSlippageBps}bps cap=${tactics.maxSlippageBps}bps`
  })

  await publishProposal({ actorId: roleActorId('strategist'), proposal: parsed.proposal })
  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('strategist'),
    action: 'agent.proposal',
    resource: 'agent.proposal',
    correlationId: parsed.proposal.proposalId,
    details: {
      summary: parsed.proposal.summary,
      decision: activeDirective.decision,
      requestedMode: parsed.proposal.requestedMode,
      confidence: parsed.proposal.confidence,
      plan: parsed.proposal.actions[0]?.legs?.map((leg) => ({
        symbol: leg.symbol,
        side: leg.side,
        notionalUsd: leg.notionalUsd
      })),
      riskRecoveryActive: riskRecovery.active,
      riskRecoverySignature: riskRecovery.signature
    }
  })
  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'strategist',
    line: `${parsed.proposal.summary} (confidence=${parsed.proposal.confidence.toFixed(2)} mode=${parsed.proposal.requestedMode} positions=${lastPositions.length})`
  })

  lastProposal = parsed.proposal
  lastProposalPublishedAt = now
  lastAnalysisAt = now

  await runScribeAnalysis(parsed.proposal, { targetNotionalUsd: scaledTargetNotionalUsd })
}

async function runScribeAnalysis(proposal: StrategyProposal, context: { targetNotionalUsd: number }): Promise<void> {
  const nowMs = Date.now()
  const universe = new Set<string>([...activeBasket.symbols, ...lastPositions.map((position) => position.symbol)])
  const tickSnapshot = [...universe].map((symbol) => latestTicks.get(symbol)).filter(Boolean)
  const signalPack = summarizeLatestSignals(nowMs)
	  const analysisInput = {
	    ts: new Date().toISOString(),
	    mode: lastMode,
	    targetNotionalUsd: context.targetNotionalUsd,
	    universeSymbols: activeBasket.symbols.join(','),
	    basketContext: activeBasket.context ?? null,
	    signals: signalPack,
	    externalIntel: lastExternalIntel ? summarizeExternalIntel(lastExternalIntel) : null,
	    ticks: tickSnapshot,
	    positions: lastPositions,
	    proposal
	  }

  const llm = llmForRole('scribe', nowMs)
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL
  let analysis: { headline: string; thesis: string; risks: string[]; confidence: number } | null = null
  try {
    analysis = await generateAnalysis({ llm, model, input: analysisInput })
  } catch (primaryError) {
    if (llm === 'codex') {
      const canUseClaude = await isClaudeAvailable()
      if (canUseClaude) {
        try {
          analysis = await generateAnalysis({ llm: 'claude', model: env.CLAUDE_MODEL, input: analysisInput })
          const disabled = maybeDisableCodexFromError(primaryError, nowMs)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: proposal.proposalId,
            role: 'ops',
            level: 'WARN',
            line: `scribe codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
          })
        } catch (fallbackError) {
          await publishTape({
            correlationId: proposal.proposalId,
            role: 'ops',
            level: 'WARN',
            line: `scribe codex+claude failed; skipping scribe update: ${String(fallbackError).slice(0, 120)}`
          })
          return
        }
      } else {
        await publishTape({
          correlationId: proposal.proposalId,
          role: 'ops',
          level: 'WARN',
          line: 'scribe codex unavailable: codex and claude unavailable; skipping scribe update'
        })
        return
      }
    } else {
      await publishTape({
        correlationId: proposal.proposalId,
        role: 'ops',
        level: 'WARN',
        line: `scribe llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
      return
    }
  }

  if (!analysis) {
    return
  }

  lastScribeAnalysis = { ...analysis, computedAt: new Date().toISOString() }

  await publishTape({
    correlationId: proposal.proposalId,
    role: 'scribe',
    line: `${analysis.headline} (confidence=${analysis.confidence.toFixed(2)})`
  })

  const audit: AuditEvent = {
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('scribe'),
    action: 'analysis.report',
    resource: 'agent.analysis',
    correlationId: proposal.proposalId,
    details: {
      ...analysis,
      input: analysisInput
    }
  }
  await publishAudit(audit)
}

const start = async (): Promise<void> => {
  await bus.consume('hlp.market.normalized', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type !== 'MARKET_TICK') {
      return
    }
    const payload = envelope.payload as any
    if (!payload?.symbol) return
    const symbol = String(payload.symbol)
    const px = Number(payload.px)
    const bid = Number(payload.bid)
    const ask = Number(payload.ask)
    if (!Number.isFinite(px) || !Number.isFinite(bid) || !Number.isFinite(ask)) return

    latestTicks.set(symbol, {
      symbol,
      px,
      bid,
      ask,
      bidSize: typeof payload.bidSize === 'number' ? payload.bidSize : undefined,
      askSize: typeof payload.askSize === 'number' ? payload.askSize : undefined,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString()
    })
  })



  type RateLimitLevel = 'warn' | 'error'

  function createRateLimitedLogger(intervalMs: number) {
    const last = new Map<string, number>()
    return (
      key: string,
      level: RateLimitLevel,
      message: string,
      meta?: Record<string, unknown>
    ) => {
      const now = Date.now()
      const lastAt = last.get(key) ?? 0
      if (now - lastAt < intervalMs) {
        return
      }
      last.set(key, now)
      const payload = meta ? { ...meta } : undefined
      if (level === 'warn') {
        console.warn(message, payload)
      } else {
        console.error(message, payload)
      }
    }
  }

  const warnMalformedEnvelope = (() => {
    const log = createRateLimitedLogger(30_000)
    return (stream: string, type: string, payload: unknown, reason: string) => {
      log(
        `agent-runner.envelope.${stream}.${type}.${reason}`,
        'warn',
        'agent-runner: skipping malformed envelope payload',
        {
          stream,
          type,
          reason,
          payloadType: payload === null ? 'null' : typeof payload
        }
      )
    }
  })()

  const warnHeartbeatWriteFailed = (() => {
    const log = createRateLimitedLogger(30_000)
    return (error: unknown) => {
      log(
        'agent-runner.heartbeat.write',
        'warn',
        'agent-runner: failed to write heartbeat file',
        {
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        }
      )
    }
  })()

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null
  }

  const finiteNumber = (value: unknown): number | undefined => {
    const num = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(num) ? num : undefined
  }

  const asRiskDecision = (value: unknown): 'DENY' | 'ALLOW_REDUCE_ONLY' | 'ALLOW' | undefined => {
    if (value === 'DENY' || value === 'ALLOW_REDUCE_ONLY' || value === 'ALLOW') {
      return value
    }
    return undefined
  }

  await bus.consume('hlp.plugin.signals', '$', (envelope: EventEnvelope<any>) => {
    const payload = envelope.payload as any
    if (!payload?.signalType || !payload?.pluginId) {
      return
    }
    const signal = payload as PluginSignal
    latestSignals.set(`${signal.signalType}:${signal.pluginId}`, signal)
  })

  await bus.consume('hlp.ui.events', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type === 'STATE_UPDATE') {
      const payload = envelope.payload as unknown
      if (!isRecord(payload)) {
        warnMalformedEnvelope('hlp.ui.events', 'STATE_UPDATE', payload, 'not_record')
        return
      }

      const stateAtMs = typeof payload.lastUpdateAt === 'string' ? Date.parse(payload.lastUpdateAt) : Date.now()
      lastStateUpdateAtMs = Number.isFinite(stateAtMs) ? stateAtMs : Date.now()

      const message = typeof payload.message === 'string' ? payload.message : ''
      const parsedStateRiskMessage = message ? parseRiskStateMessage(message, lastStateUpdateAtMs) : null
      if (parsedStateRiskMessage) {
        lastStateRiskMessage = parsedStateRiskMessage
      }

      const riskPolicyPayload = isRecord(payload.riskPolicy) ? payload.riskPolicy : null
      lastStateUpdate = {
        mode: typeof payload.mode === 'string' ? payload.mode : undefined,
        pnlPct: finiteNumber(payload.pnlPct),
        realizedPnlUsd: finiteNumber(payload.realizedPnlUsd),
        accountValueUsd: finiteNumber(payload.accountValueUsd),
        driftState: typeof payload.driftState === 'string' ? payload.driftState : undefined,
        lastUpdateAt: typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : undefined,
        message: typeof payload.message === 'string' ? payload.message : undefined,
        riskPolicy: riskPolicyPayload
          ? {
              maxLeverage: finiteNumber(riskPolicyPayload.maxLeverage),
              targetLeverage: finiteNumber(riskPolicyPayload.targetLeverage),
              maxDrawdownPct: finiteNumber(riskPolicyPayload.maxDrawdownPct),
              maxExposureUsd: finiteNumber(riskPolicyPayload.maxExposureUsd),
              maxSlippageBps: finiteNumber(riskPolicyPayload.maxSlippageBps),
              staleDataMs: finiteNumber(riskPolicyPayload.staleDataMs),
              liquidityBufferPct: finiteNumber(riskPolicyPayload.liquidityBufferPct),
              notionalParityTolerance: finiteNumber(riskPolicyPayload.notionalParityTolerance)
            }
          : undefined
      }

      if (payload.mode) {
        lastMode = String(payload.mode)
      }
    }
    if (envelope.type === 'POSITION_UPDATE') {
      const payload = envelope.payload as unknown
      if (!Array.isArray(payload)) {
        warnMalformedEnvelope('hlp.ui.events', 'POSITION_UPDATE', payload, 'not_array')
        return
      }

      if (payload.length === 0) {
        lastPositions = []
        return
      }

      const positions = payload
        .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.symbol === 'string')
        .map((item) => item as unknown as OperatorPosition)

      if (positions.length === 0) {
        warnMalformedEnvelope('hlp.ui.events', 'POSITION_UPDATE', payload, 'empty_or_invalid')
        return
      }

      lastPositions = meaningfulPositions(positions, EXIT_NOTIONAL_EPSILON_USD)
      syncActiveBasketFromPositions(lastPositions)
      if (basketPivot) {
        const nowMs = Date.now()
        if (nowMs > basketPivot.expiresAtMs) {
          basketPivot = null
        } else {
          const held = basketFromPositions(lastPositions)
          if (held.length > 0 && sameBasket(held, basketPivot.basketSymbols)) {
            basketPivot = null
            void publishTape({
              correlationId: ulid(),
              role: 'execution',
              line: `basket pivot complete: ${held.join(',')}`
            }).catch(() => undefined)
          }
        }
      }
    }
  })

  await bus.consume('hlp.risk.decisions', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type !== 'risk.decision') {
      return
    }
    const payload = envelope.payload as unknown
    if (!isRecord(payload)) {
      warnMalformedEnvelope('hlp.risk.decisions', 'risk.decision', payload, 'not_record')
      return
    }
      const reasons = Array.isArray(payload.reasons)
        ? payload.reasons
          .map((item: any) => ({
            code: typeof item?.code === 'string' ? item.code : '',
            message: typeof item?.message === 'string' ? item.message : '',
            details: typeof item?.details === 'object' && item.details ? item.details as Record<string, unknown> : undefined
          }))
          .filter((reason: RuntimeRiskReason) => reason.code)
        : undefined
      const nextRiskDecision: RuntimeRiskDecision = {
        decision: asRiskDecision(payload.decision),
        computedAt: typeof payload.computedAt === 'string' ? payload.computedAt : undefined,
        reasons,
        decisionId: typeof payload.decisionId === 'string' ? payload.decisionId : undefined,
        proposalCorrelation: typeof payload.proposalCorrelation === 'string' ? payload.proposalCorrelation : undefined,
        computed: isRecord(payload.computed) ? {
          grossExposureUsd: finiteNumber(payload.computed.grossExposureUsd) ?? 0,
          netExposureUsd: finiteNumber(payload.computed.netExposureUsd) ?? 0,
          projectedDrawdownPct: finiteNumber(payload.computed.projectedDrawdownPct) ?? 0,
          notionalImbalancePct: finiteNumber(payload.computed.notionalImbalancePct) ?? 0
        } : undefined
      }
      lastRiskDecision = nextRiskDecision

      // High-signal audit hook for monitoring + journals.
      const decision = nextRiskDecision.decision
      if (decision === 'DENY' || decision === 'ALLOW_REDUCE_ONLY') {
        const codes = parseRiskReasonCodes(nextRiskDecision).slice().sort()
        const signature = `${decision}|${codes.join('|')}`
        const nowMs = Date.now()
        if (signature !== lastRiskDecisionAuditSignature || nowMs - lastRiskDecisionAuditAtMs > 120_000) {
          lastRiskDecisionAuditSignature = signature
          lastRiskDecisionAuditAtMs = nowMs
          void publishAudit({
            id: ulid(),
            ts: new Date().toISOString(),
            actorType: 'system',
            actorId: 'runtime-risk',
            action: 'risk.decision',
            resource: 'runtime.risk',
            correlationId: envelope.correlationId ?? ulid(),
            details: nextRiskDecision as unknown as Record<string, unknown>
          }).catch(() => undefined)
        }
      }
  })

  scheduleGitHubJournalIntervalFlush()

  const HEARTBEAT_PATH = '/tmp/.agent-runner-heartbeat'
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  let tickRunning = true
  let consecutiveFailures = 0
  const BASE_TICK_MS = 1000
  const MAX_BACKOFF_MS = 30_000

  const tickLoop = async () => {
    while (tickRunning) {
      const startedAtMs = Date.now()

      try {
        await runOpsAgent()
        await runStrategyPipeline()
        consecutiveFailures = 0
      } catch (error) {
        consecutiveFailures += 1
        // Keep the runner alive; report via audit stream.
        void publishAudit({
          id: ulid(),
          ts: new Date().toISOString(),
          actorType: 'internal_agent',
          actorId: roleActorId('ops'),
          action: 'agent.error',
          resource: 'agent.runner',
          correlationId: ulid(),
          details: { message: String(error) }
        }).catch((publishError) => {
          console.warn('agent-runner: publishAudit failed in error handler', {
            error: String(publishError)
          })
        })
      } finally {
        await fs.writeFile(HEARTBEAT_PATH, String(Date.now())).catch((error) => {
          warnHeartbeatWriteFailed(error)
        })

        const elapsedMs = Date.now() - startedAtMs
        const backoffMs = consecutiveFailures > 0
          ? Math.min(MAX_BACKOFF_MS, BASE_TICK_MS * (2 ** (consecutiveFailures - 1)))
          : BASE_TICK_MS
        const delayMs = Math.max(0, backoffMs - elapsedMs)
        await sleep(delayMs)
      }
    }
  }

  void tickLoop()

  await publishTape({ correlationId: ulid(), role: 'ops', line: `crew online requestedMode=${requestedModeFromEnv()}` })
  await publishTape({ correlationId: ulid(), role: 'scout', line: 'scout online (market + tape)' })
  await publishTape({ correlationId: ulid(), role: 'research', line: 'research online (regime + basket notes)' })
  await publishTape({ correlationId: ulid(), role: 'risk', line: 'risk online (posture + constraints)' })
  await publishTape({ correlationId: ulid(), role: 'strategist', line: 'strategist online (proposals)' })
  await publishTape({ correlationId: ulid(), role: 'execution', line: 'execution online (tactics)' })
  await publishTape({ correlationId: ulid(), role: 'scribe', line: 'scribe online (analysis)' })

  await fs.writeFile(HEARTBEAT_PATH, String(Date.now())).catch((error) => {
    warnHeartbeatWriteFailed(error)
  })
  console.log(`agent-runner started agentId=${env.AGENT_ID} llm=${env.AGENT_LLM} requestedMode=${requestedModeFromEnv()}`)
}

void start().catch((error) => {
  console.error(error)
  process.exit(1)
})
