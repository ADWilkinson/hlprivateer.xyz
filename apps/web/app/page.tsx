import Link from 'next/link'
import { LandingAsciiDisplay } from './ui/LandingAsciiDisplay'

const SITE_URL = 'https://hlprivateer.xyz'
const GITHUB_URL = 'https://github.com/ADWilkinson/hlprivateer.xyz'

const TECH_STACK = [
  'Bun',
  'TypeScript',
  'Next.js',
  'Hyperliquid HIP-4',
  'Zod',
  'JSONL audit',
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
        'A sentiment-driven trading agent for Hyperliquid HIP-4 outcome markets.',
    },
    {
      '@type': 'WebSite',
      name: '[HL] PRIVATEER',
      url: SITE_URL,
      description:
        'A sentiment-driven outcome-market trading experiment on Hyperliquid HIP-4.',
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
      <h1 className='sr-only'>HL Privateer - sentiment-driven outcome market trading on Hyperliquid</h1>

      <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpMuted'>
        EXPERIMENT v3 // SENTIMENT-DRIVEN OUTCOME MARKETS
      </div>

      <LandingAsciiDisplay className='w-full border border-hlpBorder p-2' />

      <section className='w-full space-y-6 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
        <p>
          HL Privateer v3 is an experiment in trading{' '}
          <a
            href='https://blog.quicknode.com/hip4-hyperliquid-outcome-contracts/'
            target='_blank'
            rel='noreferrer'
            className='text-hlpAccent hover:underline'
          >
            HIP-4 outcome contracts
          </a>{' '}
          on{' '}
          <a href='https://hyperliquid.xyz' target='_blank' rel='noreferrer' className='text-hlpAccent hover:underline'>
            Hyperliquid
          </a>{' '}
          using sentiment as the edge signal. Outcome markets are binary — they
          settle to 0 or 1 in USDH and trade between the two on the same CLOB
          as spot/perp. Price is implied probability. So is sentiment, in a
          fuzzier way. The experiment is whether the gap between them is
          tradeable.
        </p>

        <div className='space-y-3'>
          <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>How it works</div>
          <ul className='space-y-2 pl-4'>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Source ingestion</span> — pluggable adapters (news, X, Farcaster, manual fixtures, operator feeds) emit raw sentiment items per market.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Single strategy seam</span> — an operator-supplied LLM reads raw items, market state, and exposure, then emits either skip or one JSON trade proposal.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Probability estimate</span> — the agent proposes p̂, side, limit, size, and thesis; deterministic code immediately clips size by Kelly, stake cap, and remaining gross exposure.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Edge + gates</span> — proposals only survive when edge clears the threshold and every ordered risk gate returns ALLOW.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Fail-closed risk gates</span> — 14 sequential pure-function checks (resolution horizon, challenge window, correlated exposure, stale sentiment, edge threshold, proposal expiry...). Any failure = DENY.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Hyperliquid is the source of truth</span> — positions, equity and fills are read from <code>clearinghouseState</code>; we don't maintain a parallel ledger.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Append-only audit</span> — every proposal, decision, and fill is appended to JSONL at <code>data/audit.jsonl</code>.
            </li>
          </ul>
        </div>
      </section>

      <section className='w-full text-center'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim mb-3'>v3 data flow</div>
        <pre className='inline-block text-left overflow-x-auto border border-hlpBorder bg-hlpInverseBg p-4 text-[9px] leading-[1.6] text-hlpPanel/85'>
{`raw sentiment items
        │
        ▼
+-------------------------------+
| apps/agent orchestrator       |
|                               |
| AGT  StrategyAgent.propose()  |
|      skip | side / pHat / size|
|        │                      |
|        ▼                      |
|      clipSize()               |
|      Kelly + stake + gross cap|
|        │                      |
|        ▼                      |
| RSK  14 fail-closed gates     |
|      first failure = DENY     |
|        │                      |
|        ▼ ALLOW                |
| EXE  OrderRouter.place() ─────────► Hyperliquid HIP-4
|        │                      |
|        ▼                      |
| OPS  JSONL audit + public tape|
+-------------------------------+
        ▲
        │
HyperliquidAccountant reads clearinghouseState`}
        </pre>
      </section>

      <section className='w-full space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Runtime tape (4 roles)</div>
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
              <tr className='border-t border-hlpBorder'>
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Agent</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>AGT</td>
                <td className='px-3 py-1.5'>Propose or skip from market state + raw sentiment.</td>
              </tr>
              <tr className='border-t border-hlpBorder'>
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Risk</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>RSK</td>
                <td className='px-3 py-1.5'>Evaluate clipped proposals via 14 fail-closed gates.</td>
              </tr>
              <tr className='border-t border-hlpBorder'>
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Execution</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>EXE</td>
                <td className='px-3 py-1.5'>Place ALLOWed orders through operator wiring.</td>
              </tr>
              <tr className='border-t border-hlpBorder'>
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Ops</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>OPS</td>
                <td className='px-3 py-1.5'>Mode changes, startup, halt, and resume events.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

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

      <section className='w-full space-y-3 border-t border-hlpBorder pt-8'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Previous experiment</div>
        <p className='text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
          <span className='text-hlpFg'>v1 — Discretionary perp trading desk</span> (concluded). A
          7-role LLM crew that proposed long/short trades on Hyperliquid perps,
          hard-gated by a deterministic risk engine. The pattern (AI proposes,
          deterministic gates execute) carries forward to v3; the perp-specific code is
          archived under{' '}
          <a
            href={`${GITHUB_URL}/tree/main/legacy`}
            target='_blank'
            rel='noreferrer'
            className='text-hlpAccent hover:underline'
          >
            <code>/legacy</code>
          </a>.
        </p>
        <Link
          href='/v1'
          className='inline-block border border-hlpBorder bg-hlpInverseBg px-4 py-2 text-[9px] uppercase tracking-[0.22em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg'
        >
          READ V1 WRITEUP →
        </Link>
      </section>

      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </main>
  )
}
