import { AsciiBadge, AsciiTable } from './ascii-kit'
import { cardClass, collapsibleHeaderClass, inverseControlClass, panelBodyPad, sectionTitleClass } from './ascii-style'

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

type X402AgentMaterialsPanelProps = {
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
}

export function X402AgentMaterialsPanel({
  isCollapsed = false,
  onToggle,
  sectionId = 'x402',
}: X402AgentMaterialsPanelProps) {
  const baseUrl = 'https://hlprivateer.xyz'

  const curlCommands = [
    { id: 'curl-llms', command: `curl -L ${baseUrl}/llms.txt`, href: `${baseUrl}/llms.txt` },
    { id: 'curl-spec', command: `curl -L ${baseUrl}/docs/SPEC.md`, href: `${baseUrl}/docs/SPEC.md` },
    { id: 'curl-skills', command: `curl -L ${baseUrl}/skills.md`, href: `${baseUrl}/skills.md` },
    { id: 'curl-agent-doc', command: `curl -L ${baseUrl}/AGENT.md`, href: `${baseUrl}/AGENT.md` },
    { id: 'curl-api', command: `curl -L ${baseUrl}/API.md`, href: `${baseUrl}/API.md` },
    { id: 'curl-x402', command: `curl -L ${baseUrl}/docs/X402_SELLER_QUICKSTART.md`, href: `${baseUrl}/docs/X402_SELLER_QUICKSTART.md` },
  ]

  return (
    <section id='x402-access' className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle x402 panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className={sectionTitleClass}>[HL] PRIVATEER / X402 + AGENTS</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>
            {isCollapsed ? '+' : '\u2212'}
          </span>
          <AsciiBadge tone='inverse'>
            external access
          </AsciiBadge>
        </div>
      </button>

      {!isCollapsed && (
        <div className={`${panelBodyPad} grid gap-4`}>
          <div>
            <div className='mb-2 text-[9px] uppercase tracking-[0.2em] text-hlpDim'>Access summary</div>
            <div className='grid gap-3 text-[11px] leading-relaxed md:grid-cols-2'>
              <p className='text-hlpMuted'>
                The external agent layer can access live floor materials via machine-gated endpoints. Routes are protected through
                x402 payments and dynamic capability checks, then mapped to tiered entitlements.
              </p>
              <p className='text-hlpMuted'>
                Tiering and capability negotiation is resolved via
                {' '}
                <span className='font-mono text-hlpAccent'>POST /v1/agent/handshake</span> and entitlement refresh through
                {' '}
                <span className='font-mono text-hlpAccent'>/v1/agent/unlock/:tier</span>.
              </p>
            </div>
          </div>

          <div className='grid gap-2'>
            <div className='text-[9px] uppercase tracking-[0.14em] text-hlpDim'>Direct curl access</div>
            <div className='rounded-[4px] border border-hlpBorder overflow-hidden'>
              <div className='px-3 py-1.5 text-[8px] uppercase tracking-[0.2em] text-hlpDim bg-hlpSurface border-b border-hlpBorder'>llms / openspec / agents</div>
              <div className='space-y-0.5 px-2 py-2'>
                {curlCommands.map((entry) => (
                  <a
                    key={entry.id}
                    href={entry.href}
                    target='_blank'
                    rel='noreferrer'
                    className='block rounded-[3px] px-2 py-1.5 font-mono text-[10px] break-all text-hlpAccent transition-colors hover:bg-hlpSurface/80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-hlpAccent'
                  >
                    {entry.command}
                  </a>
                ))}
              </div>
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
      )}
    </section>
  )
}
