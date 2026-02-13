import { runClaudeStructured, runCodexStructured } from '../../apps/agent-runner/src/llm'

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

type SmokeOut = {
  ok: boolean
  from: 'claude' | 'codex'
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    from: { type: 'string', enum: ['claude', 'codex'] }
  },
  required: ['ok', 'from']
} as const

function envOr(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw && raw.trim() ? raw.trim() : fallback
}

async function smokeClaude(model: string): Promise<void> {
  const prompt = [
    'Return only JSON that matches the provided schema.',
    'Set ok=true and from=\"claude\".'
  ].join('\n')

  const out = await runClaudeStructured<SmokeOut>({ prompt, jsonSchema: schema as unknown as Record<string, unknown>, model })
  if (!out?.ok || out.from !== 'claude') {
    throw new Error(`claude smoke returned unexpected payload: ${JSON.stringify(out)}`)
  }
}

async function smokeCodex(model: string, reasoningEffort: ReasoningEffort): Promise<void> {
  const prompt = [
    'Return only JSON that matches the provided schema.',
    'Set ok=true and from=\"codex\".'
  ].join('\n')

  const out = await runCodexStructured<SmokeOut>({
    prompt,
    jsonSchema: schema as unknown as Record<string, unknown>,
    model,
    reasoningEffort
  })
  if (!out?.ok || out.from !== 'codex') {
    throw new Error(`codex smoke returned unexpected payload: ${JSON.stringify(out)}`)
  }
}

async function main(): Promise<void> {
  const claudeModel = envOr('CLAUDE_MODEL', 'opus')
  const codexModel = envOr('CODEX_MODEL', 'gpt-5.3-codex-spark')
  const reasoningEffort = envOr('CODEX_REASONING_EFFORT', 'xhigh') as ReasoningEffort

  console.log(`llm-smoke: claude model=${claudeModel}`)
  await smokeClaude(claudeModel)
  console.log('llm-smoke: claude ok')

  console.log(`llm-smoke: codex model=${codexModel} reasoning=${reasoningEffort}`)
  await smokeCodex(codexModel, reasoningEffort)
  console.log('llm-smoke: codex ok')
}

main().catch((error) => {
  console.error('llm-smoke: FAIL', error)
  process.exitCode = 1
})

