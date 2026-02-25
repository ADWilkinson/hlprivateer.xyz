import { ulid } from 'ulid'
import fs from 'node:fs/promises'
import path from 'node:path'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import type { EventEnvelope, AuditEvent, OperatorPosition, StrategyProposal } from '@hl/privateer-contracts'
import { parseStrategyProposal } from '@hl/privateer-contracts'
import type { PluginSignal } from '@hl/privateer-plugin-sdk'
import { createHlClient } from '@hl/privateer-hl-client'
import { env } from './config'
import { buildFlatSignature, meaningfulPositions } from './exposure'
import { fetchMetaAndAssetCtxs, type HyperliquidUniverseAsset } from './hyperliquid'
import { computePriceFeaturePack, type PriceFeature } from './price-features'
import { createCoinGeckoClient, type CoinGeckoCategorySnapshot, type CoinGeckoMarketSnapshot } from './coingecko'
import { isCommandAvailable, runClaudeStructured, runCodexStructured } from './llm'
import { summarizeExternalIntel, type ExternalIntelPack } from './intel'
import { HistoryStore, formatHistoryForPrompt, type ResearchHistoryEntry, type RiskHistoryEntry, type DirectiveHistoryEntry, type IntelHistoryEntry } from './history-store'
import { TradeJournal } from './trade-journal'
import { computeTechnicalSignals, type TechnicalSignalPack } from './technical-signals'
import { computeCompositeSignals, type CompositeSignalPack } from './market-microstructure'
import { ConvictionBoard } from './conviction-board'

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

const DISCORD_ACTION_SET = new Set<string>(['run.summary'])
const GITHUB_API_BASE_URL = ''

const JOURNAL_PATH = path.resolve(process.cwd(), env.AGENT_JOURNAL_PATH)
const GITHUB_JOURNAL_PATH = ''

let journalWriteChain: Promise<void> = Promise.resolve()
let journalDirectoryReady = new Map<string, Promise<void>>()
let githubJournalWriteChain: Promise<void> = Promise.resolve()
let githubJournalFlushChain: Promise<void> = Promise.resolve()
let githubJournalFlushTimer: ReturnType<typeof setInterval> | null = null
let pendingGitHubJournalTargets = new Map<string, GitHubJournalTarget>()
let lastDiscordNotifyByFingerprint = new Map<string, number>()
type DiscordRunSummaryState = {
  cycleId: string
  startedAtMs: number
  modeStart: string
  symbolCountStart: number
  recommendationStart: string
  auditEventCount: number
  warnCount: number
  errorCount: number
  actionCounts: Map<string, number>
  highlights: string[]
}
let activeDiscordRunSummary: DiscordRunSummaryState | null = null

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
  return false
}

