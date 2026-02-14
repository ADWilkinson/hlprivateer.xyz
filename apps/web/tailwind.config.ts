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
        hlpBg: '#efeadf',
        hlpBgDark: '#121924',
        hlpPanel: '#f8f4eb',
        hlpPanelDark: '#1e2a3b',
        hlpSurface: '#f0e4d0',
        hlpSurfaceDark: '#243445',
        hlpFg: '#2f2b24',
        hlpFgDark: '#cfd4dd',
        hlpMuted: '#6d5f52',
        hlpMutedDark: '#8e9ba9',
        hlpDim: '#867a6d',
        hlpDimDark: '#6f7f90',
        hlpPositive: '#5d8978',
        hlpPositiveDark: '#79a89f',
        hlpWarning: '#b98e55',
        hlpWarningDark: '#b59a76',
        hlpNegative: '#a9767d',
        hlpNegativeDark: '#a67f88',
        hlpBorder: '#d6c8b5',
        hlpBorderDark: '#3f5264',
        hlpBorderStrong: '#bea98f',
        hlpBorderStrongDark: '#5f7288',
        hlpNeutral: '#8b7a6b',
        hlpNeutralDark: '#8b98a8',
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
