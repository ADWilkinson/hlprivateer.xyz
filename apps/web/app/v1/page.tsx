import type { Metadata } from 'next'
import Link from 'next/link'

const GITHUB_URL = 'https://github.com/ADWilkinson/hlprivateer.xyz'

export const metadata: Metadata = {
  title: 'v1 — Discretionary Perp Trading Desk (concluded)',
  description:
    'The first HL Privateer experiment: a 7-role LLM crew running discretionary long/short perp trades on Hyperliquid, hard-gated by a deterministic risk engine. Concluded; this is the retrospective.'
}

export default function V1Page() {
  return (
    <main
      id='main-content'
      className='relative z-10 mx-auto flex min-h-[calc(100dvh-52px)] w-full max-w-[800px] flex-col gap-10 px-4 py-12 sm:py-16'
    >
      <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpMuted'>
        EXPERIMENT v1 // CONCLUDED // RETROSPECTIVE
      </div>

      <header className='space-y-3'>
        <h1 className='text-[14px] uppercase tracking-[0.18em] text-hlpFg'>
          v1 — Discretionary perp trading desk
        </h1>
        <p className='text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          A self-hosted, agentic Hyperliquid trading platform. A 7-role LLM crew
          (Claude / Codex CLIs producing structured output) proposed
          discretionary long/short perp trades; a deterministic risk engine
          hard-gated every order; a real-time ASCII trade floor streamed it
          all live. Ran on a single home server behind a Cloudflare Tunnel,
          with x402 pay-per-call endpoints exposing read-only signals to
          external agents.
        </p>
        <p className='text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          v1 ran for several weeks. The architecture worked; the risk engine
          worked; the audit chain worked. The trading primitive (leveraged
          perps) is just not what we wanted to build on top of.
        </p>
      </header>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>What we shipped</div>
        <ul className='space-y-2 pl-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>11 fail-closed risk gates</span> — pure functions, no I/O. Single-failure short-circuit. Any DENY blocked the order; the OMS could not place anything the engine hadn't ALLOWed.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>AI proposes, never executes</span> — agents emitted structured <code>StrategyProposal</code> objects with conviction scores; only the runtime called the OMS.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Fire-and-forget trades</span> — SL/TP submitted on Hyperliquid at entry. No trailing stops, no runtime rebalancing. Either the trade hit a target on-exchange or got flattened by an operator command.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Hash-chained audit trail</span> — SHA-256 prev-hash chain across every proposal, decision, fill, and operator command. Replay-capable end-to-end.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>x402 machine payments</span> — pay-per-call HTTP endpoints (USDC on Base) exposed obfuscated signals, copy-trade data, and AI analysis. Bot-to-bot markets without API keys.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>State machine</span> — INIT → WARMUP → READY ↔ IN_TRADE, with HALT (operator kill-switch) and SAFE_MODE (dependency failure → risk-reducing actions only).
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>ERC-8004 identity</span> — on-chain agent identity for x402 negotiation and reputation.
          </li>
        </ul>
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
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>What we learned</div>
        <ul className='space-y-2 pl-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>The hard-gate pattern is the right shape.</span> An LLM crew producing structured proposals + a deterministic engine that's the only path to ALLOW + an audit trail = a system you can actually reason about. v3 keeps it intact, but collapses the crew into one strategy seam.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Fire-and-forget was correct for perps.</span> Most "smart" runtime rebalancing makes the system fragile in ways the audit trail can't capture. Submit SL/TP at entry, let the exchange handle exits, treat fills as observations.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>7 roles was too many.</span> Scout / Research / Strategist / Scribe blurred together in practice. v3 has one dynamic role (AGT) and deterministic RSK / EXE plumbing below it.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Maintaining parallel state is fragile.</span> v1 had its own positions ledger reconciled against Hyperliquid; the reconciliation was a constant source of drift bugs. v3 reads exchange state directly via <code>clearinghouseState</code> and never claims to know better.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Discretionary perps weren't the venue.</span> Leveraged directional trading on a CLOB is a deeply competitive space. Outcome markets — binary, settled, sentiment-correlated — are a more interesting fit for an LLM-driven edge.
          </li>
        </ul>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>What carried forward to v3</div>
        <ul className='space-y-2 pl-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>The pattern</span> — AI proposes, deterministic gates execute, append-only audit. Re-implemented for binary 0-1 markets in <code>apps/agent</code>.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Pure-function discipline</span> — gates and engine math have zero I/O, deterministic test surface, single-failure short-circuit.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>Privacy by default</span> — public surface exposes pHat / edge / question only. No positions, no notional, no bankroll on the public API.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>The role tape</span> — the public surface keeps the AGT / RSK / EXE / OPS narrative without leaking private trading state.
          </li>
        </ul>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>What got nuked</div>
        <ul className='space-y-2 pl-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>11 perp-specific risk gates</span> (leverage, drawdown%, slippage bps, exposure, etc.) — replaced with 14 outcome-market gates (resolution horizon, challenge window, edge threshold, proposal expiry, ...).
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>The 4 perp-flavoured services</span> (runtime + api + ws-gateway + agent-runner) — collapsed into a single <code>apps/agent</code> process. Outcome trading is event-driven and stateless per proposal; the v1 split was overkill.
          </li>
          <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
            <span className='text-hlpFg'>x402 paid-data endpoints</span> — interesting experiment but a distraction from the trading question. v3 has a smaller free public surface; paid endpoints can come back if there's demand.
          </li>
        </ul>
      </section>

      <section className='space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Source</div>
        <p className='text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          The v1 code is preserved (frozen, excluded from the active workspace) at{' '}
          <a
            href={`${GITHUB_URL}/tree/main/legacy`}
            target='_blank'
            rel='noreferrer'
            className='text-hlpAccent hover:underline'
          >
            <code>/legacy</code>
          </a>{' '}
          in the repository, alongside the v1 docs (<code>SPEC.md</code>,{' '}
          <code>AGENT_RUNNER.md</code>, <code>GO_LIVE.md</code>,{' '}
          <code>X402_SELLER_QUICKSTART.md</code>, <code>RUNBOOK.md</code>,{' '}
          <code>SECURITY.md</code>, <code>API.md</code>). Treat it as a frozen
          reference, not a buildable target — workspace globs intentionally
          skip <code>legacy/</code>.
        </p>
        <Link
          href='/'
          className='inline-block border border-hlpBorder bg-hlpInverseBg px-4 py-2 text-[9px] uppercase tracking-[0.22em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg'
        >
          ← BACK TO v3
        </Link>
      </section>
    </main>
  )
}
