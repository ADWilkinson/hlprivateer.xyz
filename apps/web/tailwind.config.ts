import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './public/**/*.{html,svg}',
  ],
  theme: {
    extend: {
      colors: {
        hlpBg: 'var(--bg)',
        hlpRaised: 'var(--bg-raised)',
        hlpSurface: 'var(--bg-surface)',
        hlpFg: 'var(--fg)',
        hlpMuted: 'var(--fg-muted)',
        hlpPositive: 'var(--positive)',
        hlpNegative: 'var(--negative)',
        hlpAmber: 'var(--amber)',
      },
      borderColor: {
        hlp: 'var(--border)',
      },
      boxShadow: {
        'hlp-soft': 'var(--panel-shadow)',
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        hlp: 'var(--r)',
      },
    },
  },
}

export default config
