'use client'

import { useEffect, useRef, useState } from 'react'

const DENSITY = ' .:-=+*#%@'
const LABEL = '[ PRIVATEER ]'

function buildFrame(rows: number, cols: number, t: number): string[] {
  const frame: string[] = []
  const baseline = Math.floor(rows * 0.35)

  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      const surface =
        baseline +
        Math.sin(c * 0.08 + t * 0.06) * 2.5 +
        Math.sin(c * 0.04 - t * 0.03 + 1.2) * 1.8 +
        Math.sin(c * 0.15 + t * 0.09 + 0.7) * 1.0
      const depth = r - surface

      if (depth < -2) {
        const v = Math.sin(c * 0.3 + t * 0.12 + r * 0.8)
        line += v > 0.88 ? '*' : v > 0.72 ? '+' : v > 0.58 ? '.' : ' '
      } else if (depth < 0) {
        const v = Math.sin(c * 0.2 + t * 0.08 + r * 1.1)
        line += v > 0.3 ? '~' : v > 0 ? '-' : '.'
      } else {
        const i = Math.min(
          DENSITY.length - 1,
          Math.max(0, Math.floor(depth * 0.7 + Math.sin(c * 0.12 + t * 0.04 + r * 0.1) * 1.2)),
        )
        line += DENSITY[i]
      }
    }
    frame.push(line)
  }

  const lr = Math.floor(rows * 0.55)
  const ls = Math.max(0, Math.floor((cols - LABEL.length) / 2))
  if (lr < frame.length) {
    const row = frame[lr]!
    frame[lr] = row.slice(0, ls) + LABEL + row.slice(ls + LABEL.length)
  }

  return frame
}

export function LandingAsciiDisplay({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const [lines, setLines] = useState<string[]>([])
  const tick = useRef(0)

  useEffect(() => {
    const cols = () => (ref.current ? Math.max(40, Math.floor(ref.current.clientWidth / 6.1)) : 80)
    setLines(buildFrame(20, cols(), 0))

    const id = window.setInterval(() => {
      tick.current += 1
      setLines(buildFrame(20, cols(), tick.current))
    }, 80)

    return () => window.clearInterval(id)
  }, [])

  return (
    <pre
      ref={ref}
      className={`overflow-hidden whitespace-pre bg-hlpInverseBg text-[10px] leading-tight text-hlpPanel/85 ${className}`}
      aria-hidden='true'
    >
      {lines.join('\n')}
    </pre>
  )
}
