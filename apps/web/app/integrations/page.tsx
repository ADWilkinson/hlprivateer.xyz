import Link from 'next/link'
import { cardClass, cardHeaderClass, pageShellClass } from '../ui/ascii-style'

const DATA_SOURCES = [
  {
    title: 'Hyperliquid',
    links: [
      'https://api.hyperliquid.xyz/info',
      'https://api.hyperliquid.xyz/exchange',
      'https://api.hyperliquid.xyz/ws',
    ],
    note: 'Exchange microstructure, price, funding, and orderbook context for core thesis scoring.',
  },
  {
    title: 'CoinGecko + Llama + Sentiment',
    links: [
      'https://api.coingecko.com/api/v3/coins/list',
      'https://api.coingecko.com/api/v3/global',
      'https://api.llama.fi',
      'https://yields.llama.fi',
      'https://api.alternative.me/fng/',
    ],
    note: 'Sector breadth, liquidity, and sentiment enrichment for cross-asset confidence.',
  },
  {
    title: 'Social intelligence (Twitter/X)',
    links: ['https://api.twitter.com/2/tweets/search/recent', 'https://docs.x.com/x-api'],
    note: 'Used for narrative velocity and high-signal flow chatter to adjust thesis confidence.',
  },
]

const OPENCLAW_TOOLS = [
  {
    name: 'market-data skill',
    path: '/home/dappnode/.openclaw/workspace/skills/market-data',
    commands: ['node market-data.js snapshot', 'node market-data.js tvl', 'node market-data.js funding'],
    note: 'Fast structured outputs for coin, TVL, yield, and funding state snapshots.',
  },
  {
    name: 'twitter creds (read-only)',
    path: '/home/dappnode/.openclaw/workspace/.twitter_creds.json',
    commands: ['(agent-runner reads this for intel refresh)', 'supports TWITTER_BEARER_TOKEN override'],
    note: 'Credential material used by the agent-runner intel pack for Twitter/X v2 queries.',
  },
  {
    name: 'sentinel daemon',
    path: '/home/dappnode/.openclaw/workspace/skills/sentinel',
    commands: ['./start.sh', './stop.sh', 'tail -f sentinel.log'],
    note: 'Process and event daemon for threshold alarms that can wake strategic loops.',
  },
]

const AGENT_ENDPOINTS = [
  { method: 'GET', route: '/v1/agent/analysis/latest', purpose: 'Latest analysis report + thesis reasoning.' },
  { method: 'GET', route: '/v1/agent/analysis', purpose: 'Historical analysis and posture records.' },
  { method: 'GET', route: '/v1/agent/data/overview', purpose: 'Market map, risk policy, and aggregated floor telemetry.' },
  { method: 'GET', route: '/v1/agent/copy-trade/signals', purpose: 'Strategy signal payload suitable for downstream systems.' },
  { method: 'GET', route: '/v1/agent/copy-trade/positions', purpose: 'Execution-ready position snapshots and exposure context.' },
  { method: 'GET', route: '/v1/agent/stream/snapshot', purpose: 'Public lightweight stream snapshot for low-cost subscribers.' },
  { method: 'GET', route: '/v1/public/floor-snapshot', purpose: 'Obfuscated public state for dashboard telemetry.' },
]

const OBSERVABILITY = [
  ['AGENT_JOURNAL_ENABLED', 'true'],
  ['AGENT_JOURNAL_PATH', 'journals'],
  ['AGENT_GITHUB_JOURNAL_ENABLED', 'true'],
  ['AGENT_GITHUB_JOURNAL_PATH', 'journals'],
  ['AGENT_GITHUB_JOURNAL_FLUSH_INTERVAL_MS', '600000'],
  ['AGENT_INTEL_ENABLED', 'true'],
  ['AGENT_INTEL_TWITTER_ENABLED', 'true'],
  ['AGENT_INTEL_TWITTER_MAX_RESULTS', '8'],
  ['OPENCLAW_TWITTER_CREDS_PATH', '/home/dappnode/.openclaw/workspace/.twitter_creds.json'],
  ['GITHUB_REPO_OWNER', 'your-org'],
  ['GITHUB_REPO_NAME', 'hlprivateer.xyz'],
  ['GITHUB_JOURNAL_BRANCH', 'main'],
  ['GITHUB_JOURNAL_TIMEOUT_MS', '10000'],
  ['DISCORD_WEBHOOK_ENABLED', 'true'],
  ['DISCORD_WEBHOOK_ACTIONS', 'analysis.report,agent.error,agent.proposal,agent.proposal.invalid,research.report,risk.report,risk.decision,intel.refresh,strategist.directive,universe.selected'],
]

