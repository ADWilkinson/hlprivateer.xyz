import { AsciiCard } from 'react-ascii-ui'

type FloorFooterProps = {
  apiEndpoint: string
}

export function FloorFooter({ apiEndpoint }: FloorFooterProps) {
  return (
    <AsciiCard title='ACCESS LANE' className='floor-footer' style={{ padding: '10px 14px', backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border)' }}>
      <div className='footer-line'>
        <span className='footer-sep'>───</span>
        <span className='footer-text'>x402 agent access</span>
        <span className='footer-sep'>───</span>
      </div>
      <div className='footer-url'>{apiEndpoint}</div>
    </AsciiCard>
  )
}
