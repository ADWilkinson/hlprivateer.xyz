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

export async function runClaudeStructured<T>(params: {
  prompt: string
  jsonSchema: Record<string, unknown>
  model: string
  timeoutMs?: number
}): Promise<T> {
  const timeoutMs = params.timeoutMs ?? 90_000
  const { stdout } = await runCommand(
    'claude',
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
      'codex',
      [
        'exec',
        '--ephemeral',
        '--sandbox',
        'read-only',
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