function isGitHubJournalEnabled(): boolean {
  return false
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
  if (action === 'run.summary') {
    const details = event.details && typeof event.details === 'object' ? (event.details as Record<string, unknown>) : {}
    const errorCount = Number(details.errorCount ?? 0)
    const warnCount = Number(details.warnCount ?? 0)
    if (Number.isFinite(errorCount) && errorCount > 0) {
      return 'ERROR'
    }
    if (Number.isFinite(warnCount) && warnCount > 0) {
      return 'WARN'
    }
    return 'INFO'
  }
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
  return sanitizeLine(env.DISCORD_WEBHOOK_URL, 2000).length > 0
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

  const aixbt = d.aixbt as Record<string, unknown> | null | undefined
  if (aixbt && typeof aixbt === 'object') {
    const ok = aixbt.ok ? 'ok' : 'degraded'
    const basketCount = typeof aixbt.basketSignalCount === 'number' ? aixbt.basketSignalCount : 0
    const broadCount = typeof aixbt.broadSignalCount === 'number' ? aixbt.broadSignalCount : 0
    const statusParts = [`${ok} (${basketCount} basket, ${broadCount} broad)`]
    if (aixbt.error) statusParts.push(sanitizeLine(String(aixbt.error), 80))
    fields.push({ name: 'AIXBT', value: sanitizeLine(statusParts.join(' — '), 128), inline: true })

    const basketSignals = Array.isArray(aixbt.basketSignals) ? (aixbt.basketSignals as Array<Record<string, unknown>>) : []
    if (basketSignals.length > 0) {
      const lines = basketSignals.slice(0, 3).map((s) => {
        const cat = sanitizeLine(String(s.category ?? ''), 24)
        const name = sanitizeLine(String(s.projectName ?? ''), 20).toUpperCase()
        const desc = sanitizeLine(String(s.description ?? ''), 160)
        return cat ? `**${name}** [${cat}] ${desc}` : `**${name}** ${desc}`
      })
      fields.push({ name: 'Basket Signals', value: sanitizeDiscordMultiline(lines.join('\n'), 1024) })
    }

    const momentumHistory = Array.isArray(aixbt.momentumHistory) ? (aixbt.momentumHistory as Array<Record<string, unknown>>) : []
    if (momentumHistory.length > 0) {
      const trendLine = momentumHistory
        .map((p) => `${sanitizeLine(String(p.ticker ?? ''), 8).toUpperCase()}: ${sanitizeLine(String(p.trend ?? ''), 20)}`)
        .join(' | ')
      fields.push({ name: 'Momentum', value: sanitizeLine(trendLine, 256), inline: true })
    }

    const indigo = typeof aixbt.indigoInsight === 'string' ? aixbt.indigoInsight : null
    if (indigo) {
      fields.push({ name: 'Indigo', value: sanitizeDiscordMultiline(indigo.slice(0, 500), 512) })
    }
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

function formatRunSummaryEmbed(d: Record<string, unknown>): DiscordEmbedResult {
  const outcome = sanitizeLine(String(d.outcome ?? 'completed'), 32).toUpperCase()
  const durationMs = Number(d.durationMs ?? 0)
  const modeStart = sanitizeLine(String(d.modeStart ?? '--'), 24).toUpperCase()
  const modeEnd = sanitizeLine(String(d.modeEnd ?? '--'), 24).toUpperCase()
  const fields: DiscordEmbedField[] = [
    { name: 'Outcome', value: outcome || '--', inline: true },
    { name: 'Duration', value: Number.isFinite(durationMs) ? `${Math.max(0, Math.round(durationMs))}ms` : '--', inline: true },
    { name: 'Mode', value: `${modeStart || '--'} -> ${modeEnd || '--'}`, inline: true },
    {
      name: 'Alerts',
      value: `warn=${Math.max(0, Number(d.warnCount ?? 0) || 0)} error=${Math.max(0, Number(d.errorCount ?? 0) || 0)}`,
      inline: true
    },
    {
      name: 'Events',
      value: String(d.actionBreakdown ?? '--') || '--'
    }
  ]
  const highlights = sanitizeLine(String(d.highlights ?? ''), 2000)
  if (highlights) {
    fields.push({ name: 'Highlights', value: sanitizeDiscordMultiline(highlights, 1024) })
  }
  const note = sanitizeLine(String(d.note ?? ''), 300)
  if (note) {
    fields.push({ name: 'Note', value: sanitizeDiscordMultiline(note, 512) })
  }
  return { description: '**Pipeline run summary**', fields }
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
  'run.summary': formatRunSummaryEmbed,
}

function startDiscordRunSummary(params: {
  cycleId: string
  startedAtMs: number
  modeStart: string
  symbolCountStart: number
  recommendationStart: string
}): DiscordRunSummaryState {
  return {
    cycleId: params.cycleId,
    startedAtMs: params.startedAtMs,
    modeStart: params.modeStart,
    symbolCountStart: params.symbolCountStart,
    recommendationStart: params.recommendationStart,
    auditEventCount: 0,
    warnCount: 0,
    errorCount: 0,
    actionCounts: new Map<string, number>(),
    highlights: []
  }
}

function summarizeRunActionCounts(actionCounts: Map<string, number>, maxItems = 8): string {
  const ranked = Array.from(actionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
  if (ranked.length === 0) {
    return 'none'
  }
  return ranked.map(([action, count]) => `${action}:${count}`).join(', ')
}

function summaryHighlightForEvent(event: AuditEvent): string | null {
  const details = event.details && typeof event.details === 'object' ? (event.details as Record<string, unknown>) : {}
  if (event.action === 'research.report') {
    const recommendation = sanitizeLine(String(details.recommendation ?? ''), 24).toUpperCase()
    const regime = sanitizeLine(String(details.regime ?? ''), 24).toUpperCase()
    if (recommendation || regime) {
      return `research ${recommendation || '--'} (${regime || '--'})`
    }
  }
  if (event.action === 'risk.report') {
    const posture = sanitizeLine(String(details.posture ?? ''), 24).toUpperCase()
    if (posture) {
      return `risk posture ${posture}`
    }
  }
  if (event.action === 'risk.decision') {
    const decision = sanitizeLine(String(details.decision ?? ''), 24).toUpperCase()
    if (decision) {
      return `risk decision ${decision}`
    }
  }
  if (event.action === 'agent.proposal') {
    const decision = sanitizeLine(String(details.decision ?? ''), 24).toUpperCase()
    const requestedMode = sanitizeLine(String(details.requestedMode ?? ''), 24).toUpperCase()
    if (decision || requestedMode) {
      return `proposal ${decision || '--'} mode=${requestedMode || '--'}`
    }
  }
  if (event.action === 'analysis.report') {
    const headline = sanitizeLine(String(details.headline ?? details.summary ?? ''), 64)
    if (headline) {
      return `analysis ${headline}`
    }
  }
  if (event.action === 'agent.error') {
    const message = sanitizeLine(String(details.message ?? details.error ?? ''), 64)
    if (message) {
      return `error ${message}`
    }
  }

  const level = deriveAuditLevel(event)
  if (level !== 'INFO') {
    const reason = sanitizeLine(String(details.reason ?? details.message ?? ''), 48)
    return reason ? `${event.action}: ${reason}` : event.action
  }

  return null
}

function recordDiscordRunSummaryEvent(event: AuditEvent): void {
  const state = activeDiscordRunSummary
  if (!state) {
    return
  }

  state.auditEventCount += 1
  const action = sanitizeLine(event.action, 120) || 'unknown'
  state.actionCounts.set(action, (state.actionCounts.get(action) ?? 0) + 1)
  const level = deriveAuditLevel(event)
  if (level === 'WARN') {
    state.warnCount += 1
  } else if (level === 'ERROR') {
    state.errorCount += 1
  }
  const highlight = summaryHighlightForEvent(event)
  if (highlight && !state.highlights.includes(highlight) && state.highlights.length < 8) {
    state.highlights.push(highlight)
  }
}

async function notifyDiscordRunSummary(params: {
  state: DiscordRunSummaryState
  outcome: string
  durationMs: number
  note?: string
  modeEnd: string
  symbolCountEnd: number
  recommendationEnd: string
}): Promise<void> {
  if (!isDiscordNotificationEnabled()) {
    return
  }

  const highlights = params.state.highlights.slice(0, 6).map((line) => `- ${line}`).join('\n')
  await notifyDiscord({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    action: 'run.summary',
    resource: 'agent.pipeline',
    correlationId: params.state.cycleId,
    details: {
      outcome: sanitizeLine(params.outcome, 32),
      durationMs: Math.max(0, Math.round(params.durationMs)),
      modeStart: params.state.modeStart,
      modeEnd: params.modeEnd,
      symbolCountStart: params.state.symbolCountStart,
      symbolCountEnd: params.symbolCountEnd,
      recommendationStart: params.state.recommendationStart,
      recommendationEnd: params.recommendationEnd,
      auditEventCount: params.state.auditEventCount,
      warnCount: params.state.warnCount,
      errorCount: params.state.errorCount,
      actionBreakdown: summarizeRunActionCounts(params.state.actionCounts),
      highlights,
      note: params.note ? sanitizeLine(params.note, 240) : '',
      startedAt: new Date(params.state.startedAtMs).toISOString()
    }
  })
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

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

interface LlmRoleConfig {
  provider: LlmChoice
  model: string
  reasoningEffort: ReasoningEffort
  claudeFallbackModel: string
  timeoutMs: number
}

function llmConfigForRole(_role: FloorRole, nowMs = Date.now()): LlmRoleConfig {
  let provider: LlmChoice = env.AGENT_LLM

  if (provider === 'codex' && codexDisabledUntilMs > nowMs) {
    provider = 'claude'
  }

  const resolvedClaudeModel = env.CLAUDE_MODEL
  const resolvedTimeoutMs = env.AGENT_LLM_TIMEOUT_MS
  return {
    provider,
    model: provider === 'claude' ? resolvedClaudeModel : env.CODEX_MODEL,
    reasoningEffort: env.CODEX_REASONING_EFFORT,
    claudeFallbackModel: resolvedClaudeModel,
    timeoutMs: resolvedTimeoutMs
  }
}

function computeMaxBudgetUsd(): number {
  // No prescribed target — the agent decides sizing. We only expose the hard
  // ceiling from risk policy so the agent knows the envelope it can work within.
  const accountValueUsd = Number((lastStateUpdate as { accountValueUsd?: unknown } | null)?.accountValueUsd)
  if (!Number.isFinite(accountValueUsd) || accountValueUsd <= 0) {
    return 0
  }
  const policy = resolveRiskLimitsForContext()
  const leverageCap = Math.max(0.1, policy.maxLeverage - 0.1)
  const leverageCeiling = accountValueUsd * leverageCap
  return policy.maxExposureUsd > 0 ? Math.min(leverageCeiling, policy.maxExposureUsd) : leverageCeiling
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

function computeExecutionTactics(_params: { signals: PluginSignal[] }): { expectedSlippageBps: number; maxSlippageBps: number } {
  const policy = resolveRiskLimitsForContext()
  const policyCap = Math.max(1, Math.round(policy.maxSlippageBps))

  // Use policy slippage cap directly — no programmatic formula.
  return { expectedSlippageBps: Math.min(5, policyCap), maxSlippageBps: policyCap }
}

const COMMON_AGENT_PROMPT_PREAMBLE: string[] = [
  'Core floor rules (fire-and-forget model):',
  '- Each trade is independent. SL and TP are placed on the exchange at entry. No trailing stops, no runtime exit management.',
  '- Pipeline runs every hour. Between cycles, the system sleeps.',
  '- Position sizing: 50% of account value per trade leg.',
  '- Leverage cap: 10x max. Total gross notional must not exceed 10x accountValueUsd.',
  '- Allowed decisions: OPEN, HOLD, EXIT only.',
  `- The universe is large (${env.AGENT_UNIVERSE_SIZE} assets). Scan broadly — the best opportunity may be anywhere.`,
  '- Synthesize all available context holistically. Every signal gains or loses meaning in relation to other signals. Weight data sources dynamically based on current conditions.',
  '- No direct order routing or execution control lives in this model; runtime + risk-engine are authoritative.',
  '- Never invent symbols, metrics, or events not present in context.',
  '- Return strictly structured JSON only, no commentary.',
  'DATA SOURCES:',
  '- All sources are context. Their relevance varies by regime. Price, funding, OI, aixbt, social, macro — weight them based on what matters NOW, not a fixed hierarchy.',
  '- If some sources are degraded or unavailable, reflect that as reduced certainty — not as a reason to stop trading.',
  '- FEAR & GREED INDEX: Interpret as a contrarian indicator. Extreme fear (low values) historically marks buying opportunities — panic selling creates dislocated entries and favorable risk/reward. Extreme greed (high values) signals euphoria, crowded positioning, and over-extension where de-risking is prudent. Do not treat extreme fear as a reason to block trading or flatten.',
  'DECISION PHILOSOPHY:',
  '- The risk engine provides hard backstops. Your job is to find the best risk-adjusted opportunity and express it clearly.',
  '- Every decision (OPEN, HOLD, EXIT) is valid when the data supports it. No decision is a "default."',
  '- Hesitation has a cost. So does forcing low-conviction trades. Find the right balance for current conditions.',
  'RISK RECOVERY:',
  '- When a recent risk DENY cites DRAWDOWN/EXPOSURE/LEVERAGE, require immediate risk-reduction first.',
  '- SAFE_MODE with open positions: request only flat/close actions until state is cleared.',
  '- DEPENDENCY_FAILURE refers to runtime infrastructure (Redis, Postgres) NOT external data sources.',
  '- Budget caps in floor context are hard constraints enforced by the risk engine.',
  '- Read floor context memory every cycle: active directive, risk caps, recent posture tape, current exposure before sizing.',
  '- Execution channels: /flatten and /risk-policy for safety interventions.'
]

const AGENT_DATA_SOURCES_PRESET: string[] = [
  'Available data sources (injected into context when available):',
  '1) Hyperliquid: market microstructure, funding rates, open interest, orderbook depth, account state.',
  '2) aixbt: momentum scores, cross-source signal detection, project-level intelligence.',
  '3) Twitter/X: social sentiment, narrative tracking, catalyst detection.',
  '4) CoinGecko: sector breadth, category performance, global market cap, volume.',
  '5) DefiLlama: TVL flows, protocol metrics, stablecoin supply changes.',
  '6) Fear & Greed Index: crowd sentiment gauge (contrarian indicator).',
  '7) Technical signals: RSI, trend (1h/4h/1d), ATR, volume ratios.',
  '8) Composite signals: hourly trend classification (swing high/low analysis), BTC macro context (4h+1h trend with alt modifier), volume surges (2x+ vs 20-bar avg), OI velocity (expanding/contracting/stable), funding regime scores, multi-pillar composite (Market Structure / Technicals / Funding, 0-100 each).',
  'All data is fetched programmatically and included in your context. Weight sources dynamically based on current regime. No fixed priority.'
]

function buildAgentSourceAppendix(): string[] {
  return [...AGENT_DATA_SOURCES_PRESET]
}

const FLOOR_TAPE_CONTEXT_LINES = 8
const STRATEGY_CONTEXT_MAX_AGE_MS = 120_000
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
  'SYSTEM_GATED',
  'STALE_DATA',
  'LIQUIDITY',
  'SLIPPAGE_BREACH'
])
const RISK_RECOVERY_TTL_MS = 120_000
const RISK_POLICY_TUNING_COOLDOWN_MS = 120_000

let claudeAvailableCached: boolean | null = null
let codexAvailableCached: boolean | null = null

async function isClaudeAvailable(): Promise<boolean> {
  if (claudeAvailableCached !== null) {
    return claudeAvailableCached
  }

  const available = await isCommandAvailable('claude')
  claudeAvailableCached = available
  return available
}

async function isCodexAvailable(): Promise<boolean> {
  if (codexAvailableCached !== null) {
    return codexAvailableCached
  }

  const available = await isCommandAvailable('codex')
  codexAvailableCached = available
  return available
}

async function canUseCodex(nowMs = Date.now()): Promise<boolean> {
  if (codexDisabledUntilMs > nowMs) {
    return false
  }

  return await isCodexAvailable()
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
  const staleThresholdMs = Math.max(STRATEGY_CONTEXT_MAX_AGE_MS, env.AGENT_PIPELINE_BASE_MS * 2)

  const entries: Record<string, InterAgentRoleContext> = {}
  entries.research = toInterAgentRoleContext(lastResearchAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.risk = toInterAgentRoleContext(lastRiskAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.strategist = toInterAgentRoleContext(lastDirectiveAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.scribe = toInterAgentRoleContext(lastAnalysisAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.execution = toInterAgentRoleContext(Math.max(lastProposalPublishedAt, lastDirectiveAt), nowMs, staleThresholdMs, 'heartbeat')
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
  topPositions: Array<{
    symbol: string
    side: 'LONG' | 'SHORT'
    notionalBucket: string
    absNotionalUsd: number
  }>
} {
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
    exitReason: proposal.exitReason,
    thesis: proposal.thesis
      ? {
        thesisId: proposal.thesis.thesisId,
        horizonClass: proposal.thesis.horizonClass,
        timeframeMin: proposal.thesis.timeframeMin,
        stopLossPct: proposal.thesis.stopLossPct,
        takeProfitPct: proposal.thesis.takeProfitPct,
        createdAt: proposal.thesis.createdAt
      }
      : null,
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
      : env.RISK_LIQUIDITY_BUFFER_PCT
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
const PROMPT_TRUNCATION_LOG_COOLDOWN_MS = 60_000
const promptTruncationLastLogAt = new Map<string, number>()

function toPromptPayload(value: unknown, label: 'FLOOR_CONTEXT' | 'TASK_CONTEXT'): string {
  const raw = JSON.stringify(value)
  if (raw.length <= PROMPT_CONTEXT_MAX_CHARS) {
    return raw
  }

  const nowMs = Date.now()
  const lastLogAt = promptTruncationLastLogAt.get(label) ?? 0
  if (nowMs - lastLogAt >= PROMPT_TRUNCATION_LOG_COOLDOWN_MS) {
    promptTruncationLastLogAt.set(label, nowMs)
    console.warn(`${label} truncated rawLength=${raw.length} limit=${PROMPT_CONTEXT_MAX_CHARS}`)
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
    objective: `Fully discretionary trading across a ${env.AGENT_UNIVERSE_SIZE}-asset universe — directional single-asset conviction is the default; pairs only when specific relative-value divergence exists — with bounded risk and explicit thesis.`,
    generatedAt: new Date(now).toISOString(),
    mode: lastMode,
    requestedMode: requestedModeFromEnv(),
    stateUpdate: lastStateUpdate ?? null,
    risk: {
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
      scribe: compactReportFields(lastScribeAnalysis, ['headline', 'thesis', 'risks', 'confidence', 'computedAt']),
      historicalTrend: {
        consecutiveHolds: directiveHistory.countConsecutiveFromEnd((e) => e.decision === 'HOLD'),
        recentPostures: riskHistory.recent(5).map((e) => e.posture),
        recentRegimes: researchHistory.recent(5).map((e) => e.regime),
        twitterAvailability: intelHistory.recent(5).map((e) => e.twitterOk)
      }
    },
    governance: {
      universeSize: env.AGENT_UNIVERSE_SIZE,
      featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
      accountValueUsd: Number((lastStateUpdate as { accountValueUsd?: unknown } | null)?.accountValueUsd) || 0,
      maxLeverageAvailable: resolveRiskLimitsForContext().maxLeverage,
      buyingPowerUsd: computeMaxBudgetUsd(),
      minLegNotionalUsd: env.AGENT_MIN_REBALANCE_LEG_USD,
      riskLimits: {
        ...resolveRiskLimitsForContext()
      },
      runtimeRecovery: {
        automaticExitSignal: 'AUTO_EXIT when risk decisions block with DRAWDOWN/EXPOSURE/LEVERAGE/SAFE_MODE/LIQUIDITY/STALE_DATA/SYSTEM_GATED. DEPENDENCY_FAILURE refers to runtime infrastructure (Redis/Postgres) only, NOT external data sources like Twitter.',
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
    ...COMMON_AGENT_PROMPT_PREAMBLE,
    '',
    'Data-source stack you can pull from autonomously:',
    ...buildAgentSourceAppendix(),
    '',
    `You are HL Privateer ${params.role}.`,
    `Mission: ${params.mission}`,
    '',
    'Role-specific constraints:',
    ...params.rules.map((rule) => `- ${rule}`),
    '',
    params.schemaHint,
    '',
    `BUILD_CONTEXT_MS=${nowMs}`,
    `FLOOR_CONTEXT=${toPromptPayload(buildCrewFloorContext(nowMs), 'FLOOR_CONTEXT')}`,
    `TASK_CONTEXT=${toPromptPayload(params.context, 'TASK_CONTEXT')}`
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

const hlClient = createHlClient({
  tokensPerMinute: 200,
  startupDelayMs: 5000,
  infoUrl: env.HL_INFO_URL,
})

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
  stopLossPrice?: number
  takeProfitPrice?: number
  thesisNote?: string
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

type StrategistDirectiveDecision = 'OPEN' | 'EXIT' | 'HOLD'

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

  const missing = heldBasket.filter((s) => !activeBasket.symbols.includes(s))
  if (missing.length === 0) {
    return
  }

  // Merge held symbols into the existing basket without replacing it or refreshing selectedAt.
  // This ensures the full universe remains visible to the strategist while positions are open.
  activeBasket = {
    ...activeBasket,
    symbols: [...activeBasket.symbols, ...missing]
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
let basketSelectInFlightSinceMs = 0
let directiveInFlight = false
let directiveInFlightSinceMs = 0
const IN_FLIGHT_LOCK_TIMEOUT_MS = 5 * 60_000
let lastExitProposalSignature: string | null = null
let cachedUniverse: { assets: HyperliquidUniverseAsset[]; fetchedAtMs: number } = { assets: [], fetchedAtMs: 0 }
let basketPivot: { basketSymbols: string[]; startedAtMs: number; expiresAtMs: number } | null = null

async function fetchUniverseAssetsCached(nowMs: number): Promise<HyperliquidUniverseAsset[]> {
  // Keep a short cache to avoid hammering the info endpoint.
  if (cachedUniverse.assets.length > 0 && nowMs - cachedUniverse.fetchedAtMs < 60_000) {
    return cachedUniverse.assets
  }

  const assets = await fetchMetaAndAssetCtxs(hlClient.postInfo)
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
  reasoningEffort?: ReasoningEffort
  input: Record<string, unknown>
  timeoutMs?: number
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
        'Prefer high liquidity (day notional volume + open interest) as a baseline, but liquidity alone is not enough.',
        'Favor assets with active catalysts, momentum shifts, or narrative tailwinds — a liquid but stale asset is less useful than a liquid asset with a developing setup.',
        'Consider funding rate extremes, OI changes, and sector rotation as opportunity signals when selecting.',
        'Favor diversified selections across sectors/narratives over concentrated bets on correlated assets.',
        'Prefer symbols with volume surges (compositeSignals.volumeSurgeSymbols) and expanding OI (compositeSignals.oiExpandingSymbols) — these indicate active participation and developing setups.',
        'Avoid symbols with contracting OI and no volume signal — they are dead weight with no edge.',
        'If context is weak or intel is degraded, keep the opportunity set smaller and more conservative.'
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
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
      })
      : await runCodexStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
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
    if (basketSelectInFlightSinceMs > 0 && nowMs - basketSelectInFlightSinceMs > IN_FLIGHT_LOCK_TIMEOUT_MS) {
      console.warn('[agent-runner] basketSelectInFlight lock expired after timeout, resetting')
      basketSelectInFlight = false
    } else {
      return
    }
  }

  const needsRefresh =
    params.force ||
    activeBasket.symbols.length !== env.AGENT_UNIVERSE_SIZE ||
    nowMs - Date.parse(activeBasket.selectedAt) > env.AGENT_UNIVERSE_REFRESH_MS
  if (!needsRefresh) {
    return
  }

  basketSelectInFlight = true
  basketSelectInFlightSinceMs = nowMs
  try {
    const fixedBasketCsv = env.BASKET_SYMBOLS.trim()
    const fixedBasketSymbols = fixedBasketCsv
      ? fixedBasketCsv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : []

    const universe = await fetchUniverseAssetsCached(nowMs)

    // When BASKET_SYMBOLS is configured, skip LLM universe selection entirely
    // and use only the fixed symbols.
    if (fixedBasketSymbols.length > 0) {
      const universeBySymbol = new Map(universe.map((a) => [a.symbol.toUpperCase(), a]))
      const validFixed = fixedBasketSymbols.filter((s) => universeBySymbol.has(s))
      if (validFixed.length > 0) {
        const baseSymbol = validFixed[0] ?? 'BTC'
        const pricePack = await computePriceFeaturePack({
          postInfo: hlClient.postInfo,
          baseSymbol,
          symbols: validFixed,
          windowMin: env.AGENT_FEATURE_WINDOW_MIN,
          interval: '1m',
          concurrency: env.AGENT_FEATURE_CONCURRENCY
        })

        const priceBySymbol: Record<string, PriceFeature> = {}
        for (const symbol of validFixed) {
          const feature = pricePack.bySymbol[symbol]
          if (feature) {
            priceBySymbol[symbol] = feature
          }
        }

        let cgMarketsFixed: Record<string, CoinGeckoMarketSnapshot> = {}
        let cgCoinCategoriesFixed: Record<string, string[]> = {}
        let cgSectorTopLosersFixed: Array<{ name: string; marketCapChange24hPct: number | null }> = []
        let cgSectorTopGainersFixed: Array<{ name: string; marketCapChange24hPct: number | null }> = []
        let cgCoveragePctFixed = 0

        if (coinGecko) {
          try {
            const concurrency = Math.min(env.AGENT_FEATURE_CONCURRENCY, 4)
            const resolved = await mapWithConcurrency(validFixed, concurrency, async (symbol) => {
              const id = await coinGecko.getCoinIdForSymbol(symbol)
              return { symbol, id }
            })

            const cgIdsBySymbolFixed: Record<string, string> = {}
            for (const entry of resolved) {
              if (entry?.id) cgIdsBySymbolFixed[entry.symbol] = entry.id
            }

            const ids = [...new Set(Object.values(cgIdsBySymbolFixed))]
            const markets = await coinGecko.fetchMarkets(ids)
            const marketById = new Map<string, CoinGeckoMarketSnapshot>()
            for (const market of markets) marketById.set(market.id, market)
            for (const [symbol, id] of Object.entries(cgIdsBySymbolFixed)) {
              const market = marketById.get(id)
              if (market) cgMarketsFixed[symbol] = market
            }

            cgCoveragePctFixed = validFixed.length > 0 ? (Object.keys(cgMarketsFixed).length / validFixed.length) * 100 : 0

            try {
              const categories = await coinGecko.fetchCategories()
              const withChange = categories.filter(
                (c) => typeof c.marketCapChange24hPct === 'number' && Number.isFinite(c.marketCapChange24hPct)
              )
              withChange.sort((a, b) => (a.marketCapChange24hPct ?? 0) - (b.marketCapChange24hPct ?? 0))
              cgSectorTopLosersFixed = withChange.slice(0, 5).map((c) => ({ name: c.name, marketCapChange24hPct: c.marketCapChange24hPct }))
              cgSectorTopGainersFixed = withChange.slice(Math.max(0, withChange.length - 5)).reverse().map((c) => ({ name: c.name, marketCapChange24hPct: c.marketCapChange24hPct }))
            } catch {
              // optional sector data
            }

            const catRows = await mapWithConcurrency(
              validFixed.map((s) => ({ symbol: s, id: cgIdsBySymbolFixed[s] })).filter((t): t is { symbol: string; id: string } => Boolean(t.id)),
              Math.min(validFixed.length, 3),
              async (task) => ({ symbol: task.symbol, categories: await coinGecko.fetchCoinCategories(task.id) })
            )
            for (const row of catRows) {
              if (row.categories.length > 0) cgCoinCategoriesFixed[row.symbol] = row.categories
            }
          } catch {
            cgMarketsFixed = {}
            cgCoinCategoriesFixed = {}
            cgCoveragePctFixed = 0
          }
        }

        activeBasket = {
          symbols: validFixed,
          rationale: `Fixed basket override: ${validFixed.join(', ')}`,
          selectedAt: new Date().toISOString(),
          context: {
            featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
            priceBase: pricePack.base,
            priceBySymbol,
            coingecko: coinGecko
              ? {
                marketsBySymbol: cgMarketsFixed,
                coinCategoriesBySymbol: cgCoinCategoriesFixed,
                sectorTopLosers: cgSectorTopLosersFixed,
                sectorTopGainers: cgSectorTopGainersFixed,
                coveragePct: Number(cgCoveragePctFixed.toFixed(1))
              }
              : undefined
          }
        }
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'INFO',
          line: `basket: using fixed symbols [${validFixed.join(', ')}] from BASKET_SYMBOLS config (${Object.keys(priceBySymbol).length} price features loaded)`
        })
        basketSelectInFlight = false
        return
      }
      // If none of the fixed symbols are valid on HL, fall through to dynamic selection
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `basket: BASKET_SYMBOLS [${fixedBasketSymbols.join(', ')}] not found in HL universe, falling back to dynamic selection`
      })
    }

    const perSymbolLiquidityBudgetUsd = Number((params.targetNotionalUsd / Math.max(1, env.AGENT_UNIVERSE_SIZE)).toFixed(2))
    const candidates = buildBasketCandidates({
      assets: universe,
      perSymbolLiquidityBudgetUsd,
      universeSize: env.AGENT_UNIVERSE_SIZE
    })
    const candidateSymbols = candidates.map((candidate) => candidate.symbol)
    const baseSymbol = candidateSymbols[0] ?? 'BTC'
    const pricePack = await computePriceFeaturePack({
      postInfo: hlClient.postInfo,
      baseSymbol,
      symbols: candidateSymbols,
      windowMin: env.AGENT_FEATURE_WINDOW_MIN,
      interval: '1m',
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
      },
      compositeSignals: lastCompositeSignals ? {
        volumeSurgeSymbols: Object.entries(lastCompositeSignals.volumeSurges)
          .filter(([, v]) => v.isSurge)
          .map(([sym]) => sym),
        oiExpandingSymbols: Object.entries(lastCompositeSignals.oiVelocity)
          .filter(([, v]) => v.velocity === 'EXPANDING')
          .map(([sym]) => sym),
        btcMacro: lastCompositeSignals.btcMacro,
      } : null,
    }

    const basketConfig = llmConfigForRole('strategist', nowMs)

    let chosen: { basketSymbols: string[]; rationale: string } | null = null
    try {
      chosen = await generateBasketSelection({
        llm: basketConfig.provider,
        model: basketConfig.model,
        reasoningEffort: basketConfig.reasoningEffort,
        input,
        timeoutMs: basketConfig.timeoutMs
      })
    } catch (primaryError) {
      if (basketConfig.provider === 'codex') {
        const canUseClaude = await isClaudeAvailable()
        if (canUseClaude) {
          try {
            chosen = await generateBasketSelection({
              llm: 'claude',
              model: basketConfig.claudeFallbackModel,
              input,
              timeoutMs: basketConfig.timeoutMs
            })
            const disabled = maybeDisableCodexFromError(primaryError, nowMs)
            const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `basket codex failed; using claude ${basketConfig.claudeFallbackModel}: ${summarizeCodexError(primaryError)}${untilNote}`
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
        const canUseCodexLlm = await isCodexAvailable()
        if (canUseCodexLlm) {
          try {
            chosen = await generateBasketSelection({
              llm: 'codex',
              model: env.CODEX_MODEL,
              input,
              timeoutMs: basketConfig.timeoutMs
            })
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `basket claude failed; using codex ${env.CODEX_MODEL}: ${String(primaryError).slice(0, 120)}`
            })
          } catch (fallbackError) {
            const disabled = maybeDisableCodexFromError(fallbackError, nowMs)
            const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `basket claude+codex fallback failed: ${summarizeCodexError(fallbackError)}${untilNote}`
            })
            return
          }
        } else {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: 'basket selection failed: claude and codex unavailable; skipping basket refresh'
          })
          return
        }
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
  markPrices?: Record<string, number>
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
  const metaBySymbol = new Map<string, { stopLossPrice?: number; takeProfitPrice?: number; thesisNote?: string }>()
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
    if (!metaBySymbol.has(symbol)) {
      const rawLeg = leg as { stopLossPrice?: unknown; takeProfitPrice?: unknown; thesisNote?: unknown }
      let slPrice = typeof rawLeg.stopLossPrice === 'number' && Number.isFinite(rawLeg.stopLossPrice) && rawLeg.stopLossPrice > 0 ? rawLeg.stopLossPrice : undefined
      let tpPrice = typeof rawLeg.takeProfitPrice === 'number' && Number.isFinite(rawLeg.takeProfitPrice) && rawLeg.takeProfitPrice > 0 ? rawLeg.takeProfitPrice : undefined

      // Validate TP/SL direction against mark price — reject inverted levels
      const markPx = params.markPrices?.[symbol]
      if (markPx && markPx > 0) {
        if (side === 'LONG') {
          if (slPrice != null && slPrice >= markPx) {
            console.warn(`[agent-runner] rejecting inverted SL for LONG ${symbol}: SL $${slPrice} >= mark $${markPx}`)
            slPrice = undefined
          }
          if (tpPrice != null && tpPrice <= markPx) {
            console.warn(`[agent-runner] rejecting inverted TP for LONG ${symbol}: TP $${tpPrice} <= mark $${markPx}`)
            tpPrice = undefined
          }
        } else {
          if (slPrice != null && slPrice <= markPx) {
            console.warn(`[agent-runner] rejecting inverted SL for SHORT ${symbol}: SL $${slPrice} <= mark $${markPx}`)
            slPrice = undefined
          }
          if (tpPrice != null && tpPrice >= markPx) {
            console.warn(`[agent-runner] rejecting inverted TP for SHORT ${symbol}: TP $${tpPrice} >= mark $${markPx}`)
            tpPrice = undefined
          }
        }
      }

      metaBySymbol.set(symbol, {
        stopLossPrice: slPrice,
        takeProfitPrice: tpPrice,
        thesisNote: typeof rawLeg.thesisNote === 'string' ? rawLeg.thesisNote.slice(0, 500) : undefined
      })
    }
  }

  if (bySymbol.size === 0) {
    return null
  }

  let normalizedLegs: DiscretionaryLeg[] = [...bySymbol.entries()]
    .map(([symbol, signedNotionalUsd]) => {
      const meta = metaBySymbol.get(symbol)
      return {
        symbol,
        side: signedNotionalUsd >= 0 ? ('LONG' as const) : ('SHORT' as const),
        notionalUsd: Math.abs(signedNotionalUsd),
        ...(meta?.stopLossPrice != null ? { stopLossPrice: meta.stopLossPrice } : {}),
        ...(meta?.takeProfitPrice != null ? { takeProfitPrice: meta.takeProfitPrice } : {}),
        ...(meta?.thesisNote ? { thesisNote: meta.thesisNote } : {})
      }
    })
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

  // Enforce 50% sizing: each leg notionalUsd = 0.5 * accountValueUsd
  const accountValueUsd = Number((lastStateUpdate as { accountValueUsd?: unknown } | null)?.accountValueUsd)
  const halfAccountUsd = Number.isFinite(accountValueUsd) && accountValueUsd > 0
    ? normalizeProposalNotional(accountValueUsd * 0.5)
    : 0

  const planLegBySymbol = new Map<string, DiscretionaryLeg>()
  for (const leg of params.plan.legs) {
    planLegBySymbol.set(String(leg.symbol).trim().toUpperCase(), leg)
  }

  // Validate SL/TP on every ENTER leg — reject proposal if missing
  for (const leg of params.plan.legs) {
    if (leg.stopLossPrice == null || leg.takeProfitPrice == null) {
      console.warn(`[agent-runner] rejecting proposal: ENTER leg ${leg.symbol} missing SL/TP`)
      return null
    }
  }

  const minLegUsd = Math.max(0, env.AGENT_MIN_REBALANCE_LEG_USD)
  const legs = params.plan.legs
    .map((leg) => {
      const symbol = String(leg.symbol).trim().toUpperCase()
      if (!symbol) return null
      const side: 'BUY' | 'SELL' = leg.side === 'LONG' ? 'BUY' : 'SELL'
      const notionalUsd = halfAccountUsd > 0 ? halfAccountUsd : normalizeProposalNotional(leg.notionalUsd)
      if (!Number.isFinite(notionalUsd) || notionalUsd < minLegUsd) return null
      return {
        symbol,
        side,
        notionalUsd,
        ...(leg.stopLossPrice != null ? { stopLossPrice: leg.stopLossPrice } : {}),
        ...(leg.takeProfitPrice != null ? { takeProfitPrice: leg.takeProfitPrice } : {}),
        ...(leg.thesisNote ? { thesisNote: leg.thesisNote } : {})
      }
    })
    .filter((leg): leg is NonNullable<typeof leg> => Boolean(leg))

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
  const actionType: 'ENTER' = 'ENTER'
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
  exitReason?: 'DISCRETIONARY' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TIME_EXIT' | 'INVALIDATION' | 'RISK_OFF'
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
    exitReason: params.exitReason ?? 'DISCRETIONARY',
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
  reasoningEffort?: ReasoningEffort
  input: Record<string, unknown>
  timeoutMs?: number
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
      role: 'scribe (devil\'s advocate)',
      mission: 'Challenge the current thesis. Your job is NOT to summarize what happened — the other agents already did that. Instead, identify what could go wrong that the strategist missed, flag hidden assumptions, and stress-test the rationale. Trades are fire-and-forget with SL/TP on exchange — focus on whether the levels are well-placed.',
      rules: [
        'Focus on what the strategist and research agent DIDN\'T consider or underweighted.',
        'Identify the single biggest risk to the current position or directive that isn\'t already in the risk report.',
        'If the thesis relies on momentum continuing, flag the reversal scenario. If it relies on mean reversion, flag the breakout scenario.',
        'Headline should be the contrarian take — what the bear case is if we\'re long, or the bull case if we\'re short.',
        'Keep output tight and concrete. Each risk item should be specific, observable, and actionable.',
        'Confidence reflects how vulnerable the current thesis is to the risks you identify (low = thesis is fragile, high = thesis is robust despite risks).',
        'Pipeline runs hourly. Each trade is independent with exchange-side SL/TP — no trailing stops or runtime exit management.',
        'Do not include raw order tickets, signatures, or venue credentials.'
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
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
      })
      : await runCodexStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
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
  reasoningEffort?: ReasoningEffort
  input: Record<string, unknown>
  timeoutMs?: number
}): Promise<ResearchReportResult> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      regime: { type: 'string', enum: ['RISK_ON', 'RISK_OFF', 'TRENDING', 'MEAN_REVERTING', 'VOLATILE', 'CALM', 'TRANSITIONING'] },
      recommendation: { type: 'string' },
      confidence: { type: 'number' },
      suggestedTwitterQueries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 8 Twitter/X search queries to run next cycle. Use Twitter v2 search operators: OR, AND, -is:retweet, lang:en, $cashtag. Focus on narratives, catalysts, liquidation events, or sentiment shifts relevant to current regime and watchlist.'
      }
    },
    required: ['headline', 'regime', 'recommendation', 'confidence', 'suggestedTwitterQueries']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Research pulse',
      regime: 'unknown — llm disabled',
      recommendation: 'no recommendation available — llm disabled',
      confidence: 0.35,
      suggestedTwitterQueries: []
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'research-agent',
      mission: 'Classify current market regime, identify the best NEW entry opportunity across the universe, and return one actionable recommendation. Do not manage existing positions — they have SL/TP on exchange.',
      rules: [
      'Use only context and observed signals; do not speculate on external events.',
      'Your job is to research NEW trade opportunities. Do NOT recommend actions on existing positions (no EXIT, HOLD, or position management). SL/TP are on the exchange — existing positions manage themselves. Focus entirely on identifying the single best NEW entry.',
      'If all current positions overlap with your best opportunity, find the next-best opportunity in a DIFFERENT asset.',
      'Output one actionable recommendation — name the specific asset(s) and direction. Not a portfolio plan, not a vague "monitor" statement.',
      'REGIME must be one of: RISK_ON (broad strength, expanding breadth), RISK_OFF (broad weakness, contracting breadth), TRENDING (directional momentum in majors), MEAN_REVERTING (range-bound, fading moves), VOLATILE (elevated vol, wide ranges), CALM (low vol, compressed ranges), TRANSITIONING (regime shifting, signals mixed). Pick the single best fit.',
      'Synthesize all available context holistically. Confidence reflects the overall quality and coherence of the thesis, not how many data sources agree.',
      'Degraded or missing data sources reduce certainty but do not change regime classification. Classify from what you have.',
      'When historical context shows regime persistence across cycles, factor that into your assessment.',
      'Scan the full universe — the best opportunity may be in any asset, not just the largest.',
      'Your recommendation MUST name only symbols from universeSymbols. Never recommend a symbol not listed there — it cannot be traded.',
      'Pipeline runs hourly. Each trade is independent with SL/TP on exchange at entry. Focus on setups that work on hourly+ timeframes.',
      'BTC macro context is provided as compositeSignals.btcMacro with 4h/1h trend classifications and an altLongModifier. Factor this into regime classification and alt-specific recommendations.',
      'Volume surges (2x+ vs 20-bar avg) and OI expansion/contraction are provided in compositeSignals. Use these as confirmation signals for narrative strength or weakness.',
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
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
      })
      : await runCodexStructured<ResearchReportResult>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
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
  reasoningEffort?: ReasoningEffort
  input: Record<string, unknown>
  timeoutMs?: number
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
          maxDrawdownPct: { type: 'number', minimum: 0.01, maximum: 100 },
          maxLeverage: { type: 'number', minimum: 0.1, maximum: 10 },
          maxExposureUsd: { type: 'number', minimum: 25, maximum: 50000 },
          maxSlippageBps: { type: 'number', minimum: 0, maximum: 100 }
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
        'POSTURE DEFINITIONS:',
        '  GREEN = normal tradeable state.',
        '  AMBER = elevated but tradeable. Reduce sizing, not frequency.',
        '  RED = infrastructure failure only. Reserved for: exchange API outages, price feed failures, active liquidation cascades with halted orderbooks. Macro sentiment (fear & greed, bearish narratives, drawdowns) is NEVER grounds for RED — use AMBER with tighter policy instead.',
        'Tie each risk item to specific observable context. Posture should reflect CURRENT conditions, not residual concern from resolved issues.',
        'HEADLINE SAFETY: Your headline is parsed for trigger words. The following words cause a hard trading block if they appear: HOLD FLAT, FLATTEN, BLOCK, BLOCKED, CLEAN, CONSERVATIVE. Never use these words in your headline unless you intend to halt ALL trading. Express caution through posture (AMBER) and policyRecommendations, not headline language.',
        'Do not output execution mechanics.',
        'POLICY MANAGEMENT: You control the live risk policy parameters. The current policy is included in context under "currentRiskPolicy".',
        'Set policyRecommendations to an object with any parameters you want to change, or null to keep current policy.',
        'LEVERAGE: Hard cap is 10x. Keep some headroom below the hard max to avoid reject churn from rounding and price moves. How much headroom depends on current volatility and conditions — use your judgment.',
        'DRAWDOWN POLICY: maxDrawdownPct is set to 100 (effectively unlimited). The operator accepts full drawdown risk — do not change maxDrawdownPct.',
        'SESSION PNL: pnlPct is cumulative session realized P&L, not current position risk. When flat, it is historical context only.',
        'Only recommend policy changes with clear justification tied to observable market conditions.',
        'Assess all data sources based on their current relevance. The importance of any source depends on the regime.',
        'BTC MACRO: If compositeSignals.btcMacro shows btcTrend4h=DOWN and btcTrend1h=DOWN, this is a macro headwind for alt longs. Factor into AMBER decision and consider recommending reduced maxLeverage.',
        'VOLUME SURGE CLUSTER: Multiple simultaneous volume surges (volumeSurgeCount) may indicate a macro event. Note this in your risk assessment.',
        'OI CONTRACTION: Widespread OI contraction (oiContractingCount) signals declining participation and liquidity risk.'
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
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
      })
      : await runCodexStructured<RiskReportResult>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs
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
  reasoningEffort?: ReasoningEffort
  input: Record<string, unknown>
  markPrices?: Record<string, number>
  timeoutMs?: number
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
            notionalUsd: { type: 'number' },
            stopLossPrice: { type: 'number' },
            takeProfitPrice: { type: 'number' },
            thesisNote: { type: 'string' }
          },
          required: ['symbol', 'side', 'notionalUsd', 'stopLossPrice', 'takeProfitPrice', 'thesisNote']
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
      decision: { type: 'string', enum: ['OPEN', 'EXIT', 'HOLD'] },
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
	      mission: 'Synthesize all available context and choose the best execution directive. Any structure (directional, paired, multi-leg) is valid when the thesis supports it.',
	      rules: [
	        'Allowed decisions: OPEN, EXIT, HOLD only.',
	        'OPEN: establish a new position. Any structure — the data decides. Every OPEN leg MUST include stopLossPrice and takeProfitPrice. Trades are fire-and-forget: SL/TP placed on the exchange at entry, no runtime exit management.',
        'HOLD: keep current exposure. Valid when conviction is genuinely low across available data.',
        'EXIT: close ALL positions to flat immediately. Use for portfolio-wide risk-off.',
        'SIZING: Each trade leg notionalUsd = 50% of accountValueUsd. This is a hard rule.',
        'LEVERAGE CAP: Total gross notional must not exceed 10x accountValueUsd.',
        'AMBER posture = consider reducing sizing, not stopping trading.',
        'If lastRiskDecision contains blocking DENY codes (DRAWDOWN, EXPOSURE, LEVERAGE, SAFE_MODE, STALE_DATA, LIQUIDITY), avoid discretionary churn — the runtime handles risk recovery.',
        'For each OPEN leg, specify stopLossPrice and takeProfitPrice as absolute price levels. For LONG: SL below markPrice, TP above. For SHORT: SL above, TP below. Inverted levels are rejected. Legs without SL/TP will be rejected.',
        'thesisNote per leg: explain the setup and what would invalidate it (max 500 chars).',
        'Do not oversize to recover losses. pnlPct is historical — each trade stands on its own merit.',
        'Scan the full universe. The best opportunity may be anywhere.',
        'ALL plan legs MUST use symbols from activeUniverse.symbols — off-basket legs are dropped.',
        'HOURLY TREND GATE (HARD RULE): For LONG entries, compositeSignals.hourlyTrends[symbol].classification must NOT be DOWN. For SHORT entries, it must NOT be UP. Counter-trend entries are rejected. If no symbols pass the hourly trend gate, decision is HOLD.',
        'BTC MACRO MODIFIER: compositeSignals.btcMacro.altLongModifier adjusts conviction for alt entries. Negative modifier = headwind for longs. Factor this into sizing and symbol selection.',
        'PILLAR SCORES: compositeSignals.pillarScores[symbol] provides marketStructure (0-100), technicals (0-100), funding (0-100), and composite (0-300). Use as a ranking aid — higher composite = stronger setup. Do not trade symbols with composite < 100.',
        'CONCENTRATION: Prefer 2-4 high-conviction legs over many mediocre ones. An empty slot is better than a low-conviction trade.',
        'MIN LEVERAGE GATE: Skip symbols where maxLeverage < 7x — insufficient room for fire-and-forget SL/TP to work.',
        'DEAD WEIGHT: Symbols with no volume surge, stable OI, neutral hourly trend, and middling pillar scores have zero edge. Do not trade dead-weight symbols.',
        'FEE AWARENESS: Hyperliquid taker fee is 0.035%. Round-trip cost is 0.07% of notional. TP targets must exceed this floor for positive expectancy.',
        'FUNDING REGIME: compositeSignals.fundingRegimes[symbol] shows which side current funding favors. Extreme unfavorable funding (annualized > 50%) is a cost headwind — factor into SL/TP placement.',
        'OI VELOCITY: compositeSignals.oiVelocity[symbol] shows EXPANDING/CONTRACTING/STABLE. Prefer EXPANDING (growing participation) over CONTRACTING (declining interest).',
        'All context (technicals, compositeSignals, funding, OI, aixbt, narrative, tradeHistory, convictionBoard, portfolioCorrelation) is available for holistic synthesis. No single input is more important than another — weight them based on current conditions.',
        'riskBudget values must be null or positive numbers.',
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
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs ?? env.AGENT_LLM_TIMEOUT_MS
      })
      : await runCodexStructured<{ decision: StrategistDirectiveDecision; plan?: DirectivePlan; rationale: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: params.reasoningEffort ?? env.CODEX_REASONING_EFFORT,
        timeoutMs: params.timeoutMs ?? env.AGENT_LLM_TIMEOUT_MS
      })

  const decision: StrategistDirectiveDecision =
    raw.decision === 'EXIT' || raw.decision === 'OPEN' || raw.decision === 'HOLD'
      ? raw.decision
      : 'HOLD'

  let plan: DirectivePlan | null = null
  if (raw.plan && decision === 'OPEN') {
    plan = normalizeDirectivePlan({
      plan: raw.plan as DirectivePlan | null,
      fallbackTargetNotionalUsd: computeMaxBudgetUsd(),
      markPrices: params.markPrices
    })
  }
  if (decision === 'OPEN' && plan === null) {
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
let lastDirectiveAt = 0

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
	      liquidityBufferPct: env.RISK_LIQUIDITY_BUFFER_PCT
	    }
	  }
