import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { PrivateKeySigner } from '@nktkas/hyperliquid'

const ROOT = process.cwd()
const SECRETS_DIR = path.join(ROOT, 'secrets')

const KEY_PATH = path.join(SECRETS_DIR, 'hl_trading_private_key')
const SHARD1_PATH = path.join(SECRETS_DIR, 'hl_trading_private_key.shard1.hex')
const SHARD2_PATH = path.join(SECRETS_DIR, 'hl_trading_private_key.shard2.hex')
const ADDRESS_PATH = path.join(SECRETS_DIR, 'hl_trading_address.txt')

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  await fs.mkdir(SECRETS_DIR, { recursive: true, mode: 0o700 })
  await fs.chmod(SECRETS_DIR, 0o700).catch(() => undefined)

  if (await fileExists(KEY_PATH)) {
    throw new Error(`refusing to overwrite existing key: ${KEY_PATH}`)
  }
  if (await fileExists(SHARD1_PATH)) {
    throw new Error(`refusing to overwrite existing shard: ${SHARD1_PATH}`)
  }
  if (await fileExists(SHARD2_PATH)) {
    throw new Error(`refusing to overwrite existing shard: ${SHARD2_PATH}`)
  }

  const key = crypto.randomBytes(32)
  const keyHex = `0x${key.toString('hex')}`

  // 2-of-2 XOR shards: shard2 = key XOR shard1
  const shard1 = crypto.randomBytes(32)
  const shard2 = Buffer.alloc(32)
  for (let i = 0; i < 32; i += 1) {
    shard2[i] = key[i] ^ shard1[i]
  }

  await fs.writeFile(KEY_PATH, `${keyHex}\n`, { mode: 0o600 })
  await fs.writeFile(SHARD1_PATH, `${shard1.toString('hex')}\n`, { mode: 0o600 })
  await fs.writeFile(SHARD2_PATH, `${shard2.toString('hex')}\n`, { mode: 0o600 })

  const address = new PrivateKeySigner(keyHex).address
  await fs.writeFile(ADDRESS_PATH, `${address}\n`, { mode: 0o644 })

  console.log(address)
  console.log(`wrote ${KEY_PATH}`)
  console.log(`wrote ${SHARD1_PATH}`)
  console.log(`wrote ${SHARD2_PATH}`)
  console.log(`wrote ${ADDRESS_PATH}`)
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})

