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
        hlpBgDark: '#101a28',
        hlpPanel: '#faf8f3',
        hlpPanelDark: '#182638',
        hlpSurface: '#f1e7d7',
        hlpSurfaceDark: '#1f2f43',
        hlpFg: '#263343',
        hlpFgDark: '#d5dce7',
        hlpMuted: '#607080',
        hlpMutedDark: '#8a98ac',
        hlpDim: '#8a94a1',
        hlpDimDark: '#748195',
        hlpPositive: '#4b9a87',
        hlpPositiveDark: '#6ea29a',
        hlpWarning: '#c09659',
        hlpWarningDark: '#b89d70',
        hlpNegative: '#b26f78',
        hlpNegativeDark: '#ad7f88',
        hlpBorder: '#cec4b4',
        hlpBorderDark: '#36465a',
        hlpBorderStrong: '#b4a897',
        hlpBorderStrongDark: '#55657a',
        hlpNeutral: '#8a97a6',
        hlpNeutralDark: '#78879c',
      },
      borderRadius: {
        hlp: '12px',
      },
      boxShadow: {
        hlp: '0 8px 30px rgba(20, 28, 43, 0.13)',
        hlpDark: '0 14px 32px rgba(11, 19, 31, 0.52)',
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
