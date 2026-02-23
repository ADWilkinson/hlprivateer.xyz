import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ulid } from 'ulid'
import { env } from './config'

async function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const processEnv = {
      ...process.env,
      ...(env ?? {})
    }

    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: processEnv
    })
    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function looksLikeCodexDependencyFailure(error: unknown): boolean {
  const message = String(error)
  return (
    message.includes('Missing optional dependency @openai/codex-linux-x64') ||
    message.includes('Cannot use import statement outside a module') ||
    message.includes('To load an ES module')
  )
}

function isMissingCommandError(error: unknown, command: string): boolean {
  const normalized = String(error).toLowerCase()
  return normalized.includes(`spawn ${command}`) && normalized.includes('enoent')
}

async function runCliCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  kind: 'claude' | 'codex'
): Promise<{ stdout: string; stderr: string }> {
  const bunInstall = process.env.BUN_INSTALL?.trim() || path.join(process.env.HOME || '', '.bun')
  const codexNodePath = path.join(bunInstall, 'install', 'global', 'node_modules')
  const shellEnv = {
    NODE_PATH: codexNodePath
  }
  const commandEnv = kind === 'claude' ? undefined : shellEnv

  if (kind === 'claude') {
    try {
      return await runCommand(command, args, timeoutMs, commandEnv)
    } catch (error) {
      if (isMissingCommandError(error, command)) {
        return runCommand('bun', [command, ...args], timeoutMs, commandEnv)
      }
      throw error
    }
  }

  try {
    return await runCommand(command, args, timeoutMs, commandEnv)
  } catch (error) {
    if (isMissingCommandError(error, command)) {
      return runCommand('bun', [command, ...args], timeoutMs, commandEnv)
    }
    if (looksLikeCodexDependencyFailure(error)) {
      return runCommand('bunx', ['--bun', 'codex', ...args], timeoutMs, commandEnv)
    }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function safeTruncate(value: string, max = 220): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned
}

function summarizeClaudeFailurePayload(payload: unknown): string {
  if (!isRecord(payload)) {
    return safeTruncate(String(payload))
  }

  const message = payload.message
  if (typeof message === 'string' && message.trim()) {
    return safeTruncate(message)
  }

  const type = payload.type
  if (type === 'result') {
    const errors = Array.isArray(payload.errors) ? payload.errors : null
    if (errors) {
      const rendered = errors
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry
          }
          if (isRecord(entry) && typeof entry.error === 'string') {
            return entry.error
          }
          return typeof entry === 'object' ? JSON.stringify(entry) : String(entry)
        })
        .filter(Boolean)
      if (rendered.length > 0) {
        return rendered.join(' | ').slice(0, 220)
      }
    }

    if (payload.stop_reason) {
      return `claude result stop_reason=${payload.stop_reason}`
    }
  }

  return 'claude execution failure'
}

function removeAnsiCodes(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
}

function parseJsonFromText(raw: string): unknown | null {
  const text = removeAnsiCodes(raw).trim()
  if (!text) {
    return null
  }

  const seen = new Set<string>()
  const candidates: string[] = []
  const add = (candidate: string): void => {
    const trimmed = candidate.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    candidates.push(trimmed)
  }

  const pushBalancedFrom = (start: number): void => {
    const open = text[start]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < text.length; index += 1) {
      const char = text[index]

      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === open) {
        depth += 1
        continue
      }

      if (char === close) {
        depth -= 1
        if (depth <= 0) {
          add(text.slice(start, index + 1))
          return
        }
      }
    }
  }

  add(text)

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '{' || text[index] === '[') {
      pushBalancedFrom(index)
    }
  }

  const fenceRegex = /```(?:json)?\n([\s\S]*?)```/g
  for (let match = fenceRegex.exec(text); match !== null; match = fenceRegex.exec(text)) {
    const extracted = match[1]?.trim()
    if (extracted) {
      add(extracted)
    }
  }

  for (const line of text.split('\n').reverse()) {
    add(line)
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate)
    if (parsed !== null) {
      return parsed
    }
  }

  return null
}

function parseJsonFromTextCandidates(raw: string): unknown | null {
  const candidates = Array.from(new Set(raw.split(/\n+/).filter(Boolean)))
  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate)
    if (parsed !== null) {
      return parsed
    }
  }
  return null
}

