import { createReputationClient, type SupportedChainId } from '@hl/privateer-erc8004'

function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`missing env: ${name}`)
  return val
}

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? '84532') as SupportedChainId
  const rpcUrl = required('RPC_URL')
  const agentId = BigInt(required('AGENT_ID'))
  const tag1 = process.env.TAG1 ?? ''
  const tag2 = process.env.TAG2 ?? ''

  const client = createReputationClient({ chainId, rpcUrl })

  console.log(`chain=${chainId} agentId=${agentId}`)

  const clients = await client.getClients(agentId)
  console.log(`clients=${clients.length}`)

  if (clients.length > 0) {
    const summary = await client.getSummary(agentId, clients, tag1, tag2)
    console.log(`count=${summary.count}`)
    console.log(`summaryValue=${summary.summaryValue}`)
    console.log(`summaryValueDecimals=${summary.summaryValueDecimals}`)
  } else {
    console.log('no feedback yet')
  }
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
