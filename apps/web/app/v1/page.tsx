import type { Metadata } from 'next'
import Link from 'next/link'

const GITHUB_URL = 'https://github.com/ADWilkinson/hlprivateer.xyz'

export const metadata: Metadata = {
  title: 'v1 — Discretionary Perp Trading Desk (concluded)',
  description:
    'The first HL Privateer experiment: a 7-role LLM crew running discretionary long/short perp trades on Hyperliquid, hard-gated by a deterministic risk engine.'
}

export default function V1Page() {
  return (
    <main
      id='main-content'
      className='relative z-10 mx-auto flex min-h-[calc(100dvh-52px)] w-full max-w-[800px] flex-col gap-10 px-4 py-12 sm:py-16'
    >
      <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpMuted'>
        EXPERIMENT v1 // CONCLUDED
      </div>

      <header className='space-y-3'>
        <h1 className='text-[14px] uppercase tracking-[0.18em] text-hlpFg'>
          v1 — Discretionary perp trading desk
        </h1>
        <p className='text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          A self-hosted, agentic Hyperliquid trading platform. A 7-role LLM crew
          (Claude/Codex) proposed discretionary long/short trades; a
          deterministic risk engine hard-gated every order; an ASCII trade
          floor streamed it all live. Ran on a single home server behind a
          Cloudflare Tunnel.
        </p>
      </header>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Why concluded</div>
        <ul className='space-y-2 pl-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            HIP-4 changed the surface area. Outcome contracts settle 0/1 in USDH on the same CLOB — the trading primitive is meaningfully different from leveraged perps.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            The pattern was right; the perp-specific code wasn't the point. v2 keeps "AI proposes, deterministic risk gates, hash-chained audit" and rebuilds the gates and sizing for binary 0–1 markets.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            7 roles → 3 roles. Sentiment-derived probability is a narrower job than full discretionary regime analysis.
          </li>
        </ul>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>v1 highlights</div>
        <ul className='space-y-2 pl-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Fail-closed risk gates</span> — 11 sequential checks as pure functions. No I/O, deterministic. Any failure = DENY.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>AI proposes, never executes</span> — agents output structured proposals with conviction scores. Only the runtime placed orders.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Fire-and-forget trades</span> — SL/TP placed on Hyperliquid at entry. No trailing stops, no runtime rebalancing.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Event-sourced audit trail</span> — hash-chained (SHA-256) audit events across all proposals, decisions, and executions.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>x402 machine payments</span> — pay-per-call API for agent-to-agent data markets. External agents paid USDC on Base to consume signals.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>State machine</span> — INIT, WARMUP, READY, IN_TRADE, HALT, SAFE_MODE. Dependency errors triggered SAFE_MODE (risk-reducing only).
          </li>
        </ul>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>v1 architecture</div>
        <pre className='inline-block w-full overflow-x-auto border border-hlpBorder bg-hlpInverseBg p-4 text-[9px] leading-[1.6] text-hlpPanel/85'>
{`Hyperliquid               Agent Runner
(API + WS)                (7 LLM roles)
    |                          |
    | ticks                    | proposals
    v                          v
+--------------------------------------------+
| Runtime                                    |
|                                            |
| Market Adapter ----> Risk Engine           |
|                      (11 checks,           |
|                       pure fns,            |
|                       fail-closed)         |
|                          |                 |
|                    ALLOW | DENY            |
|                          |                 |
|                         OMS -----------------> Hyperliquid
|                     (place, fill,          |
|                      reconcile)            |
|                          |                 |
| +------------------------+---------------+ |
| |       Redis Streams (12 typed)         | |
| +--------+-------------------+-----------+ |
+----------+-------------------+-------------+
           |                   |
    +------+-----+      +-----+------+
    |  WS Gate   |      |  REST API  |
    |  (fanout)  |      | (JWT/x402) |
    +------+-----+      +-----+------+
           |                  |
           v                  v
    +---------------------------------+
    |     ASCII Trade Floor UI        |
    +---------------------------------+`}
        </pre>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>v1 crew (7 roles)</div>
        <div className='border border-hlpBorder'>
          <table className='w-full text-[10px] tracking-wide text-hlpMuted'>
            <thead className='bg-hlpInverseBg text-hlpPanel/85'>
              <tr>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-left'>ROLE</th>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-left'>CODE</th>
                <th className='px-3 py-1.5 text-left'>JOB</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Scout', 'SCT', 'Tick collection, feed freshness, watchlist'],
                ['Research', 'RCH', 'Regime analysis, macro context, trade hypotheses'],
                ['Risk', 'RSK', 'Explains risk posture (advisory; hard-gated by engine)'],
                ['Strategist', 'STR', 'Proposes long/short directives with sizing, SL/TP'],
                ['Execution', 'EXE', 'Transforms plans into structured StrategyProposal orders'],
                ['Scribe', 'SCR', 'Audit narrative synthesis per proposal'],
                ['Ops', 'OPS', 'Service health, floor stability, auto-halt watchdog']
              ].map(([role, code, job]) => (
                <tr key={code} className='border-t border-hlpBorder'>
                  <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>{role}</td>
                  <td className='border-r border-hlpBorder px-3 py-1.5'>{code}</td>
                  <td className='px-3 py-1.5'>{job}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Source</div>
        <p className='text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          The v1 code is preserved (frozen, excluded from the active workspace) under{' '}
          <a
            href={`${GITHUB_URL}/tree/main/legacy`}
            target='_blank'
            rel='noreferrer'
            className='text-hlpAccent hover:underline'
          >
            <code>/legacy</code>
          </a>{' '}
          in the repository.
        </p>
        <Link
          href='/'
          className='inline-block border border-hlpBorder bg-hlpInverseBg px-4 py-2 text-[9px] uppercase tracking-[0.22em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg'
        >
          ← BACK TO v2
        </Link>
      </section>
    </main>
  )
}