let lastResearchReport: (ResearchReportResult & { computedAt: string }) | null = null
let lastRiskReport: (RiskReportResult & { computedAt: string }) | null = null
let lastScribeAnalysis: { headline: string; thesis: string; risks: string[]; confidence: number; computedAt: string } | null = null
let lastExternalIntel: ExternalIntelPack | null = null
let cachedTwitterIntel: { data: ExternalIntelPack['twitter']; fetchedAtMs: number } | undefined
let agentSuggestedTwitterQueries: string[] = []
let lastRiskDecisionAuditSignature = ''
let lastRiskDecisionAuditAtMs = 0

const HISTORY_DIR = path.join(JOURNAL_PATH, 'history')
const researchHistory = new HistoryStore<ResearchHistoryEntry>(HISTORY_DIR, 'research.ndjson')
const riskHistory = new HistoryStore<RiskHistoryEntry>(HISTORY_DIR, 'risk.ndjson')
const directiveHistory = new HistoryStore<DirectiveHistoryEntry>(HISTORY_DIR, 'directive.ndjson')
const intelHistory = new HistoryStore<IntelHistoryEntry>(HISTORY_DIR, 'intel.ndjson', env.AGENT_INTEL_HISTORY_MAX_ENTRIES)
const tradeJournal = new TradeJournal(HISTORY_DIR, 50)
const convictionBoard = new ConvictionBoard(HISTORY_DIR)
let lastTechnicalSignals: TechnicalSignalPack | null = null
let lastTechnicalSignalsAt = 0
let lastCompositeSignals: CompositeSignalPack | null = null
let lastCompositeSignalsAt = 0
let previousOiBySymbol: Record<string, number> = {}

