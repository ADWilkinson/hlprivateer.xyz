import { AsciiBadge, AsciiTable } from './ascii-kit'
import { cardClass, cardHeaderClass, panelBodyPad, sectionTitleClass } from './ascii-style'

type AgentRouteRow = {
  id: string
  method: string
  route: string
  capability: string
  purpose: string
}

type PriceRow = {
  id: string
  route: string
  price: string
  notes: string
}

const paywallRoutes: AgentRouteRow[] = [
  {
    id: 'route-overview',
    method: 'GET',
    route: '/v1/agent/data/overview',
    capability: 'market.data.read',
    purpose: 'Live dashboard payload + topology + risk snapshot summary',
  },
  {
    id: 'route-insights',
    method: 'GET',
    route: '/v1/agent/insights',
    capability: 'agent.insights.read',
    purpose: 'AI-level floor summary, risk posture, and recent event signals',
  },
  {
    id: 'route-copy-signals',
    method: 'GET',
    route: '/v1/agent/copy-trade/signals',
    capability: 'copy.signals.read',
    purpose: 'Public/decision signals suitable for copy-trade clients',
  },
  {
    id: 'route-copy-positions',
    method: 'GET',
    route: '/v1/agent/copy-trade/positions',
    capability: 'copy.positions.read',
    purpose: 'Target and basket-level position summaries with risk policy',
  },
  {
    id: 'route-analysis-latest',
    method: 'GET',
    route: '/v1/agent/analysis/latest',
    capability: 'analysis.read',
    purpose: 'Most recent analysis log and thesis',
  },
  {
    id: 'route-analysis-history',
    method: 'GET',
    route: '/v1/agent/analysis',
    capability: 'analysis.read',
    purpose: 'Historical analysis messages (paged by server default)',
  },
  {
    id: 'route-stream',
    method: 'GET',
    route: '/v1/agent/stream/snapshot',
    capability: 'stream.read.public',
    purpose: 'Public feed snapshot for lightweight bots/observers',
  },
  {
    id: 'route-positions',
    method: 'GET',
    route: '/v1/agent/positions',
    capability: 'command.positions',
    purpose: 'Current positions used by external agents (redacted)',
  },
  {
    id: 'route-orders',
    method: 'GET',
    route: '/v1/agent/orders',
    capability: 'command.positions',
    purpose: 'Order history and open/closed lifecycle signals',
  },
]

const x402Pricing: PriceRow[] = [
  { id: 'pricing-stream', route: '/v1/agent/stream/snapshot', price: '$0.001', notes: 'entry + heartbeat feed snapshots' },
  { id: 'pricing-analysis-latest', route: '/v1/agent/analysis/latest', price: '$0.005', notes: 'single latest decision payload' },
  { id: 'pricing-analysis-history', route: '/v1/agent/analysis', price: '$0.01', notes: 'historical analysis page cache slice' },
  { id: 'pricing-positions', route: '/v1/agent/positions', price: '$0.01', notes: 'position stream for copy consumers' },
  { id: 'pricing-orders', route: '/v1/agent/orders', price: '$0.01', notes: 'order tape and lifecycle summary' },
  { id: 'pricing-market-data', route: '/v1/agent/data/overview', price: '$0.02', notes: 'risk policy + market map + tape digest' },
  { id: 'pricing-insights', route: '/v1/agent/insights', price: '$0.02', notes: 'AI/agent insight package with risk posture' },
  {
    id: 'pricing-copy-signals',
    route: '/v1/agent/copy-trade/signals',
    price: '$0.03',
    notes: 'signal export for copy-trading partners',
  },
  {
    id: 'pricing-copy-positions',
    route: '/v1/agent/copy-trade/positions',
    price: '$0.03',
    notes: 'copy-focused execution/position summary',
  },
]

export function X402AgentMaterialsPanel() {
  const docLinks = [
    { id: 'api', label: 'API contract + endpoint map', href: 'https://github.com/ADWilkinson/hlprivateer.xyz/blob/main/API.md' },
    { id: 'llms', label: 'llms.txt + agent discovery', href: 'https://github.com/ADWilkinson/hlprivateer.xyz/blob/main/llms.txt' },
    { id: 'skills', label: 'Skills contracts', href: 'https://github.com/ADWilkinson/hlprivateer.xyz/blob/main/skills.md' },
    { id: 'agent', label: 'AGENT.md', href: 'https://github.com/ADWilkinson/hlprivateer.xyz/blob/main/AGENT.md' },
    { id: 'x402', label: 'x402 quickstart', href: 'https://github.com/ADWilkinson/hlprivateer.xyz/blob/main/docs/X402_SELLER_QUICKSTART.md' },
  ]

  return (
    <section id='x402-access' className={cardClass}>
      <div className={cardHeaderClass}>
        <span className={sectionTitleClass}>[HL] PRIVATEER / X402 + AGENTS</span>
        <AsciiBadge tone='neutral' className='text-hlpMuted'>
          external access surface
        </AsciiBadge>
      </div>
      <div className={`${panelBodyPad} grid gap-3`}>
        <div>
          <div className='mb-2 text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>Access summary</div>
          <div className='grid gap-2 text-[11px] md:grid-cols-2'>
            <p>
              The external agent layer can access live floor materials via machine-gated endpoints. Routes are protected through
              x402 payments and dynamic capability checks, then mapped to tiered entitlements.
            </p>
            <p>
              Tiering and capability negotiation is resolved via
              {' '}
              <span className='font-mono'>POST /v1/agent/handshake</span> and entitlement refresh through
              {' '}
              <span className='font-mono'>/v1/agent/unlock/:tier</span>.
            </p>
          </div>
        </div>

        <div className='grid gap-2'>
          <div className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>Operational materials</div>
          <div className='grid gap-2 text-[11px] md:grid-cols-3'>
            {docLinks.map((link) => (
              <a
                key={link.id}
                href={link.href}
                target='_blank'
                rel='noreferrer'
                className='rounded border border-hlpBorder px-2 py-1 text-hlpAccent hover:bg-hlpPanel focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-hlpAccent'
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <AsciiTable
          caption='pay-gated agent routes'
          columns={[
            {
              key: 'method',
              header: 'METHOD',
              align: 'left',
              width: '10%',
              render: (value) => String(value),
            },
            { key: 'route', header: 'ROUTE', align: 'left', width: '35%' },
            { key: 'capability', header: 'CAPABILITY', align: 'left', width: '20%' },
            { key: 'purpose', header: 'PURPOSE', align: 'left', width: '35%' },
          ]}
          data={paywallRoutes}
          emptyText='no routes'
        />

        <AsciiTable
          caption='x402 route pricing'
          columns={[
            { key: 'route', header: 'ROUTE', align: 'left', width: '58%' },
            { key: 'price', header: 'PRICE', align: 'right', width: '12%' },
            { key: 'notes', header: 'NOTES', align: 'left', width: '30%' },
          ]}
          data={x402Pricing}
          emptyText='no pricing data'
        />
      </div>
    </section>
  )
}
