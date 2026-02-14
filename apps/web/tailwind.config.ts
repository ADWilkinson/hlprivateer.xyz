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
        themePanNavy: '#27272A',
        themePanSky: '#0072B5',
        themePanChampagne: '#F4EEE8',
        hlpBg: '#F4EEE8',
        hlpBgDark: '#27272A',
        hlpPanel: '#F4EEE8',
        hlpPanelDark: '#27272A',
        hlpSurface: '#F4EEE8',
        hlpSurfaceDark: '#27272A',
        hlpFg: '#27272A',
        hlpFgDark: '#F4EEE8',
        hlpMuted: '#27272A',
        hlpMutedDark: '#F4EEE8',
        hlpDim: '#27272A',
        hlpDimDark: '#F4EEE8',
        hlpPositive: '#0072B5',
        hlpPositiveDark: '#0072B5',
        hlpWarning: '#27272A',
        hlpWarningDark: '#27272A',
        hlpNegative: '#0072B5',
        hlpNegativeDark: '#0072B5',
        hlpBorder: '#0072B5',
        hlpBorderDark: '#0072B5',
        hlpBorderStrong: '#27272A',
        hlpBorderStrongDark: '#0072B5',
        hlpNeutral: '#27272A',
        hlpNeutralDark: '#F4EEE8',
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