async function publishAudit(event: AuditEvent): Promise<void> {
  queueJournalWrite(event)
  recordDiscordRunSummaryEvent(event)

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

function computePortfolioBtcBeta(positions: OperatorPosition[]): Record<string, unknown> | null {
  if (positions.length === 0) return null
  const context = activeBasket.context as { priceBySymbol?: Record<string, PriceFeature> } | undefined
  if (!context?.priceBySymbol) return null

  let weightedBeta = 0
  let totalNotional = 0
  const perSymbol: Array<{ symbol: string; betaToBtc: number | null; weight: number }> = []

  for (const pos of positions) {
    const feature = context.priceBySymbol[pos.symbol]
    const beta = feature?.betaToBase ?? null
    const notional = Math.abs(pos.notionalUsd)
    const direction = pos.side === 'LONG' ? 1 : -1

    if (beta != null && Number.isFinite(beta)) {
      weightedBeta += beta * notional * direction
      totalNotional += notional
    }
    perSymbol.push({ symbol: pos.symbol, betaToBtc: beta, weight: notional })
  }

  const portfolioBeta = totalNotional > 0 ? weightedBeta / totalNotional : 0

  return {
    portfolioBetaToBtc: Number(portfolioBeta.toFixed(3)),
    warning: null,
    perSymbol
  }
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

function formatIdleAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

const BULLISH_SENTIMENT_TERMS = [
  'bullish', 'breakout', 'uptrend', 'long', 'buy', 'accumulate', 'squeeze', 'bid', 'strength', 'outperform', 'expansion'
]
const BEARISH_SENTIMENT_TERMS = [
  'bearish', 'breakdown', 'downtrend', 'short', 'sell', 'de-risk', 'deleveraging', 'liquidation', 'risk-off', 'exploit', 'outage'
]

type IntelTrendMetrics = {
  tweetCount: number
  twitterQueryCount: number
  twitterErrorCount: number
  twitterTopLikeCount: number
  twitterScore: number | null
  symbolSentiment: Array<{ symbol: string; score: number | null; mentions: number }>
  aixbtSignalCount: number
  aixbtBasketSignalCount: number
  aixbtMomentumRisingCount: number
  aixbtMomentumFallingCount: number
  aixbtScore: number | null
  sentimentScore: number | null
}

function scoreSentimentText(text: string): number {
  const normalized = text.toLowerCase()
  let score = 0
  for (const term of BULLISH_SENTIMENT_TERMS) {
    if (normalized.includes(term)) score += 1
  }
  for (const term of BEARISH_SENTIMENT_TERMS) {
    if (normalized.includes(term)) score -= 1
  }
  if (score === 0) return 0
  return score > 0 ? 1 : -1
}

function queryMentionsSymbol(query: string, symbol: string): boolean {
  const lowerQuery = query.toLowerCase()
  const lowerSymbol = symbol.toLowerCase()
  return lowerQuery.includes(`$${lowerSymbol}`) || lowerQuery.includes(lowerSymbol)
}

function tweetMentionsSymbol(text: string, symbol: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerSymbol = symbol.toLowerCase()
  return lowerText.includes(`$${lowerSymbol}`) || lowerText.includes(` ${lowerSymbol} `) || lowerText.startsWith(`${lowerSymbol} `)
}

function computeIntelTrendMetrics(pack: ExternalIntelPack): IntelTrendMetrics {
  const symbolScores = new Map<string, { weighted: number; totalWeight: number; mentions: number }>()
  for (const symbol of pack.symbols) {
    symbolScores.set(symbol, { weighted: 0, totalWeight: 0, mentions: 0 })
  }

  let tweetCount = 0
  let twitterErrorCount = 0
  let twitterTopLikeCount = 0
  let twitterWeighted = 0
  let twitterWeightTotal = 0

  for (const query of pack.twitter.queries) {
    if (query.error) twitterErrorCount += 1
    const querySymbols = pack.symbols.filter((symbol) => queryMentionsSymbol(query.query, symbol))

    for (const tweet of query.tweets) {
      tweetCount += 1
      const likes = Math.max(0, tweet.metrics.likeCount ?? 0)
      const retweets = Math.max(0, tweet.metrics.retweetCount ?? 0)
      const replies = Math.max(0, tweet.metrics.replyCount ?? 0)
      const quotes = Math.max(0, tweet.metrics.quoteCount ?? 0)
      twitterTopLikeCount = Math.max(twitterTopLikeCount, likes)

      const sentiment = scoreSentimentText(tweet.text)
      const engagement = likes + retweets * 2 + replies + quotes * 2
      const weight = 1 + Math.log1p(Math.max(0, engagement))

      if (sentiment !== 0) {
        twitterWeighted += sentiment * weight
        twitterWeightTotal += weight
      }

      const mentionedSymbols = querySymbols.length > 0
        ? querySymbols
        : pack.symbols.filter((symbol) => tweetMentionsSymbol(tweet.text, symbol))
      for (const symbol of mentionedSymbols) {
        const bucket = symbolScores.get(symbol)
        if (!bucket) continue
        bucket.mentions += 1
        if (sentiment !== 0) {
          bucket.weighted += sentiment * weight
          bucket.totalWeight += weight
        }
      }
    }
  }

  const twitterScore = twitterWeightTotal > 0
    ? clamp(Math.round((twitterWeighted / twitterWeightTotal) * 100), -100, 100)
    : null

  const aixbtPack = pack.aixbt.pack
  const aixbtSignalCount = aixbtPack ? aixbtPack.signals.length : 0
  const aixbtBasketSignalCount = aixbtPack ? aixbtPack.basketSignals.length : 0
  const aixbtMomentumRisingCount = aixbtPack ? aixbtPack.momentumHistory.filter((p) => p.trend === 'rising').length : 0
  const aixbtMomentumFallingCount = aixbtPack ? aixbtPack.momentumHistory.filter((p) => p.trend === 'falling').length : 0

  let aixbtWeighted = 0
  let aixbtWeightTotal = 0
  if (aixbtPack) {
    for (const signal of [...aixbtPack.basketSignals, ...aixbtPack.signals]) {
      const category = signal.category.toUpperCase()
      if (category.includes('RISK_ALERT') || category.includes('REGULATORY')) {
        aixbtWeighted -= 1
        aixbtWeightTotal += 1
      } else if (category.includes('PARTNERSHIP') || category.includes('TECH_EVENT') || category.includes('FINANCIAL_EVENT')) {
        aixbtWeighted += 1
        aixbtWeightTotal += 1
      } else {
        const textScore = scoreSentimentText(`${signal.category} ${signal.description}`)
        if (textScore !== 0) {
          aixbtWeighted += textScore
          aixbtWeightTotal += 1
        }
      }
    }
  }

  const momentumTotal = aixbtMomentumRisingCount + aixbtMomentumFallingCount
  const momentumBias = momentumTotal > 0 ? (aixbtMomentumRisingCount - aixbtMomentumFallingCount) / momentumTotal : 0
  const aixbtBaseScore = aixbtWeightTotal > 0 ? aixbtWeighted / aixbtWeightTotal : 0
  const aixbtHasSignal = aixbtWeightTotal > 0 || momentumTotal > 0
  const aixbtScore = aixbtHasSignal
    ? clamp(Math.round((aixbtBaseScore * 0.7 + momentumBias * 0.3) * 100), -100, 100)
    : null

  const sentimentScore = twitterScore === null && aixbtScore === null
    ? null
    : twitterScore === null
      ? aixbtScore
      : aixbtScore === null
        ? twitterScore
        : clamp(Math.round(twitterScore * 0.65 + aixbtScore * 0.35), -100, 100)

  const symbolSentiment = pack.symbols.map((symbol) => {
    const bucket = symbolScores.get(symbol) ?? { weighted: 0, totalWeight: 0, mentions: 0 }
    const score = bucket.totalWeight > 0
      ? clamp(Math.round((bucket.weighted / bucket.totalWeight) * 100), -100, 100)
      : null
    return { symbol, score, mentions: bucket.mentions }
  })

  return {
    tweetCount,
    twitterQueryCount: pack.twitter.queries.length,
    twitterErrorCount,
    twitterTopLikeCount,
    twitterScore,
    symbolSentiment,
    aixbtSignalCount,
    aixbtBasketSignalCount,
    aixbtMomentumRisingCount,
    aixbtMomentumFallingCount,
    aixbtScore,
    sentimentScore
  }
}

function shouldRefreshExternalIntel(nowMs: number, currentSymbols: string[]): boolean {
  if (!lastExternalIntel) return true
  if (env.AGENT_INTEL_MIN_REFRESH_MS <= 0) return true
  const lastComputedAtMs = safeDateMs(lastExternalIntel.computedAt)
  if (lastComputedAtMs === null) return true
  const symbolKey = currentSymbols.map((symbol) => sanitizeLine(String(symbol).toUpperCase(), 24)).filter(Boolean).join(',')
  const previousSymbolKey = lastExternalIntel.symbols.join(',')
  if (symbolKey !== previousSymbolKey) return true
  return nowMs - lastComputedAtMs >= env.AGENT_INTEL_MIN_REFRESH_MS
}

async function runStrategyPipeline(): Promise<void> {
  const now = Date.now()
  const cycleId = ulid()
  const pipelineStartedAt = now
  const runSummaryState = startDiscordRunSummary({
    cycleId,
    startedAtMs: pipelineStartedAt,
    modeStart: lastMode,
    symbolCountStart: activeBasket.symbols.length,
    recommendationStart: String(lastResearchReport?.recommendation ?? 'none')
  })
  activeDiscordRunSummary = runSummaryState
  let pipelineOutcome = 'completed'
  let pipelineNote = ''

  try {
    await publishTape({
      correlationId: cycleId,
      role: 'ops',
      level: 'INFO',
      line: `pipeline: start mode=${lastMode} symbols=${activeBasket.symbols.length} recommendation=${lastResearchReport?.recommendation ?? 'none'}`
    })

    // Universe must be populated BEFORE research so the research agent has symbols to analyze.
    const nowMs = Date.now()
    const hasFreshUniverse =
      activeBasket.symbols.length >= 1 && nowMs - Date.parse(activeBasket.selectedAt) <= env.AGENT_UNIVERSE_REFRESH_MS
    if (!hasFreshUniverse && lastMode !== 'HALT') {
      const maxBudgetUsd = computeMaxBudgetUsd()
      const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      await maybeSelectBasket({ targetNotionalUsd: maxBudgetUsd, signals, positions: lastPositions, force: activeBasket.symbols.length === 0 })
    }

    const researchStartedAt = Date.now()
    const researchRefreshed = await runResearchAgent()
    const researchElapsedMs = Date.now() - researchStartedAt
    await publishTape({
      correlationId: cycleId,
      role: 'ops',
      level: 'INFO',
      line: `pipeline: research completed in ${researchElapsedMs}ms output=${researchRefreshed ? 'new' : 'cached'}`
    })

    if (!researchRefreshed && !lastResearchReport) {
      pipelineOutcome = 'skipped'
      pipelineNote = 'research produced no output; risk+strategist skipped'
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: 'pipeline: research produced no output this cycle; skipping risk + strategist this cycle'
      })
      return
    }
    if (!researchRefreshed && lastResearchReport) {
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: 'pipeline: research produced no output this cycle; continuing with prior research report'
      })
    }

    // Compute technical signals (RSI, trend, ATR) — throttled to every 5 minutes
    const techSignalNow = Date.now()
    if (techSignalNow - lastTechnicalSignalsAt >= 5 * 60_000 && activeBasket.symbols.length > 0) {
      try {
        const fundingBySymbol: Record<string, number> = {}
        for (const asset of cachedUniverse.assets) {
          if (activeBasket.symbols.includes(asset.symbol)) {
            fundingBySymbol[asset.symbol] = asset.funding
          }
        }
        lastTechnicalSignals = await computeTechnicalSignals({
          symbols: activeBasket.symbols,
          postInfo: hlClient.postInfo,
          fundingBySymbol,
          concurrency: 4
        })
        lastTechnicalSignalsAt = techSignalNow
      } catch {
        // non-critical — continue without tech signals
      }
    }

    // Compute composite signals (hourly trend, BTC macro, volume surge, OI velocity, funding, pillar scores)
    const compositeNow = Date.now()
    if (compositeNow - lastCompositeSignalsAt >= 5 * 60_000 && activeBasket.symbols.length > 0) {
      try {
        const fundingBySymbol: Record<string, number> = {}
        const oiBySymbol: Record<string, number> = {}
        for (const asset of cachedUniverse.assets) {
          if (activeBasket.symbols.includes(asset.symbol)) {
            fundingBySymbol[asset.symbol] = asset.funding
            if (asset.openInterest > 0 && asset.markPx > 0) {
              oiBySymbol[asset.symbol] = asset.openInterest * asset.markPx
            }
          }
        }
        lastCompositeSignals = await computeCompositeSignals({
          symbols: activeBasket.symbols,
          postInfo: hlClient.postInfo,
          previousOiBySymbol,
          technicalSignals: lastTechnicalSignals,
          fundingBySymbol,
          oiBySymbol,
          concurrency: 4
        })
        // Update OI snapshot for next cycle's velocity calculation
        previousOiBySymbol = { ...oiBySymbol }
        lastCompositeSignalsAt = compositeNow
      } catch {
        // non-critical — continue without composite signals
      }
    }

    const riskStartedAt = Date.now()
    await runRiskAgent()
    await publishTape({
      correlationId: cycleId,
      role: 'risk',
      level: 'INFO',
      line: `pipeline: risk completed in ${Date.now() - riskStartedAt}ms`
    })

    const strategistStartedAt = Date.now()
    await runStrategistCycle()
    await publishTape({
      correlationId: cycleId,
      role: 'strategist',
      level: 'INFO',
      line: `pipeline: strategist completed in ${Date.now() - strategistStartedAt}ms`
    })

    if (lastProposal !== null && lastResearchAt > lastAnalysisAt) {
      lastAnalysisAt = Date.now()
      await runScribeAnalysis(lastProposal, { targetNotionalUsd: computeMaxBudgetUsd() })
    }

    await publishTape({
      correlationId: cycleId,
      role: 'ops',
      level: 'INFO',
      line: `pipeline: done duration=${Date.now() - pipelineStartedAt}ms`
    })
  } catch (error) {
    pipelineOutcome = 'error'
    pipelineNote = sanitizeLine(String(error), 200)
    throw error
  } finally {
    activeDiscordRunSummary = null
    await notifyDiscordRunSummary({
      state: runSummaryState,
      outcome: pipelineOutcome,
      durationMs: Date.now() - pipelineStartedAt,
      note: pipelineNote,
      modeEnd: lastMode,
      symbolCountEnd: activeBasket.symbols.length,
      recommendationEnd: String(lastResearchReport?.recommendation ?? 'none')
    })
  }
}

