import Link from 'next/link'
import { ProductPipelineDemo } from './ui/ProductPipelineDemo'

const SITE_URL = 'https://hlprivateer.xyz'
const GITHUB_URL = 'https://github.com/ADWilkinson/hlprivateer.xyz'

const OUTCOMES = [
  {
    label: 'Strategy stays swappable',
    body: 'The only dynamic seam is `StrategyAgent.propose()`: an operator-supplied LLM returns skip or one structured trade proposal.',
  },
  {
    label: 'Risk stays deterministic',
    body: 'Kelly clipping, exposure caps, resolution windows, liquidity checks, and 14 ordered gates remain pure functions.',
  },
  {
    label: 'Public view stays private',
    body: 'The floor exposes mode, markets, pHat, edge, and role tape while hiding positions, notional, raw signals, and thesis.',
  },
]

const STEPS = [
  ['01', 'Raw sentiment', 'News, X, Farcaster, fixtures, and operator feeds arrive as timestamped market items.'],
  ['02', 'Agent proposal', 'The strategist reads market state + recent items and emits pHat, side, size, limit, or skip.'],
  ['03', 'Deterministic clip', 'Stake is capped by Kelly, per-market limits, and remaining gross exposure before risk eval.'],
  ['04', 'Fail-closed gates', 'Fourteen checks run cheapest-first. First failure returns DENY with observed threshold details.'],
  ['05', 'Execution + audit', 'Only ALLOW reaches the router. Proposal, decision, fill, and failure events append to JSONL.'],
]

const TECH_STACK = ['Bun', 'TypeScript', 'Next.js', 'Hyperliquid HIP-4', 'Zod', 'JSONL audit']

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
      '@type': 'WebApplication',
      name: '[HL] PRIVATEER',
      url: SITE_URL,
      applicationCategory: 'FinanceApplication',
      description:
        'A transparent public floor for a sentiment-driven HIP-4 outcome-market trading agent.',
      inLanguage: 'en-US',
    },
  ],
}

