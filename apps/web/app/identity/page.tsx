'use client'

import { useEffect, useState } from 'react'
import { apiUrl } from '../../lib/endpoints'
import { type IdentityResponse, basescanUrl, basescanNftUrl } from '../../lib/erc8004'
import { pageShellClass, cardClass, cardHeaderClass, panelBodyPad, sectionTitleClass, mutedTextClass, inlineBadgeClass } from '../ui/ascii-style'

const POLL_INTERVAL_MS = 60_000

export default function IdentityPage() {
  const [data, setData] = useState<IdentityResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/v1/public/identity'))
        if (res.ok && active) {
          setData(await res.json())
        }
      } catch {
        // Endpoint may not be available yet
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const erc = data?.erc8004
  const rep = data?.reputation

  return (
    <main className={pageShellClass}>
      <div className='text-center py-4 animate-hlp-fade-up'>
        <h1 className='text-[11px] uppercase tracking-[0.28em] text-hlpFg font-bold'>On-Chain Identity</h1>
        <p className={`${mutedTextClass} mt-1`}>ERC-8004 Trustless Agent Registry</p>
      </div>

      <div className={`${cardClass} animate-hlp-fade-up`}>
        <div className={cardHeaderClass}>
          <span>Identity Registry</span>
          <span className={inlineBadgeClass}>{erc ? 'REGISTERED' : loading ? '--' : 'UNREGISTERED'}</span>
        </div>
        <div className={panelBodyPad}>
          {loading ? (
            <div className={mutedTextClass}>loading...</div>
          ) : erc ? (
            <div className='space-y-2'>
              <Row label='AGENT ID' value={`#${erc.agentId}`} />
              <Row label='CHAIN' value={`Base (${erc.chainId})`} />
              <Row label='REGISTRY' value={truncAddr(erc.identityRegistry)} href={basescanUrl('address', erc.identityRegistry)} />
              <Row label='NFT' value={`Token #${erc.agentId}`} href={basescanNftUrl(erc.identityRegistry, erc.agentId)} />
              <Row label='REGISTRATION' value='agent-registration.json' href={erc.registrationFile} />
            </div>
          ) : (
            <div className={mutedTextClass}>ERC-8004 identity not configured</div>
          )}
        </div>
      </div>

      <div className={`${cardClass} animate-hlp-fade-up`} style={{ animationDelay: '80ms' }}>
        <div className={cardHeaderClass}>
          <span>Reputation Registry</span>
          <span className={inlineBadgeClass}>{rep && rep.count > 0 ? `${rep.count} REVIEWS` : 'NO FEEDBACK'}</span>
        </div>
        <div className={panelBodyPad}>
          {loading ? (
            <div className={mutedTextClass}>loading...</div>
          ) : rep ? (
            <div className='space-y-2'>
              <Row label='FEEDBACK COUNT' value={String(rep.count)} />
              <Row label='SUMMARY VALUE' value={String(rep.summaryValue)} />
              <Row label='TRUST MODEL' value='reputation' />
            </div>
          ) : (
            <div className={mutedTextClass}>reputation data unavailable</div>
          )}
        </div>
      </div>

      <div className={`${cardClass} animate-hlp-fade-up`} style={{ animationDelay: '160ms' }}>
        <div className={cardHeaderClass}>
          <span>Protocol</span>
        </div>
        <div className={panelBodyPad}>
          <div className='space-y-2'>
            <Row label='STANDARD' value='ERC-8004' href='https://eips.ethereum.org/EIPS/eip-8004' />
            <Row label='NETWORK' value='Base (8453)' />
            <Row label='PAYMENT' value='x402 (USDC)' />
            <Row label='DISCOVERY' value='on-chain NFT + registration file' />
          </div>
        </div>
      </div>
    </main>
  )
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className='flex items-center justify-between gap-4 border-b border-hlpBorder/30 py-1.5 last:border-0'>
      <span className={sectionTitleClass}>{label}</span>
      {href ? (
        <a href={href} target='_blank' rel='noopener noreferrer' className='text-[10px] text-hlpAccent hover:underline font-mono'>
          {value}
        </a>
      ) : (
        <span className='text-[10px] text-hlpFg font-mono'>{value}</span>
      )}
    </div>
  )
}

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}
