import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ulid } from 'ulid'

async function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
  timeoutMs?: number
}): Promise<T> {
  const command = await resolveCommandPath('claude')
  const available = command !== null
  if (!available) {
    throw new Error('Executable not found in $PATH: "claude". Set CLAUDE_CLI_PATH or install CLI for this container.')
  }

  const timeoutMs = params.timeoutMs ?? 90_000
  const { stdout } = await runCommand(
    command,
    [
      '-p',
      '--no-session-persistence',
      '--tools',
      '',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(params.jsonSchema),
      '--model',
      params.model,
      params.prompt
    ],
    timeoutMs
  )

  const parsed = JSON.parse(stdout) as { structured_output?: unknown }
  if (!parsed.structured_output) {
    throw new Error('claude did not return structured_output')
  }

  return parsed.structured_output as T
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

  const timeoutMs = params.timeoutMs ?? 120_000
  const runId = ulid()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hlp-codex-'))
  const schemaPath = path.join(tmpDir, `schema-${runId}.json`)
  const outPath = path.join(tmpDir, `out-${runId}.txt`)
  try {
    await fs.writeFile(schemaPath, JSON.stringify(params.jsonSchema), 'utf8')
    const reasoningConfigArg = params.reasoningEffort
      ? [`model_reasoning_effort="${params.reasoningEffort}"`]
      : []
    await runCommand(
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
      timeoutMs
    )

    const raw = await fs.readFile(outPath, 'utf8')
    return JSON.parse(raw) as T
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
