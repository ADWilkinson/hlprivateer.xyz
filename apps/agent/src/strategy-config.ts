import { readFile } from 'node:fs/promises'
import { StrategyConfigSchema, type StrategyConfig } from './contracts'

const DEFAULT_PATH = 'config/strategy.json'
const DEFAULT_TEMPLATE_PATH = 'config/strategy.template.json'

export interface LoadOpts {
  /** Explicit override path. Takes precedence over env + defaults. */
  path?: string
  /** Logger called once with the resolved source. */
  log?: (msg: string) => void
}

export async function loadStrategy(opts: LoadOpts = {}): Promise<StrategyConfig> {
  const explicit = opts.path ?? process.env.STRATEGY_CONFIG_PATH
  const candidates = [explicit, DEFAULT_PATH, DEFAULT_TEMPLATE_PATH].filter(Boolean) as string[]
  for (const path of candidates) {
    const raw = await tryReadJson(path)
    if (raw !== undefined) {
      opts.log?.(`strategy: loaded ${path}`)
      return StrategyConfigSchema.parse(raw)
    }
  }
  opts.log?.('strategy: no config found, using schema defaults')
  return StrategyConfigSchema.parse({})
}

async function tryReadJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
    throw err
  }
}