function extractClaudePayload(payload: unknown): unknown | null {
  if (!isRecord(payload)) {
    return null
  }

  const contentText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const maybe = parseJsonFromText(trimmed)
    if (maybe !== null) {
      return trimmed
    }
    return trimmed
  }

  const result = payload.result
  if (isRecord(result)) {
    if ('content' in result && Array.isArray(result.content)) {
      for (const block of result.content) {
        const text = contentText(block?.text)
        if (text) {
          return safeJsonParse(text)
        }
      }
    }
    const resultPayload = (result as Record<string, unknown>).output
    if (resultPayload !== undefined && resultPayload !== null) {
      const parsed = safeJsonParse(String(resultPayload))
      if (parsed !== null) {
        return parsed
      }
      const candidate = parseJsonFromText(String(resultPayload))
      if (candidate !== null) {
        return candidate
      }
    }
  }

  const message = payload.message
  if (isRecord(message) && typeof message.content === 'string') {
    const parsed = parseJsonFromText(message.content)
    if (parsed !== null) {
      return parsed
    }
  }

  if ('structured_output' in payload) {
    return payload.structured_output
  }

  if ('result' in payload) {
    const result = payload.result
    if (typeof result === 'string') {
      const parsed = parseJsonFromText(result)
      if (parsed !== null) {
        return parsed
      }
    } else if (isRecord(result) || Array.isArray(result)) {
      return result
    }
  }

  if (payload.type === 'result' && payload.is_error === true) {
    return null
  }

  return payload
}

async function writeSafeClaudeSettings(): Promise<string | null> {
  const home = process.env.HOME
  if (!home) {
    return null
  }

  const sourcePath = path.join(home, '.claude', 'settings.json')
  try {
    const raw = await fs.readFile(sourcePath, 'utf8')
    const parsed = safeJsonParse(raw)
    if (!isRecord(parsed)) {
      return null
    }

    const cleaned = {
      ...parsed,
      hooks: undefined,
      statusLine: undefined,
      statusline: undefined
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hlp-claude-settings-'))
    const target = path.join(tempDir, 'settings.json')
    await fs.writeFile(target, JSON.stringify(cleaned), 'utf8')
    return target
  } catch {
    return null
  }
}

async function cleanupTempPath(target?: string | null): Promise<void> {
  if (!target) {
    return
  }

  const normalized = target.replace(/[/\\]settings\.json$/, '')
  await fs.rm(normalized, { recursive: true, force: true }).catch(() => undefined)
}

const commandPathCache = new Map<string, string | null>()
const commandPathPending = new Map<string, Promise<string | null>>()

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const next = value.trim()
    if (!next || seen.has(next)) {
      continue
    }
    seen.add(next)
    out.push(next)
  }
  return out
}

function candidateCommandPaths(cmd: string): string[] {
  const baseHome = process.env.HOME?.trim()

  const envCandidates = [
    cmd === 'claude' ? process.env.CLAUDE_CLI_PATH : process.env.CODEX_CLI_PATH,
    cmd === 'claude' ? process.env.CLAUDE_CLI_BIN : process.env.CODEX_CLI_BIN,
    cmd === 'claude' ? process.env.CLI_CLAUDE_PATH : process.env.CLI_CODEX_PATH
  ]

  const homeCandidates = baseHome
    ? [path.join(baseHome, '.bun', 'bin', cmd), path.join(baseHome, 'bin', cmd)]
    : []

  const pathDirCandidates = (process.env.PATH || '')
    .split(':')
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.join(dir, cmd))

  const commonCandidates = [`/usr/local/bin/${cmd}`, `/usr/bin/${cmd}`, `/bin/${cmd}`]

  return uniqueStrings([
    ...envCandidates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ...homeCandidates,
    ...pathDirCandidates,
    ...commonCandidates
  ])
}

