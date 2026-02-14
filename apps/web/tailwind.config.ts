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
        themeChampagne: '#FDE6C4',
        themeWhite: '#FFFFFF',
        themeOldLace: '#FEF3E2',
        themeSky: '#025BEE',
        themeAqua: '#59F4F4',
        themeCopper: '#DC7F5A',
        themePanNavy: '#27272A',
        themePanSky: '#0072B5',
        themePanChampagne: '#F4EEE8',
        hlpBg: '#F4EEE8',
        hlpBgDark: '#040728',
        hlpPanel: '#FDE6C4',
        hlpPanelDark: '#27272A',
        hlpSurface: '#FEF3E2',
        hlpSurfaceDark: '#0E1421',
        hlpFg: '#27272A',
        hlpFgDark: '#F4EEE8',
        hlpMuted: '#70695f',
        hlpMutedDark: '#97a3b7',
        hlpDim: '#8f8a80',
        hlpDimDark: '#7d8ea2',
        hlpPositive: '#0072B5',
        hlpPositiveDark: '#59F4F4',
        hlpWarning: '#DC7F5A',
        hlpWarningDark: '#EFA080',
        hlpNegative: '#B56F6A',
        hlpNegativeDark: '#E5A39A',
        hlpBorder: '#E4CDAF',
        hlpBorderDark: '#394255',
        hlpBorderStrong: '#D0B18D',
        hlpBorderStrongDark: '#5F7288',
        hlpNeutral: '#9A8772',
        hlpNeutralDark: '#98A8BB',
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
