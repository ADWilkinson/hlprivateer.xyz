import Link from 'next/link'
import { ProductPipelineDemo } from './ui/ProductPipelineDemo'

const SITE_URL = 'https://hlprivateer.xyz'
const GITHUB_URL = 'https://github.com/ADWilkinson/hlprivateer.xyz'

const OBSERVATIONS = [
  {
    label: 'signal',
    body: 'new public inputs arrive',
  },
  {
    label: 'estimate',
    body: 'the agent marks a probability',
  },
  {
    label: 'check',
    body: 'fixed rules can block it',
  },
  {
    label: 'record',
    body: 'the floor gets a line',
  },
]

const STEPS = [
  ['01', 'Inputs', 'Timestamped public items enter the buffer.'],
  ['02', 'Estimate', 'The agent returns a probability, side, limit, size, or skip.'],
  ['03', 'Stake limit', 'Kelly sizing and caps reduce the proposal before risk.'],
  ['04', 'Risk checks', 'Fourteen fixed checks can deny the order.'],
  ['05', 'Public record', 'Allowed orders and failures land in the audit log.'],
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
          <div className='pb-6'>
            <div>
              <div className='mb-4 text-[10px] uppercase tracking-[0.22em] text-hlpPanel/65'>
                HIP-4 outcome-market agent // live public floor
              </div>
              <h1 className='max-w-[760px] text-[31px] font-bold uppercase leading-[0.92] tracking-[0.08em] text-hlpPanel sm:text-[58px] lg:text-[78px]'>
                [HL] Privateer
              </h1>
              <p className='mt-5 max-w-[520px] text-[12px] leading-relaxed tracking-wide text-hlpPanel/74 sm:text-[13px]'>
                A public model room for a small trading loop: signals enter,
                the agent estimates probability, fixed checks decide, and the
                floor records only the public trace.
              </p>
              <div className='mt-6 flex flex-wrap gap-3'>
                <Link
                  href='/floor'
                  className='inline-flex h-11 items-center border border-hlpPanel bg-hlpPanel px-5 text-[10px] uppercase tracking-[0.18em] text-hlpFg transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-transparent hover:text-hlpPanel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hlpPanel'
                >
                  Watch the floor
                </Link>
                <a
                  href={GITHUB_URL}
                  target='_blank'
                  rel='noreferrer'
                  className='inline-flex h-11 items-center border border-hlpPanel/35 bg-transparent px-5 text-[10px] uppercase tracking-[0.18em] text-hlpPanel transition-[background-color,border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-hlpPanel hover:bg-hlpPanel/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hlpPanel'
                >
                  View source
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className='border-b border-hlpBorder bg-hlpBg px-4 py-8 sm:px-6 lg:px-8'>
        <div className='mx-auto grid w-full max-w-[1180px] border-y border-hlpBorder md:grid-cols-4'>
          {OBSERVATIONS.map((item, index) => (
            <div key={item.label} className='grid grid-cols-[46px_1fr] border-b border-hlpBorder py-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0'>
              <div className='text-[10px] text-hlpDim'>{String(index + 1).padStart(2, '0')}</div>
              <div>
                <h2 className='text-[13px] uppercase tracking-[0.22em] text-hlpFg'>{item.label}</h2>
                <p className='mt-2 text-[10px] uppercase tracking-[0.16em] text-hlpMuted'>{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className='border-b border-hlpBorder bg-hlpPanel px-4 py-12 sm:px-6 lg:px-8'>
        <div className='mx-auto grid w-full max-w-[1180px] gap-8 lg:grid-cols-[0.8fr_1.2fr]'>
          <div>
            <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>mechanism</div>
            <h2 className='mt-3 max-w-[420px] text-[22px] uppercase leading-tight tracking-[0.14em] text-hlpFg'>
              price is already a probability.
            </h2>
            <p className='mt-4 text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
              HIP-4 outcome contracts already speak in probabilities: a YES price of 0.62
              says the market is leaning 62%. This page watches a second estimate form,
              then shows whether the fixed checks allow it to reach the book.
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
              public window
            </div>
            <pre className='overflow-x-auto text-[10px] leading-[1.7] text-hlpPanel/82'>
{`GET /v1/public/markets
  -> question, yesPrice, pHat (agent estimate), edge, resolutionAt

GET /v1/public/floor
  -> mode, marketsTracked, markets[], tape[]

GET /v1/public/floor-tape
  -> role tape: agent / risk / execution / ops

NOT SHOWN
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
              v1 was a larger discretionary perp desk. This version is narrower:
              one agent call, one risk path, exchange state, public trace.
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
