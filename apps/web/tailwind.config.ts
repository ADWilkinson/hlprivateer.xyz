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
        hlpBg: '#f7f4ee',
        hlpBgDark: '#060a12',
        hlpPanel: '#fbf8f3',
        hlpPanelDark: '#101826',
        hlpSurface: '#f1e9dd',
        hlpSurfaceDark: '#172437',
        hlpFg: '#2f3a4c',
        hlpFgDark: '#dbe5f3',
        hlpMuted: '#5f6e80',
        hlpMutedDark: '#94a8bf',
        hlpDim: '#8a97a6',
        hlpDimDark: '#7d8aa1',
        hlpPositive: '#2f8b67',
        hlpPositiveDark: '#56cfad',
        hlpWarning: '#b48844',
        hlpWarningDark: '#dfbe70',
        hlpNegative: '#b95d69',
        hlpNegativeDark: '#e18d98',
        hlpBorder: '#d7d2cb',
        hlpBorderDark: '#2b3d59',
        hlpBorderStrong: '#b9b0a2',
        hlpBorderStrongDark: '#435774',
      },
      borderRadius: {
        hlp: '12px',
      },
      boxShadow: {
        hlp: '0 12px 32px rgba(18, 31, 45, 0.16)',
        hlpDark: '0 18px 32px rgba(2, 6, 14, 0.72)',
      },
      fontFamily: {
        mono: ['var(--font-hlp-mono)', 'IBM Plex Mono', 'SFMono-Regular', 'ui-monospace', 'monospace'],
      },
      animation: {
        'hlp-fade-up': 'hlp-fade-up 420ms ease-out both',
        'hlp-hot': 'hlp-hot 500ms ease-out',
        'hlp-led': 'hlp-led 2.4s ease-in-out infinite',
        'hlp-cursor': 'hlp-cursor 1s step-end infinite',
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
      },
    },
  },
}

export default config
