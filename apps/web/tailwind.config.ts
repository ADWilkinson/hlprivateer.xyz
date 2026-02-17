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
        hlpBg: '#fafafa',
        hlpPanel: '#ffffff',
        hlpSurface: '#f0f0f0',
        hlpInverseBg: '#111111',
        hlpDeepBg: '#080808',
        hlpFg: '#000000',
        hlpMuted: '#6f6f6f',
        hlpDim: '#a8a8a8',
        hlpHealthy: '#2D8544',
        hlpPositive: '#0066CC',
        hlpWarning: '#D4652E',
        hlpNegative: '#B5302F',
        hlpBorder: '#e0e0e0',
        hlpBorderStrong: '#000000',
        hlpNeutral: '#000000',
        hlpAccent: '#0066CC',
      },
      fontFamily: {
        mono: ['var(--font-hlp-mono)', 'IBM Plex Mono', 'SFMono-Regular', 'ui-monospace', 'monospace'],
      },
      animation: {
        'hlp-fade-up': 'hlp-fade-up 420ms ease-out both',
        'hlp-fade-up-delay-1': 'hlp-fade-up 420ms ease-out 80ms both',
        'hlp-fade-up-delay-2': 'hlp-fade-up 420ms ease-out 160ms both',
        'hlp-fade-up-delay-3': 'hlp-fade-up 420ms ease-out 240ms both',
        'hlp-hot': 'hlp-hot 500ms ease-out',
        'hlp-led': 'hlp-led 2.4s ease-in-out infinite',
        'hlp-cursor': 'hlp-cursor 1s step-end infinite',
        'hlp-strip': 'hlp-strip 1.2s linear infinite alternate',
        'hlp-scan': 'hlp-scan 4s linear infinite',
        'hlp-wave-scroll': 'hlp-wave-scroll 20s linear infinite',
        'hlp-pulse-ring': 'hlp-pulse-ring 2s ease-out infinite',
      },
      keyframes: {
        'hlp-fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'hlp-hot': {
          '0%': { backgroundColor: 'rgba(0, 0, 0, 0.10)' },
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
        'hlp-scan': {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(100%)' },
        },
        'hlp-wave-scroll': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'hlp-pulse-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
      },
    },
  },
}

export default config
