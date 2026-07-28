import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // CreditCoachIQ design system — see DESIGN_DIRECTION.md.
        // v2 (Apple-inspired restraint) base tones, still the canvas:
        paper: '#FAFAF9',
        ink: '#1D1D1F',
        muted: '#6E6E73',
        line: '#E8E7E3',
        money: { DEFAULT: '#0F9D58', hover: '#0C7A45', tint: '#E6F4EC' },
        // Alert/error accent — used sparingly (validation, expired links, incorrect OTP).
        terra: { DEFAULT: '#C4452C', tint: '#FBEAE6' },
        // v3 (richer fintech direction, see DESIGN_DIRECTION.md addendum) —
        // a secondary accent for wealth/AI/premium moments so not everything
        // leans on green, plus a warm highlight for milestone/celebration
        // states and a near-black surface for occasional dark "hero" cards
        // (Mercury/Ramp balance-card pattern).
        iris: { DEFAULT: '#6C5CE7', hover: '#584BC4', tint: '#F1EEFC' },
        gold: { DEFAULT: '#C9A05C', tint: '#F7EFDD' },
        canvas: { dark: '#111113', darkline: 'rgba(255,255,255,0.08)' },
      },
      backgroundImage: {
        'gradient-money': 'linear-gradient(135deg, #16B872 0%, #0B6B3A 100%)',
        'gradient-iris': 'linear-gradient(135deg, #8578F5 0%, #4B3FA8 100%)',
        'gradient-dark': 'linear-gradient(160deg, #1C1D20 0%, #0B0B0C 100%)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,20,20,0.04), 0 12px 28px -16px rgba(20,20,20,0.10)',
        elevated: '0 4px 16px rgba(20,20,20,0.06), 0 24px 48px -20px rgba(20,20,20,0.16)',
        'glow-money': '0 8px 30px -10px rgba(15,157,88,0.45)',
        'glow-iris': '0 8px 30px -10px rgba(108,92,231,0.45)',
      },
      borderRadius: {
        card: '20px',
        control: '14px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
