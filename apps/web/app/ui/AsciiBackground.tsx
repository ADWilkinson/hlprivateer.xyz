'use client'

import { useEffect, useRef } from 'react'

const CHARS = ['.', '\u00B7', '+', '\u00D7', '*', '-', '~', ':', '\u00B0']
const PARTICLE_COUNT = 55
const BASE_SPEED = 0.1
const BASE_OPACITY = 0.045
const FONT_SIZE = 11
const FONT = `${FONT_SIZE}px "IBM Plex Mono", monospace`

interface Particle {
  x: number
  y: number
  char: string
  speed: number
  opacity: number
  drift: number
}

function spawn(w: number, h: number, bottom: boolean): Particle {
  return {
    x: Math.random() * w,
    y: bottom ? h + Math.random() * 20 : Math.random() * h,
    char: CHARS[Math.floor(Math.random() * CHARS.length)]!,
    speed: BASE_SPEED + Math.random() * 0.06,
    opacity: BASE_OPACITY * 0.4 + Math.random() * BASE_OPACITY,
    drift: (Math.random() - 0.5) * 0.02,
  }
}

export function AsciiBackground() {
  const ref = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const raf = useRef(0)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dpr = 1

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    window.addEventListener('resize', resize)

    particles.current = Array.from({ length: PARTICLE_COUNT }, () =>
      spawn(window.innerWidth, window.innerHeight, false),
    )

    const draw = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      ctx.clearRect(0, 0, w, h)
      ctx.font = FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (const p of particles.current) {
        ctx.fillStyle = `rgba(0, 0, 0, ${p.opacity})`
        ctx.fillText(p.char, p.x, p.y)

        p.y -= p.speed
        p.x += p.drift

        if (p.y < -12) {
          Object.assign(p, spawn(w, h, true))
        }
        if (p.x < -10 || p.x > w + 10) {
          Object.assign(p, spawn(w, h, true))
        }
      }

      raf.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf.current)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      className='fixed inset-0 pointer-events-none'
      style={{ zIndex: 0 }}
      aria-hidden='true'
    />
  )
}
