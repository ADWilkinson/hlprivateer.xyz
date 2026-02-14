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
        themePanNavy: '#27272A',
        themePanSky: '#0072B5',
        themePanChampagne: '#F4EEE8',
        hlpBg: '#F4EEE8',
        hlpPanel: '#F4EEE8',
        hlpSurface: '#F4EEE8',
        hlpFg: '#27272A',
        hlpMuted: '#27272A',
        hlpDim: '#27272A',
        hlpPositive: '#0072B5',
        hlpWarning: '#DC7F5A',
        hlpNegative: '#59F4F4',
        hlpBorder: '#000000',
        hlpBorderStrong: '#000000',
        hlpNeutral: '#27272A',
      },
      borderRadius: {
        hlp: '12px',
      },
      boxShadow: {
        hlp: '0 8px 30px rgba(39, 39, 42, 0.13)',
      },
      fontFamily: {
        mono: ['var(--font-hlp-mono)', 'IBM Plex Mono', 'SFMono-Regular', 'ui-monospace', 'monospace'],
      },
      animation: {
        'hlp-fade-up': 'hlp-fade-up 420ms ease-out both',
        'hlp-hot': 'hlp-hot 500ms ease-out',
        'hlp-led': 'hlp-led 2.4s ease-in-out infinite',
        'hlp-cursor': 'hlp-cursor 1s step-end infinite',
        'hlp-strip': 'hlp-strip 1.2s linear infinite alternate',
      },
      keyframes: {
        'hlp-fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'hlp-hot': {
          '0%': { backgroundColor: 'rgba(39, 39, 42, 0.12)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'hlp-led': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'hlp-cursor': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'hlp-strip': {
          from: { filter: 'brightness(1)' },
          to: { filter: 'brightness(0.88)' },
        },
      },
    },
  },
}

export default config
