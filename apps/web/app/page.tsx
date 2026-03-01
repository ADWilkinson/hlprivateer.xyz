import { LandingAsciiDisplay } from './ui/LandingAsciiDisplay'

const SITE_URL = 'https://hlprivateer.xyz'
const GITHUB_URL = 'https://github.com/ADWilkinson/hlprivateer.xyz'

const TECH_STACK = [
  'Bun',
  'TypeScript',
  'Next.js',
  'Postgres',
  'Redis',
  'Hyperliquid',
  'x402',
]

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareSourceCode',
      name: 'HL Privateer',
      url: GITHUB_URL,
      codeRepository: GITHUB_URL,
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Bun',
      description:
        'An experiment in running an agentic open fund on Hyperliquid with x402 and LLM agents.',
    },
    {
      '@type': 'WebSite',
      name: '[HL] PRIVATEER',
      url: SITE_URL,
      description:
        'An agentic open fund experiment on Hyperliquid with x402 machine payments and LLM-driven trade proposals.',
      inLanguage: 'en-US',
    },
  ],
}

export default function LandingPage() {
  return (
    <main
      id='main-content'
      className='relative z-10 mx-auto flex min-h-[calc(100dvh-52px)] w-full max-w-[800px] flex-col items-center gap-10 px-4 py-12 sm:py-16'
    >
      <h1 className='sr-only'>HL Privateer - an agentic open fund experiment on Hyperliquid</h1>

      {/* Status */}
      <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpMuted'>
        EXPERIMENT CONCLUDED
      </div>

      {/* ASCII display */}
      <LandingAsciiDisplay className='w-full border border-hlpBorder p-2' />

      {/* Writeup */}
      <section className='w-full space-y-6 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
        <p>
          HL Privateer was an experiment in running an agentic trading desk on{' '}
          <a href='https://hyperliquid.xyz' target='_blank' rel='noreferrer' className='text-hlpAccent hover:underline'>
            Hyperliquid
          </a>
          . A crew of 7 LLM agents (Claude/Codex) proposed discretionary long/short trades with structured
          reasoning. A deterministic risk engine hard-gated every proposal before the OMS could execute.
          The whole thing ran on a single home server behind a Cloudflare Tunnel.
        </p>

        <div className='space-y-3'>
          <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Key ideas</div>
          <ul className='space-y-2 pl-4'>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Fail-closed risk gates</span> — 11 sequential checks as pure functions. No I/O, deterministic. Any failure = DENY.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>AI proposes, never executes</span> — agents output structured proposals with conviction scores. Only the runtime can place orders.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Fire-and-forget trades</span> — SL/TP placed on Hyperliquid at entry. No trailing stops, no runtime rebalancing.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Event-sourced audit trail</span> — hash-chained (SHA-256) audit events across all proposals, decisions, and executions.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>x402 machine payments</span> — pay-per-call API for agent-to-agent data markets. External agents pay USDC on Base to consume signals.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>State machine</span> — INIT, WARMUP, READY, IN_TRADE, HALT, SAFE_MODE. Dependency errors trigger SAFE_MODE (risk-reducing only).
            </li>
          </ul>
        </div>
      </section>

      {/* Architecture diagram */}
      <section className='w-full'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim mb-3'>Data flow</div>
        <pre className='w-full overflow-x-auto border border-hlpBorder bg-hlpInverseBg p-4 text-[9px] leading-[1.6] text-hlpPanel/85'>
{`  Hyperliquid            Agent Runner
  (API + WS)             (7 LLM roles)
      |                       |
      | ticks                 | proposals
      v                       v
  ┌─────────────────────────────────────┐
  │  Runtime                            │
  │                                     │
  │  Market Adapter ──> Risk Engine     │
  │                     (11 checks,     │
  │                      pure fns,      │
  │                      fail-closed)   │
  │                         |           │
  │                   ALLOW | DENY      │
  │                         |           │
  │                        OMS          │
  │                    (place, fill,    │
  │                     reconcile) ───────> Hyperliquid
  │                         |           │
  │  ┌──────────────────────┴────────┐  │
  │  │     Redis Streams (12 typed)  │  │
  │  └───────┬──────────────┬────────┘  │
  └──────────┼──────────────┼───────────┘
             |              |
      ┌──────┴───┐   ┌─────┴──────┐
      │ WS Gate  │   │  REST API  │
      │ (fanout) │   │ (JWT/x402) │
      └────┬─────┘   └─────┬──────┘
           |                |
           v                v
      ┌───────────────────────────┐
      │   ASCII Trade Floor UI    │
      └───────────────────────────┘`}
        </pre>
      </section>

      {/* CTA */}
      <section className='flex flex-col items-center gap-4'>
        <a
          href={GITHUB_URL}
          target='_blank'
          rel='noreferrer'
          className='border border-hlpBorder bg-hlpInverseBg px-6 py-3 text-[9px] uppercase tracking-[0.22em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg'
        >
          VIEW SOURCE
        </a>
      </section>

      {/* Tech stack */}
      <section className='flex flex-wrap items-center justify-center gap-2'>
        {TECH_STACK.map((tech) => (
          <span
            key={tech}
            className='border border-hlpBorder bg-hlpPanel px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-hlpMuted'
          >
            {tech}
          </span>
        ))}
      </section>

      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </main>
  )
}