async function runResearchAgent(): Promise<boolean> {
  const now = Date.now()

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

  const intelSummary: Record<string, unknown> | null = null
  const intelTrendMetrics: IntelTrendMetrics | null = null

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
    inferredRegime: regime,
    compositeSignals: lastCompositeSignals ? {
      btcMacro: lastCompositeSignals.btcMacro,
      volumeSurges: Object.entries(lastCompositeSignals.volumeSurges)
        .filter(([, v]) => v.isSurge)
        .map(([sym, v]) => ({ symbol: sym, ratio: v.ratio })),
      oiExpanding: Object.entries(lastCompositeSignals.oiVelocity)
        .filter(([, v]) => v.velocity === 'EXPANDING')
        .map(([sym, v]) => ({ symbol: sym, deltaPct: v.deltaPct })),
      oiContracting: Object.entries(lastCompositeSignals.oiVelocity)
        .filter(([, v]) => v.velocity === 'CONTRACTING')
        .map(([sym, v]) => ({ symbol: sym, deltaPct: v.deltaPct })),
    } : null,
    historicalContext: {
      recentResearch: formatHistoryForPrompt('recent research cycles', researchHistory.recent(5), ['ts', 'headline', 'regime', 'recommendation', 'confidence']),
      recentIntel: formatHistoryForPrompt('recent intel availability', intelHistory.recent(5), [
        'ts',
        'twitterOk',
        'fearGreedValue',
        'symbolCount',
        'tweetCount',
        'sentimentScore',
        'twitterQueryCount',
        'twitterCacheState',
        'aixbtOk',
        'aixbtSignalCount'
      ])
    }
  }

  const researchConfig = llmConfigForRole('research', now)

  let report: ResearchReportResult | null = null
  try {
    report = await generateResearchReport({
      llm: researchConfig.provider,
      model: researchConfig.model,
      reasoningEffort: researchConfig.reasoningEffort,
      input,
      timeoutMs: researchConfig.timeoutMs
    })
  } catch (primaryError) {
    if (researchConfig.provider === 'codex') {
      const canUseClaude = await isClaudeAvailable()
      if (canUseClaude) {
        try {
          report = await generateResearchReport({
            llm: 'claude',
            model: researchConfig.claudeFallbackModel,
            input,
            timeoutMs: researchConfig.timeoutMs
          })
          const disabled = maybeDisableCodexFromError(primaryError, now)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `research codex failed; using claude ${researchConfig.claudeFallbackModel}: ${summarizeCodexError(primaryError)}${untilNote}`
          })
        } catch (fallbackError) {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `research codex+claude failed; skipping research refresh: ${String(fallbackError).slice(0, 120)}`
          })
          return false
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: 'research codex failed: codex and claude unavailable; skipping research refresh'
        })
        return false
      }
    } else {
      const canUseCodexLlm = await isCodexAvailable()
      if (canUseCodexLlm) {
        try {
          report = await generateResearchReport({
            llm: 'codex',
            model: env.CODEX_MODEL,
            input,
            timeoutMs: researchConfig.timeoutMs
          })
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `research claude failed; using codex ${env.CODEX_MODEL}: ${String(primaryError).slice(0, 120)}`
          })
        } catch (fallbackError) {
          const disabled = maybeDisableCodexFromError(fallbackError, now)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `research claude+codex failed; skipping research refresh: ${summarizeCodexError(fallbackError)}${untilNote}`
          })
          return false
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `research llm unavailable: claude and codex unavailable; skipping research refresh (claude error: ${String(primaryError).slice(0, 180)})`
        })
        return false
      }
    }
  }

  if (!report) {
    return false
  }

  if (report.suggestedTwitterQueries.length > 0) {
    agentSuggestedTwitterQueries = report.suggestedTwitterQueries
  }

  lastResearchReport = { ...report, computedAt: new Date().toISOString() }
  lastResearchAt = Date.parse(lastResearchReport.computedAt)

  await researchHistory.push({
    ts: lastResearchReport.computedAt,
    headline: report.headline,
    regime: report.regime,
    recommendation: report.recommendation,
    confidence: report.confidence
  }).catch(() => undefined)

  if (lastExternalIntel) {
    const metrics = intelTrendMetrics ?? computeIntelTrendMetrics(lastExternalIntel)
    await intelHistory.push({
      ts: new Date().toISOString(),
      twitterOk: lastExternalIntel.twitter.ok,
      fearGreedValue: lastExternalIntel.fearGreed.snapshot?.value ?? null,
      symbolCount: lastExternalIntel.symbols.length,
      tweetCount: metrics.tweetCount,
      twitterQueryCount: metrics.twitterQueryCount,
      twitterErrorCount: metrics.twitterErrorCount,
      twitterTopLikeCount: metrics.twitterTopLikeCount,
      twitterCacheState: lastExternalIntel.twitter.cacheState,
      aixbtOk: lastExternalIntel.aixbt.ok,
      aixbtSignalCount: metrics.aixbtSignalCount,
      aixbtBasketSignalCount: metrics.aixbtBasketSignalCount,
      aixbtMomentumRisingCount: metrics.aixbtMomentumRisingCount,
      aixbtMomentumFallingCount: metrics.aixbtMomentumFallingCount,
      sentimentScore: metrics.sentimentScore,
      symbolSentiment: metrics.symbolSentiment
    }).catch(() => undefined)
  }

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

  return true
}

