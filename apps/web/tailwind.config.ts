import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './public/**/*.{html,svg}',
  ],
  theme: {
    extend: {
      colors: {
        hlpBg: '#f3f0ea',
        hlpBgDark: '#0a1018',
        hlpPanel: '#faf8f3',
        hlpPanelDark: '#111c29',
        hlpSurface: '#f1e7d7',
        hlpSurfaceDark: '#162639',
        hlpFg: '#263343',
        hlpFgDark: '#d9e1ed',
        hlpMuted: '#607080',
        hlpMutedDark: '#8f9eb4',
        hlpDim: '#8a94a1',
        hlpDimDark: '#7c8aa0',
        hlpPositive: '#4b9a87',
        hlpPositiveDark: '#56c4ab',
        hlpWarning: '#c09659',
        hlpWarningDark: '#e1c174',
        hlpNegative: '#b26f78',
        hlpNegativeDark: '#dc8f9b',
        hlpBorder: '#cec4b4',
        hlpBorderDark: '#30425c',
        hlpBorderStrong: '#b4a897',
        hlpBorderStrongDark: '#4a5f78',
        hlpNeutral: '#8a97a6',
        hlpNeutralDark: '#74839a',
      },
      borderRadius: {
        hlp: '12px',
      },
      boxShadow: {
        hlp: '0 8px 30px rgba(20, 28, 43, 0.13)',
        hlpDark: '0 14px 32px rgba(4, 9, 18, 0.72)',
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
          '0%': { backgroundColor: 'rgba(155, 155, 155, 0.12)' },
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
