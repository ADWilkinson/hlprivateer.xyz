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
  'Redis Streams',
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
        EXPERIMENT v2 // SENTIMENT-DRIVEN OUTCOME MARKETS
      </div>

      <LandingAsciiDisplay className='w-full border border-hlpBorder p-2' />

      <section className='w-full space-y-6 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
        <p>
          HL Privateer v2 is an experiment in trading{' '}
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
              <span className='text-hlpFg'>Sentinel ingestion</span> — pluggable adapters (news, X, Farcaster, Polymarket cross-reference) emit raw items per market.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>LLM scoring</span> — Claude/Codex score each item to {'{polarity, confidence}'} ∈ [-1,1] × [0,1]. Heuristic fallback for dev.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Probability estimate</span> — weighted aggregation pulls a Bayesian-style estimate p̂ from the market price prior toward sentiment.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Edge + Kelly</span> — proposals only fire when |p̂ − price| clears the edge threshold; size is Kelly-fraction × bankroll, capped per-market and per-cluster.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Fail-closed risk gates</span> — 13 sequential pure-function checks (resolution horizon, challenge window, correlated exposure, stale sentiment, edge threshold...). Any failure = DENY.
            </li>
            <li className='before:content-[">_"] before:mr-2 before:text-hlpDim'>
              <span className='text-hlpFg'>Hash-chained audit</span> — every estimate, proposal, decision, and fill is appended to <code>hlpv2.audit</code> with SHA-256 prev-hash chaining.
            </li>
          </ul>
        </div>
      </section>

      <section className='w-full text-center'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim mb-3'>v2 data flow</div>
        <pre className='inline-block text-left overflow-x-auto border border-hlpBorder bg-hlpInverseBg p-4 text-[9px] leading-[1.6] text-hlpPanel/85'>
{`news/x/farcaster ──┐
                   │  raw items
                   ▼
            +-------------------+
            |   apps/sentinel   |
            |  (LLM scorer)     |
            +---------+---------+
                      │ SentimentSignal
                      ▼
                hlpv2.sentiment  (Redis Streams)
                      │
                      ▼
        +---------------------------------+
        |          apps/oracle            |
        |                                 |
        |  SNT  → ProbabilityEstimate     |
        |    │                            |
        |    ▼                            |
        |  EXE  → OutcomeProposal         |
        |    │                            |
        |    ▼                            |
        |  RSK  → outcome-risk.evaluate() |
        |    │                            |
        |    ▼  ALLOW                     |
        |  EXE  → router.place()  ────────────► Hyperliquid HIP-4
        |    │                            |
        |    ▼                            |
        |  hlpv2.{fills,audit}            |
        +---------------------------------+`}
        </pre>
      </section>

      <section className='w-full space-y-3'>
        <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Agent crew (3 roles)</div>
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
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Sentinel</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>SNT</td>
                <td className='px-3 py-1.5'>Aggregate sentiment signals → ProbabilityEstimate.</td>
              </tr>
              <tr className='border-t border-hlpBorder'>
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Risk</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>RSK</td>
                <td className='px-3 py-1.5'>Evaluate proposals via fail-closed gates. Hard-gate.</td>
              </tr>
              <tr className='border-t border-hlpBorder'>
                <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>Execution</td>
                <td className='border-r border-hlpBorder px-3 py-1.5'>EXE</td>
                <td className='px-3 py-1.5'>Build proposals from estimates; place ALLOW'd orders.</td>
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
          deterministic gates execute) ports to v2; the perp-specific code is
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