async function resolveCommandPath(cmd: string): Promise<string | null> {
  const cached = commandPathCache.get(cmd)
  if (cached !== undefined) {
    return cached
  }

  const pending = commandPathPending.get(cmd)
  if (pending) {
    return pending
  }

  const search = (async (): Promise<string | null> => {
    const candidates = candidateCommandPaths(cmd)
    for (const candidate of candidates) {
      try {
        await runCommand('test', ['-x', candidate], 2_500)
        commandPathCache.set(cmd, candidate)
        return candidate
      } catch {
        continue
      }
    }

    // Last fallback for PATH-style binaries in this shell.
    try {
      const whichPath = await runCommand('which', [cmd], 2_500)
      const resolved = whichPath.stdout.trim()
      if (resolved) {
        commandPathCache.set(cmd, resolved)
        return resolved
      }
    } catch {
      // intentionally ignore
    }

    commandPathCache.set(cmd, null)
    return null
  })()

  commandPathPending.set(cmd, search)
  const resolved = await search
  commandPathPending.delete(cmd)
  return resolved
}

export async function isCommandAvailable(cmd: string): Promise<boolean> {
  return (await resolveCommandPath(cmd)) !== null
}

export async function runClaudeStructured<T>(params: {
  prompt: string
  jsonSchema: Record<string, unknown>
  model: string
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  timeoutMs?: number
}): Promise<T> {
  const command = await resolveCommandPath('claude')
  const available = command !== null
  if (!available) {
    throw new Error('Executable not found in $PATH: "claude". Set CLAUDE_CLI_PATH or install CLI for this container.')
  }

  const settingsPath = await writeSafeClaudeSettings()

  const timeoutMs = params.timeoutMs ?? env.AGENT_LLM_TIMEOUT_MS
  const useThinking = params.reasoningEffort === 'high' || params.reasoningEffort === 'xhigh'

  const buildArgs = (): string[] => {
    const args = [
      '-p',
      '--no-session-persistence',
      '--tools',
      '',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(params.jsonSchema),
      '--model',
      params.model
    ] as string[]
    if (useThinking) args.push('--betas', 'interleaved-thinking')
    if (settingsPath) args.push('--settings', settingsPath)
    args.push(params.prompt)
    return args
  }

  const MAX_ATTEMPTS = 2
  const RETRY_DELAY_MS = 4_000
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { stdout, stderr } = await runCliCommand(command, buildArgs(), timeoutMs, 'claude')
        const parsed = parseJsonFromText(`${stdout}\n${stderr}`)
        if (!parsed) {
          throw new Error(
            `claude did not return structured output (output=${safeTruncate(stdout)}${stderr ? ` | ${safeTruncate(stderr)}` : ''})`,
          )
        }
        const failure = summarizeClaudeFailurePayload(parsed)
        if (isRecord(parsed) && parsed.type === 'result' && parsed.is_error === true) {
          throw new Error(failure)
        }
        const extracted = extractClaudePayload(parsed)
        if (!extracted) {
          throw new Error(failure)
        }
        return extracted as T
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && !String(error).includes('timed out')) {
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          continue
        }
        throw error
      }
    }
    throw new Error('unreachable')
  } finally {
    await cleanupTempPath(settingsPath)
  }
}

export async function runCodexStructured<T>(params: {
  prompt: string
  jsonSchema: Record<string, unknown>
  model: string
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  timeoutMs?: number
}): Promise<T> {
  const command = await resolveCommandPath('codex')
  const available = command !== null
  if (!available) {
    throw new Error('Executable not found in $PATH: "codex". Set CODEX_CLI_PATH or install CLI for this container.')
  }

  const timeoutMs = params.timeoutMs ?? env.AGENT_LLM_TIMEOUT_MS
  const runId = ulid()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hlp-codex-'))
  const schemaPath = path.join(tmpDir, `schema-${runId}.json`)
  const outPath = path.join(tmpDir, `out-${runId}.txt`)
  try {
    await fs.writeFile(schemaPath, JSON.stringify(params.jsonSchema), 'utf8')
    const reasoningConfigArg = params.reasoningEffort
      ? [`model_reasoning_effort="${params.reasoningEffort}"`]
      : []
    await runCliCommand(
      command,
      [
        'exec',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--model',
        params.model,
        ...(reasoningConfigArg.length ? ['-c', ...reasoningConfigArg] : []),
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outPath,
        params.prompt
      ],
      timeoutMs,
      'codex'
    )

    const raw = await fs.readFile(outPath, 'utf8')
    const parsed = parseJsonFromText(raw)
    if (!parsed) {
      throw new Error(`codex did not return JSON (output=${safeTruncate(raw)})`)
    }
    return parsed as T
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