export default function LandingPage() {
  return (
    <main id='main-content' className='relative z-10 w-full'>
      <section className='relative min-h-[calc(100svh-120px)] overflow-hidden border-b border-hlpBorder bg-hlpDeepBg text-hlpPanel'>
        <ProductPipelineDemo />
        <div
          className='absolute inset-x-0 bottom-0 z-[1] h-[55%] bg-gradient-to-t from-hlpDeepBg via-hlpDeepBg/90 to-transparent'
          aria-hidden='true'
        />
        <div className='relative z-10 mx-auto flex min-h-[calc(100svh-120px)] w-full max-w-[1180px] flex-col justify-end px-4 pb-10 pt-20 sm:px-6 lg:px-8'>
          <div className='max-w-[760px] pb-6'>
            <div className='mb-4 text-[10px] uppercase tracking-[0.22em] text-hlpPanel/65'>
              HIP-4 outcome-market agent // live public floor
            </div>
            <h1 className='text-[30px] font-bold uppercase leading-[0.98] tracking-[0.08em] text-hlpPanel sm:text-[52px] lg:text-[66px]'>
              [HL] Privateer
            </h1>
            <p className='mt-5 max-w-[640px] text-[12px] leading-relaxed tracking-wide text-hlpPanel/78 sm:text-[13px]'>
              A self-hosted trading system where sentiment becomes a probability estimate,
              an LLM proposes, deterministic gates decide, and the public floor shows the
              whole pipeline without leaking private trading state.
            </p>
            <div className='mt-6 flex flex-wrap gap-3'>
              <Link
                href='/floor'
                className='inline-flex h-11 items-center border border-hlpPanel bg-hlpPanel px-5 text-[10px] uppercase tracking-[0.18em] text-hlpFg transition-colors hover:bg-transparent hover:text-hlpPanel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hlpPanel'
              >
                Watch the floor
              </Link>
              <a
                href={GITHUB_URL}
                target='_blank'
                rel='noreferrer'
                className='inline-flex h-11 items-center border border-hlpPanel/35 bg-transparent px-5 text-[10px] uppercase tracking-[0.18em] text-hlpPanel transition-colors hover:border-hlpPanel hover:bg-hlpPanel/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hlpPanel'
              >
                View source
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className='border-b border-hlpBorder bg-hlpBg px-4 py-10 sm:px-6 lg:px-8'>
        <div className='mx-auto grid w-full max-w-[1180px] gap-4 md:grid-cols-3'>
          {OUTCOMES.map((item) => (
            <article key={item.label} className='border border-hlpBorder bg-hlpPanel p-4'>
              <h2 className='text-[11px] uppercase tracking-[0.18em] text-hlpFg'>{item.label}</h2>
              <p className='mt-3 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className='border-b border-hlpBorder bg-hlpPanel px-4 py-12 sm:px-6 lg:px-8'>
        <div className='mx-auto grid w-full max-w-[1180px] gap-8 lg:grid-cols-[0.8fr_1.2fr]'>
          <div>
            <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>How it works</div>
            <h2 className='mt-3 text-[18px] uppercase tracking-[0.14em] text-hlpFg'>
              Built to be inspected while it runs.
            </h2>
            <p className='mt-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
              HL Privateer trades binary outcome contracts where price is implied probability.
              The product idea is simple: compare market probability to an agent's sentiment-derived
              pHat, then let deterministic safety machinery decide whether a proposal is allowed
              to reach Hyperliquid.
            </p>
          </div>
          <ol className='border border-hlpBorder'>
            {STEPS.map(([number, label, body]) => (
              <li key={number} className='grid border-b border-hlpBorder last:border-b-0 sm:grid-cols-[72px_180px_1fr]'>
                <div className='border-b border-hlpBorder bg-hlpInverseBg px-3 py-3 text-[10px] text-hlpPanel/85 sm:border-b-0 sm:border-r'>
                  {number}
                </div>
                <div className='border-b border-hlpBorder px-3 py-3 text-[10px] uppercase tracking-[0.16em] text-hlpFg sm:border-b-0 sm:border-r'>
                  {label}
                </div>
                <div className='px-3 py-3 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
                  {body}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className='bg-hlpBg px-4 py-12 sm:px-6 lg:px-8'>
        <div className='mx-auto grid w-full max-w-[1180px] gap-6 lg:grid-cols-[1fr_340px]'>
          <div className='border border-hlpBorder bg-hlpInverseBg p-4 text-hlpPanel'>
            <div className='mb-3 text-[10px] uppercase tracking-[0.2em] text-hlpPanel/55'>
              public API surface
            </div>
            <pre className='overflow-x-auto text-[10px] leading-[1.7] text-hlpPanel/82'>
{`GET /v1/public/markets
  -> question, yesPrice, pHat, edge, resolutionAt

GET /v1/public/floor
  -> mode, marketsTracked, markets[], tape[]

GET /v1/public/floor-tape
  -> AGT / RSK / EXE / OPS narrative

PRIVATE BY DESIGN
  positions, bankroll, notional, raw signals, thesis`}
            </pre>
          </div>
          <aside className='border border-hlpBorder bg-hlpPanel p-4'>
            <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>Stack</div>
            <div className='mt-4 flex flex-wrap gap-2'>
              {TECH_STACK.map((tech) => (
                <span
                  key={tech}
                  className='border border-hlpBorder bg-hlpBg px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-hlpMuted'
                >
                  {tech}
                </span>
              ))}
            </div>
            <p className='mt-5 border-t border-hlpBorder pt-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
              v1 was a discretionary perp desk. v3 is the tighter product: one agent seam,
              one process, Hyperliquid as source of truth, and a public interface that
              makes the control flow visible.
            </p>
            <Link
              href='/v1'
              className='mt-4 inline-flex h-9 items-center border border-hlpBorder bg-hlpInverseBg px-3 text-[9px] uppercase tracking-[0.18em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-focused-foreground)]'
            >
              Read v1 writeup
            </Link>
          </aside>
        </div>
      </section>

      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </main>
  )
}
