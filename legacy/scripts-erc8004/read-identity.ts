import { createIdentityClient, type SupportedChainId } from '@hl/privateer-erc8004'

function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`missing env: ${name}`)
  return val
}

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? '84532') as SupportedChainId
  const rpcUrl = required('RPC_URL')
  const agentId = BigInt(required('AGENT_ID'))

  const client = createIdentityClient({ chainId, rpcUrl })

  console.log(`chain=${chainId} agentId=${agentId}`)

  const [owner, uri, wallet] = await Promise.all([
    client.ownerOf(agentId),
    client.tokenURI(agentId),
    client.getAgentWallet(agentId),
  ])

  console.log(`owner=${owner}`)
  console.log(`tokenURI=${uri}`)
  console.log(`agentWallet=${wallet}`)
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
