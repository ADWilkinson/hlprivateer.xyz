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
  const agentId = BigInt(required('AGENT_ID'))
  const newURI = required('AGENT_URI')

  const account = privateKeyToAccount(privateKey)
  const client = createIdentityClient({ chainId, rpcUrl })

  console.log(`chain=${chainId} agentId=${agentId}`)
  console.log(`updating URI to ${newURI}`)

  const txHash = await client.setAgentURI(agentId, newURI, account)
  console.log(`tx=${txHash}`)
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