function SourceCard({ title, links, note }: { title: string; links: string[]; note: string }) {
  return (
    <article className={cardClass}>
      <div className={cardHeaderClass}>External source family</div>
      <div className='p-3'>
        <h3 className='text-[11px] uppercase tracking-[0.2em] text-hlpMuted'>{title}</h3>
        <p className='mt-1.5 text-[11px] leading-relaxed text-hlpFg/80'>{note}</p>
        <div className='mt-3 space-y-1 text-[10px]'>
          {links.map((link) => (
            <a
              key={link}
              href={link}
              target='_blank'
              rel='noreferrer'
              className='block rounded-[3px] border border-hlpBorder bg-hlpSurface/35 px-2 py-1 text-hlpAccent transition-colors hover:bg-hlpSurface'
            >
              {link}
            </a>
          ))}
        </div>
      </div>
    </article>
  )
}

function ToolCard({ tool }: { tool: (typeof OPENCLAW_TOOLS)[number] }) {
  return (
    <article className={cardClass}>
      <div className={cardHeaderClass}>OpenClaw integration</div>
      <div className='p-3'>
        <h3 className='text-[11px] uppercase tracking-[0.18em] text-hlpMuted'>{tool.name}</h3>
        <div className='mt-1.5 text-[10px] text-hlpFg/90 break-all'>
          <span className='inline-block bg-hlpSurface/70 px-2 py-1'> {tool.path}</span>
        </div>
        <p className='mt-2 text-[11px] leading-relaxed'>{tool.note}</p>
        <ul className='mt-3 space-y-1 text-[10px]'>
          {tool.commands.map((cmd) => (
            <li key={cmd} className='rounded-[3px] border border-hlpBorder/80 bg-hlpSurface/40 px-2 py-1 font-mono text-hlpMuted'>
              {cmd}
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

export default function IntegrationsPage() {
  return (
    <div className={pageShellClass}>
      <section className='rounded-[6px] border border-hlpBorder bg-hlpInverseBg px-4 py-5 md:px-6'>
        <div className='inline-flex items-center gap-2 border border-hlpBorder bg-hlpPanel/10 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-hlpPanel/70'>
          data, integrations, and crew telemetry stack
        </div>
        <h1 className='mt-3 text-[30px] leading-tight text-hlpPanel'>[HL] PRIVATEER — Integration Atlas</h1>
        <p className='mt-3 max-w-4xl text-sm leading-relaxed text-hlpPanel/80'>
          Complete data and tooling graph for discretionary long/short + pair thesis formation, structured risk
          reporting, and external machine consumption paths. This is the source layer the agents pull from in real time.
        </p>
        <div className='mt-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em]'>
          <Link
            href='/'
            className='inline-flex items-center border border-hlpPanel bg-hlpPanel px-3 py-2 text-hlpBg transition-colors hover:bg-hlpSurface'
          >
            Back to overview
          </Link>
          <Link
            href='/data'
            className='inline-flex items-center border border-hlpPanel/50 bg-hlpPanel/20 px-3 py-2 transition-colors hover:bg-hlpPanel/40'
          >
            Open live floor & tape
          </Link>
        </div>
      </section>

      <section className='grid gap-3 md:grid-cols-2'>
        {DATA_SOURCES.map((source) => (
          <SourceCard key={source.title} title={source.title} links={source.links} note={source.note} />
        ))}
      </section>

      <section className='grid gap-3 xl:grid-cols-2'>
        {OPENCLAW_TOOLS.map((tool) => (
          <ToolCard key={tool.name} tool={tool} />
        ))}
      </section>

      <section className={cardClass}>
        <div className={cardHeaderClass}>x402 / API + agent endpoint map</div>
        <div className='grid gap-2 p-3 sm:grid-cols-2'>
          {AGENT_ENDPOINTS.map((route) => (
            <div
              key={route.route}
              className='rounded-[4px] border border-hlpBorder bg-hlpSurface/30 px-2 py-1.5 text-[11px]'
            >
              <div className='inline-flex items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-hlpMuted'>
                <span className='rounded-sm border border-hlpBorder px-1 py-0.5'>{route.method}</span>
                <span>{route.route}</span>
              </div>
              <p className='mt-1 text-hlpFg'>{route.purpose}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={cardClass}>
        <div className={cardHeaderClass}>journaling + discord alert wiring</div>
        <div className='grid gap-2 p-3 text-[11px] sm:grid-cols-2'>
          {OBSERVABILITY.map(([label, value]) => (
            <div
              key={label}
              className='rounded-[4px] border border-hlpBorder bg-hlpSurface/40 px-2 py-2 break-all'
            >
              <div className='text-[9px] uppercase tracking-[0.16em] text-hlpMuted'>{label}</div>
              <div className='mt-1 text-sm'>{value}</div>
            </div>
          ))}
          <p className='col-span-full text-[11px] text-hlpFg/80 leading-relaxed'>
            Set `DISCORD_WEBHOOK_URL` and `GITHUB_TOKEN` in runtime environment to stream important audit actions into Discord
            and write per-agent journals to a GitHub-backed `AGENT_GITHUB_JOURNAL_PATH`.
            Optional commit batching is controlled by `AGENT_GITHUB_JOURNAL_FLUSH_INTERVAL_MS`
            (set to `0` for immediate append).
            Agent action payloads in `AGENT_RUNNER` are already filtered by severity/action before dispatch.
          </p>
        </div>
      </section>
    </div>
  )
}
