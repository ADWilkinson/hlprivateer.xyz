'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type AsciiGridFrame = {
  seed: number
  rows: string[]
}

const SEGMENTS = ['_', '─', '│', '┌', '┐', '└', '┘', '╱', '╲', '◢', '◣', '◤', '◥', '▀', '▄', '█']
const OVERLAY = [' ', '.', ':', '◦', '·', '+', '-', '*', '✶', '✺']

function buildFrame(rows = 22, cols = 62, seed = 0): AsciiGridFrame {
  const frame: string[] = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      const mix = (r * 31 + c * 17 + Math.floor(seed * 99)) % 1000
      const wave = Math.sin((seed * 0.18 + c / 8) + Math.cos(r / 6)) + Math.cos(seed * 0.09 + r / 7)
      const drift = ((c % 7) - 3) * 0.16
      const jitter = Math.sin(seed + r * 0.5 + c * 1.2) + drift

      const metric = (mix % 100) / 100
      const active = metric * metric * 2 + jitter * 0.08 + wave * 0.12

      if (active > 0.72) {
        line += SEGMENTS[Math.floor(Math.abs(Math.sin(active * 31 + seed * 0.02 + r * 0.11) * 100) % SEGMENTS.length)]
      } else if (active > 0.45) {
        line += OVERLAY[Math.floor(Math.abs(Math.cos((active + 0.17) * 29 + c * 0.7) * 100) % OVERLAY.length)]
      } else if (active > 0.28) {
        line += '.'
      } else if ((r + c + Math.floor(seed)) % 29 === 0) {
        line += '·'
      } else {
        line += ' '
      }
    }
    frame.push(line)
  }

  return {
    seed,
    rows: frame.map((line, index) => {
      const highlight = Math.floor((index + Math.floor(seed / 9)) % 4)
      if (highlight === 1) {
        return line.replace(/ /g, '·')
      }
      if (highlight === 2) {
        return line
      }
      return line
    }),
  }
}

function labelFrame(rows: string[]): string[] {
  const next = [...rows]
  const title = ' [ 16-SEGMENT CORE ] '
  if (next.length >= 2) {
    const row = Math.floor(next.length / 2)
    const start = Math.max(0, Math.floor((next[row]?.length ?? 0) / 2 - title.length / 2))
    const safeRow = next[row] ?? ''
    next[row] = `${safeRow.slice(0, start)}${title}${safeRow.slice(start + title.length)}`
  }
  return next
}

function useAsciiMatrix(rows = 18, cols = 48, speedMs = 130) {
  const [frame, setFrame] = useState(buildFrame(rows, cols, 0))
  const frameSeed = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      frameSeed.current += 1
      const next = buildFrame(rows, cols, frameSeed.current)
      setFrame(next)
    }, speedMs)

    return () => window.clearInterval(timer)
  }, [cols, rows, speedMs])

  return frame
}

type LandingAsciiDisplayProps = {
  rows?: number
  cols?: number
  speedMs?: number
  className?: string
}

export function LandingAsciiDisplay({
  rows = 18,
  cols = 48,
  speedMs = 120,
  className = '',
}: LandingAsciiDisplayProps) {
  const frame = useAsciiMatrix(rows, cols, speedMs)

  const lines = useMemo(() => labelFrame(frame.rows), [frame.rows])

  return (
    <pre
      className={`whitespace-pre text-[10px] leading-tight text-hlpPanel/85 ${className}`}
      aria-hidden='true'
    >
      {lines.join('\n')}
    </pre>
  )
}
