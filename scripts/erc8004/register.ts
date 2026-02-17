import { privateKeyToAccount } from 'viem/accounts'
import { createIdentityClient, type SupportedChainId } from '@hl/privateer-erc8004'

function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`missing env: ${name}`)
  return val
}

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? '84532') as SupportedChainId
  const rpcUrl = required('RPC_URL')
  const privateKey = required('PRIVATE_KEY') as `0x${string}`
  const agentURI = required('AGENT_URI')

  const account = privateKeyToAccount(privateKey)
  const client = createIdentityClient({ chainId, rpcUrl })

  console.log(`chain=${chainId} owner=${account.address}`)
  console.log(`registering agentURI=${agentURI}`)

  const { agentId, txHash } = await client.register(agentURI, account)
  console.log(`agentId=${agentId}`)
  console.log(`tx=${txHash}`)
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
