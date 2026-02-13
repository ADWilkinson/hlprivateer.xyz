import fs from 'node:fs'
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import { PrivateKeySigner } from '@nktkas/hyperliquid/signing'

const DEFAULT_HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

function readSecretFromFile(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) {
    throw new Error(`empty secret file: ${filePath}`)
  }
  return raw
}

function loadEnvValue(name: string): string | undefined {
  const filePath = process.env[`${name}_FILE`]
  if (filePath) {
    return readSecretFromFile(filePath)
  }

  const raw = process.env[name]
  return raw && raw.trim() ? raw.trim() : undefined
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return fallback
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return undefined
  const next = process.argv[idx + 1]
  if (!next || next.startsWith('--')) return undefined
  return next
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return fallback
}

function fmtUsd(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

async function postInfo<T>(infoUrl: string, body: unknown): Promise<T> {
  const response = await fetch(infoUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`hyperliquid info http ${response.status}: ${text.slice(0, 160)}`)
  }
  return JSON.parse(text) as T
}

async function main(): Promise<void> {
  const amount = argValue('--amount')
  if (!amount) {
    throw new Error('missing required flag: --amount <number>')
  }

  const toPerp = parseBool(argValue('--toPerp'), true)

  const privateKey = loadEnvValue('HL_PRIVATE_KEY')
  if (!privateKey) {
    throw new Error('missing HL_PRIVATE_KEY or HL_PRIVATE_KEY_FILE')
  }

  const wallet = new PrivateKeySigner(privateKey)
  const transport = new HttpTransport({
    isTestnet: envBool('HL_IS_TESTNET', false),
    timeout: fmtUsd(loadEnvValue('HL_REQUEST_TIMEOUT_MS') ?? 10_000),
    apiUrl: loadEnvValue('HL_API_URL')
  })
  const exchange = new ExchangeClient({ transport, wallet })
  const info = new InfoClient({ transport })
  const infoUrl = loadEnvValue('HL_INFO_URL') ?? DEFAULT_HL_INFO_URL

  const abstraction = await postInfo<string>(infoUrl, { type: 'userAbstraction', user: wallet.address })
  console.log(`usdClassTransfer: abstraction=${abstraction}`)
  if (abstraction === 'unifiedAccount' || abstraction === 'portfolioMargin' || abstraction === 'default') {
    throw new Error(`usdClassTransfer is disabled when abstraction=${abstraction}; fund Spot USDC instead`)
  }

  const beforeCh = await info.clearinghouseState({ user: wallet.address })
  const beforePerpValue = fmtUsd(beforeCh.marginSummary?.accountValue ?? beforeCh.crossMarginSummary?.accountValue ?? '0')

  const beforeSpot = await info.spotClearinghouseState({ user: wallet.address })
  const usdcSpot = beforeSpot.balances.find((b) => b.coin === 'USDC')?.total ?? '0'
  const beforeSpotUsdc = fmtUsd(usdcSpot)

  console.log(`usdClassTransfer: wallet=${wallet.address}`)
  console.log(`usdClassTransfer: before spot.USDC=${beforeSpotUsdc.toFixed(6)} perp.accountValue=${beforePerpValue.toFixed(6)}`)

  const res = await exchange.usdClassTransfer({ amount, toPerp })
  console.log(`usdClassTransfer: result=${JSON.stringify(res)}`)

  const afterCh = await info.clearinghouseState({ user: wallet.address })
  const afterPerpValue = fmtUsd(afterCh.marginSummary?.accountValue ?? afterCh.crossMarginSummary?.accountValue ?? '0')

  const afterSpot = await info.spotClearinghouseState({ user: wallet.address })
  const afterSpotUsdcRaw = afterSpot.balances.find((b) => b.coin === 'USDC')?.total ?? '0'
  const afterSpotUsdc = fmtUsd(afterSpotUsdcRaw)

  console.log(`usdClassTransfer: after  spot.USDC=${afterSpotUsdc.toFixed(6)} perp.accountValue=${afterPerpValue.toFixed(6)}`)
}

main().catch((error) => {
  console.error('usdClassTransfer: FAIL', error)
  process.exitCode = 1
})
