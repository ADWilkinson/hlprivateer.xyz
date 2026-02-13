import { x402Client, x402HTTPClient } from '@x402/core/client'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function main() {
  const baseUrl = (process.env.API_BASE_URL ?? 'https://api.hlprivateer.xyz').replace(/\/$/, '')
  const route = process.env.X402_ROUTE ?? '/v1/agent/analysis/latest'
  const url = `${baseUrl}${route}`

  const payerPrivateKey = requireEnv('X402_PAYER_PRIVATE_KEY')
  if (!payerPrivateKey.startsWith('0x') || payerPrivateKey.length < 66) {
    throw new Error('X402_PAYER_PRIVATE_KEY must be a 0x-prefixed EVM private key')
  }

  console.log(`url=${url}`)

  const first = await fetch(url, { method: 'GET' })
  console.log(`first status=${first.status}`)

  if (first.status !== 402) {
    console.log(await first.text())
    process.exitCode = 1
    return
  }

  const account = privateKeyToAccount(payerPrivateKey as `0x${string}`)
  const client = new x402Client()
  registerExactEvmScheme(client, { signer: account })
  const http = new x402HTTPClient(client)

  const paymentRequired = http.getPaymentRequiredResponse((name) => first.headers.get(name))
  console.log('paymentRequired.resource.url=', paymentRequired.resource?.url)
  console.log('accepts[0]=', paymentRequired.accepts?.[0])

  const paymentPayload = await http.createPaymentPayload(paymentRequired)
  const paymentHeaders = http.encodePaymentSignatureHeader(paymentPayload)

  const second = await fetch(url, { method: 'GET', headers: { ...paymentHeaders } })
  console.log(`retry status=${second.status}`)

  const responseText = await second.text()
  if (!second.ok) {
    console.log(responseText)
    process.exitCode = 1
    return
  }

  try {
    const settle = http.getPaymentSettleResponse((name) => second.headers.get(name))
    console.log('paymentResponse=', settle)
  } catch (error) {
    console.warn('missing/invalid PAYMENT-RESPONSE header:', String(error))
  }

  console.log(responseText.slice(0, 600))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