async function runRiskAgent(): Promise<void> {
  const now = Date.now()

  const signalPack = summarizeLatestSignals(now)
  const latestVol = latestSignalFromPack(signalPack, 'volatility')

	  const currentRiskPolicy = resolveRiskLimitsForContext()
	  const input = {
	    ts: new Date().toISOString(),
	    mode: lastMode,
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
	    currentRiskPolicy,
	    lastResearchReport,
	    compositeSignals: lastCompositeSignals ? {
	      btcMacro: lastCompositeSignals.btcMacro,
	      volumeSurgeCount: Object.values(lastCompositeSignals.volumeSurges).filter(v => v.isSurge).length,
	      oiExpandingCount: Object.values(lastCompositeSignals.oiVelocity).filter(v => v.velocity === 'EXPANDING').length,
	      oiContractingCount: Object.values(lastCompositeSignals.oiVelocity).filter(v => v.velocity === 'CONTRACTING').length,
	    } : null,
	    historicalContext: {
      recentRisk: formatHistoryForPrompt('recent risk cycles', riskHistory.recent(5), ['ts', 'headline', 'posture', 'risks', 'confidence']),
      recentIntel: formatHistoryForPrompt('recent intel availability', intelHistory.recent(5), [
        'ts',
        'twitterOk',
        'fearGreedValue',
        'symbolCount',
        'tweetCount',
        'sentimentScore',
        'twitterQueryCount',
        'twitterCacheState',
        'aixbtOk',
        'aixbtSignalCount'
      ])
    }
  }

  const riskConfig = llmConfigForRole('risk', now)

  let report: RiskReportResult | null = null
  try {
    report = await generateRiskReport({
      llm: riskConfig.provider,
      model: riskConfig.model,
      reasoningEffort: riskConfig.reasoningEffort,
      input,
      timeoutMs: riskConfig.timeoutMs
    })
  } catch (primaryError) {
    if (riskConfig.provider === 'codex') {
      const canUseClaude = await isClaudeAvailable()
      if (canUseClaude) {
        try {
          report = await generateRiskReport({
            llm: 'claude',
            model: riskConfig.claudeFallbackModel,
            input,
            timeoutMs: riskConfig.timeoutMs
          })
          const disabled = maybeDisableCodexFromError(primaryError, now)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `risk codex failed; using claude ${riskConfig.claudeFallbackModel}: ${summarizeCodexError(primaryError)}${untilNote}`
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
      const canUseCodexLlm = await isCodexAvailable()
      if (canUseCodexLlm) {
        try {
          report = await generateRiskReport({
            llm: 'codex',
            model: env.CODEX_MODEL,
            input,
            timeoutMs: riskConfig.timeoutMs
          })
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `risk claude failed; using codex ${env.CODEX_MODEL}: ${String(primaryError).slice(0, 120)}`
          })
        } catch (fallbackError) {
          const disabled = maybeDisableCodexFromError(fallbackError, now)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `risk claude+codex failed; skipping risk refresh (claude: ${String(primaryError).slice(0, 120)}) (codex: ${summarizeCodexError(fallbackError)}${untilNote})`
          })
          return
        }
      } else {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk llm unavailable: claude and codex unavailable; skipping risk refresh (claude error: ${String(primaryError).slice(0, 180)})`
        })
        return
      }
    }
  }

  if (!report) {
    return
  }

  lastRiskReport = { ...report, computedAt: new Date().toISOString() }
  lastRiskAt = Date.parse(lastRiskReport.computedAt)

  await riskHistory.push({
    ts: lastRiskReport.computedAt,
    headline: report.headline,
    posture: report.posture,
    risks: report.risks,
    confidence: report.confidence
  }).catch(() => undefined)

  await publishTape({
    correlationId: ulid(),
    role: 'risk',
    line: `${report.headline}: ${report.posture}`
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
    if (directiveInFlightSinceMs > 0 && nowMs - directiveInFlightSinceMs > IN_FLIGHT_LOCK_TIMEOUT_MS) {
      console.warn('[agent-runner] directiveInFlight lock expired after timeout, resetting')
      directiveInFlight = false
    } else {
      return
    }
  }

  // SAFE_MODE is informational for the strategist — exchange TP/SL orders manage exits.
  // The LLM strategist already receives mode context and can decide to EXIT if appropriate.
  // We do NOT force-exit here because transient infra issues should not override exchange-side risk management.

  directiveInFlight = true
  directiveInFlightSinceMs = nowMs
  try {
    const heldSymbols = basketFromPositions(params.positions)
    const signalPack = summarizeLatestSignals(nowMs)
    const latestVol = latestSignalFromPack(signalPack, 'volatility')
    const latestCorr = latestSignalFromPack(signalPack, 'correlation')
    const latestFunding = latestSignalFromPack(signalPack, 'funding')

    const input = {
      ts: new Date().toISOString(),
      mode: lastMode,
      state: lastStateUpdate ?? null,
      postureHint: lastRiskReport?.posture ?? 'GREEN',
      buyingPowerUsd: params.targetNotionalUsd,
      minLegNotionalUsd: env.AGENT_MIN_REBALANCE_LEG_USD,
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
        notionalUsd: Number(position.notionalUsd.toFixed(2)),
        avgEntryPx: position.avgEntryPx,
        markPx: position.markPx,
        updatedAt: position.updatedAt
      })),
      markPrices: Object.fromEntries(
        cachedUniverse.assets
          .filter((a) => activeBasket.symbols.includes(a.symbol) && a.markPx > 0)
          .map((a) => [a.symbol, a.markPx])
      ),
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
	      currentDirective: activeDirective,
	      technicalSignals: lastTechnicalSignals ? Object.fromEntries(
	        Object.entries(lastTechnicalSignals.signals).map(([sym, sig]) => [sym, {
	          rsi14: sig.rsi14,
	          trend1h: sig.trend1h,
	          trend4h: sig.trend4h,
	          trend1d: sig.trend1d,
	          atrPct: sig.atrPct,
	          volumeRatio: sig.volumeRatio
	        }])
	      ) : null,
	      compositeSignals: lastCompositeSignals ? {
	        hourlyTrends: lastCompositeSignals.hourlyTrends,
	        btcMacro: lastCompositeSignals.btcMacro,
	        volumeSurges: lastCompositeSignals.volumeSurges,
	        oiVelocity: lastCompositeSignals.oiVelocity,
	        fundingRegimes: lastCompositeSignals.fundingRegimes,
	        pillarScores: lastCompositeSignals.pillarScores,
	      } : null,
	      tradeHistory: tradeJournal.summarize(),
	      convictionBoard: convictionBoard.forPrompt(),
	      portfolioCorrelation: computePortfolioBtcBeta(params.positions),
	      historicalContext: {
	        recentDirectives: formatHistoryForPrompt('recent strategist decisions', directiveHistory.recent(5), ['ts', 'decision', 'rationale', 'confidence', 'hadPlan']),
	        recentResearch: formatHistoryForPrompt('recent research cycles', researchHistory.recent(3), ['ts', 'headline', 'regime', 'confidence']),
	        recentRisk: formatHistoryForPrompt('recent risk cycles', riskHistory.recent(3), ['ts', 'posture', 'confidence']),
	        consecutiveHolds: directiveHistory.countConsecutiveFromEnd((e) => e.decision === 'HOLD')
	      }
	    }

    const stratConfig = llmConfigForRole('strategist', nowMs)
    const stratMarkPrices = Object.fromEntries(
      cachedUniverse.assets
        .filter((a) => activeBasket.symbols.includes(a.symbol) && a.markPx > 0)
        .map((a) => [a.symbol, a.markPx])
    )

    let raw: { decision: StrategistDirectiveDecision; plan: DirectivePlan | null; rationale: string; confidence: number }
    try {
      raw = await generateStrategistDirective({
        llm: stratConfig.provider,
        model: stratConfig.model,
        reasoningEffort: stratConfig.reasoningEffort,
        input,
        markPrices: stratMarkPrices,
        timeoutMs: stratConfig.timeoutMs
      })
    } catch (primaryError) {
      if (stratConfig.provider === 'codex') {
        const canUseClaude = await isClaudeAvailable()
        if (canUseClaude) {
          try {
            raw = await generateStrategistDirective({
              llm: 'claude',
              model: stratConfig.claudeFallbackModel,
              input,
              markPrices: stratMarkPrices,
              timeoutMs: stratConfig.timeoutMs
            })
            const disabled = maybeDisableCodexFromError(primaryError, nowMs)
            const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `directive codex failed; using claude ${stratConfig.claudeFallbackModel}: ${summarizeCodexError(primaryError)}${untilNote}`
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
        const canUseCodexLlm = await isCodexAvailable()
        if (canUseCodexLlm) {
          try {
            raw = await generateStrategistDirective({
              llm: 'codex',
              model: env.CODEX_MODEL,
              input,
              markPrices: stratMarkPrices,
              timeoutMs: stratConfig.timeoutMs
            })
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `directive claude failed; using codex ${env.CODEX_MODEL}: ${String(primaryError).slice(0, 120)}`
            })
          } catch (fallbackError) {
            const disabled = maybeDisableCodexFromError(fallbackError, nowMs)
            const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
            await publishTape({
              correlationId: ulid(),
              role: 'ops',
              level: 'WARN',
              line: `directive refresh failed after claude+codex fallback: ${summarizeCodexError(fallbackError)}${untilNote}`
            })
            return
          }
        } else {
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `directive refresh failed: claude and codex unavailable, holding previous directive (claude error: ${String(primaryError).slice(0, 180)})`
          })
          return
        }
      }
    }

    let filteredPlan = raw.decision === 'OPEN' ? raw.plan : null
    if (filteredPlan && activeBasket.symbols.length > 0) {
      const allowed = new Set(activeBasket.symbols)
      const validLegs = filteredPlan.legs.filter((leg) => allowed.has((leg as { symbol?: string }).symbol ?? ''))
      if (validLegs.length !== filteredPlan.legs.length) {
        const dropped = filteredPlan.legs.filter((leg) => !allowed.has((leg as { symbol?: string }).symbol ?? '')).map((l) => (l as { symbol?: string }).symbol)
        await publishTape({ correlationId: ulid(), role: 'ops', level: 'WARN', line: `directive plan: dropped off-basket legs [${dropped.join(',')}]` })
        filteredPlan = validLegs.length > 0 ? { ...filteredPlan, legs: validLegs } : null
      }
    }

    activeDirective = {
      decision: raw.decision,
      plan: filteredPlan,
      rationale: raw.rationale || 'directive',
      confidence: clamp(Number(raw.confidence), 0, 1),
      decidedAt: new Date().toISOString()
    }
    lastDirectiveAt = nowMs

    await directiveHistory.push({
      ts: activeDirective.decidedAt,
      decision: activeDirective.decision,
      rationale: activeDirective.rationale,
      confidence: activeDirective.confidence,
      hadPlan: activeDirective.plan !== null
    }).catch(() => undefined)

    // Update conviction board from directive
    convictionBoard.decay()
    if (activeDirective.plan?.legs) {
      const legSymbols = activeDirective.plan.legs.map((l) => l.symbol)
      convictionBoard.updateFromDirective(activeDirective.decision, legSymbols)
    }
    convictionBoard.flush().catch(() => undefined)

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

    // Publish performance attribution after each directive cycle
    const journalSummary = tradeJournal.summarize()
    if (journalSummary.totalTrades > 0) {
      await bus.publish('hlp.ui.events', {
        type: 'PERFORMANCE_ATTRIBUTION',
        stream: 'hlp.ui.events',
        source: 'agent-runner',
        correlationId: ulid(),
        actorType: 'internal_agent',
        actorId: roleActorId('scribe'),
        payload: {
          ...journalSummary,
          convictionSnapshot: convictionBoard.snapshot(),
          openTrades: tradeJournal.getOpenTrades(),
          publishedAt: new Date().toISOString()
        }
      }).catch(() => undefined)
    }
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

  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const maxBudgetUsd = computeMaxBudgetUsd()
  const tactics = computeExecutionTactics({ signals })
  const nowMs = Date.now()
  const hasFreshUniverse =
    activeBasket.symbols.length >= 1 && nowMs - Date.parse(activeBasket.selectedAt) <= env.AGENT_UNIVERSE_REFRESH_MS

  syncActiveBasketFromPositions(lastPositions)

  // Universe should already be fresh from pipeline start. Force-retry only if still empty.
  if (!hasFreshUniverse && lastMode !== 'HALT') {
    await maybeSelectBasket({ targetNotionalUsd: maxBudgetUsd, signals, positions: lastPositions, force: activeBasket.symbols.length === 0 })
  }

  await maybeRefreshStrategistDirective({ signals, targetNotionalUsd: maxBudgetUsd, positions: lastPositions })
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

  const scaledTargetNotionalUsd = maxBudgetUsd

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
      rationale: activeDirective.rationale,
      exitReason: riskRecovery.active || lastMode === 'SAFE_MODE' ? 'RISK_OFF' : 'DISCRETIONARY'
    })
  } else if (activeDirective.decision === 'OPEN') {
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
      summaryPrefix: 'agent autonomous'
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

  const scribeConfig = llmConfigForRole('scribe', nowMs)
  let analysis: { headline: string; thesis: string; risks: string[]; confidence: number } | null = null
  try {
    analysis = await generateAnalysis({
      llm: scribeConfig.provider,
      model: scribeConfig.model,
      reasoningEffort: scribeConfig.reasoningEffort,
      input: analysisInput,
      timeoutMs: scribeConfig.timeoutMs
    })
  } catch (primaryError) {
    if (scribeConfig.provider === 'codex') {
      const canUseClaude = await isClaudeAvailable()
      if (canUseClaude) {
        try {
          analysis = await generateAnalysis({
            llm: 'claude',
            model: scribeConfig.claudeFallbackModel,
            input: analysisInput,
            timeoutMs: scribeConfig.timeoutMs
          })
          const disabled = maybeDisableCodexFromError(primaryError, nowMs)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: proposal.proposalId,
            role: 'ops',
            level: 'WARN',
            line: `scribe codex failed; using claude ${scribeConfig.claudeFallbackModel}: ${summarizeCodexError(primaryError)}${untilNote}`
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
      const canUseCodexLlm = await isCodexAvailable()
      if (canUseCodexLlm) {
        try {
          analysis = await generateAnalysis({
            llm: 'codex',
            model: env.CODEX_MODEL,
            input: analysisInput,
            timeoutMs: scribeConfig.timeoutMs
          })
          await publishTape({
            correlationId: proposal.proposalId,
            role: 'ops',
            level: 'WARN',
            line: `scribe claude failed; using codex ${env.CODEX_MODEL}: ${String(primaryError).slice(0, 120)}`
          })
        } catch (fallbackError) {
          const disabled = maybeDisableCodexFromError(fallbackError, nowMs)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: proposal.proposalId,
            role: 'ops',
            level: 'WARN',
            line: `scribe claude+codex failed; skipping scribe update: ${summarizeCodexError(fallbackError)}${untilNote}`
          })
          return
        }
      } else {
        await publishTape({
          correlationId: proposal.proposalId,
          role: 'ops',
          level: 'WARN',
          line: `scribe llm unavailable: claude and codex unavailable; skipping scribe update (claude error: ${String(primaryError).slice(0, 180)})`
        })
        return
      }
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
              liquidityBufferPct: finiteNumber(riskPolicyPayload.liquidityBufferPct)
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

      const prevSymbols = new Set(lastPositions.map((p) => p.symbol))
      lastPositions = meaningfulPositions(positions, EXIT_NOTIONAL_EPSILON_USD)
      syncActiveBasketFromPositions(lastPositions)

      // Trade journal: open new trades, update mark prices, close exited trades
      const currentSymbols = new Set(lastPositions.map((p) => p.symbol))
      for (const pos of lastPositions) {
        if (!prevSymbols.has(pos.symbol)) {
          tradeJournal.openTrade({ symbol: pos.symbol, side: pos.side, entryPx: pos.avgEntryPx, notionalUsd: pos.notionalUsd })
        }
        tradeJournal.updateMarkPrice(pos.symbol, pos.markPx)
      }
      const markPricesForJournal: Record<string, number> = {}
      for (const pos of positions) {
        if (typeof (pos as any).markPx === 'number') markPricesForJournal[(pos as any).symbol] = (pos as any).markPx
      }
      tradeJournal.reconcile(currentSymbols, markPricesForJournal)
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
          projectedDrawdownPct: finiteNumber(payload.computed.projectedDrawdownPct) ?? 0
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

  await Promise.all([
    researchHistory.load(),
    riskHistory.load(),
    directiveHistory.load(),
    intelHistory.load(),
    tradeJournal.load(),
    convictionBoard.load()
  ])

  const HEARTBEAT_PATH = '/tmp/.agent-runner-heartbeat'
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  let running = true

  const mainLoop = async () => {
    while (running) {
      const start = Date.now()

      try {
        await runStrategyPipeline()
      } catch (error) {
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
          console.warn('agent-runner: publishAudit failed in pipeline error handler', {
            error: String(publishError)
          })
        })
      } finally {
        await fs.writeFile(HEARTBEAT_PATH, String(Date.now())).catch((error) => {
          warnHeartbeatWriteFailed(error)
        })
      }

      const elapsed = Date.now() - start
      const sleepMs = Math.max(0, env.AGENT_PIPELINE_BASE_MS - elapsed)
      if (sleepMs > 0) await sleep(sleepMs)
    }
  }

  // Eagerly populate universe on startup so the first pipeline cycle has symbols.
  try {
    const bootBudget = computeMaxBudgetUsd()
    await maybeSelectBasket({ targetNotionalUsd: bootBudget, signals: [], positions: lastPositions, force: true })
    if (activeBasket.symbols.length > 0) {
      await publishTape({ correlationId: ulid(), role: 'ops', line: `boot universe: ${activeBasket.symbols.join(',')}` })
    }
  } catch (error) {
    console.warn('agent-runner: eager universe selection failed at boot, will retry in pipeline', String(error))
  }

  void mainLoop()

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
