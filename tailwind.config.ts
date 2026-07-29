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
      // v4 addendum: no decorative backgroundImage gradients. Kept out
      // entirely rather than left unused — the previous gradient-money/
      // gradient-iris/gradient-dark tokens are what made buttons and hero
      // cards read as generic AI-SaaS-template. See DESIGN_DIRECTION.md.
      boxShadow: {
        // Hairline-only at rest — Mercury/Ramp cards don't float, they sit
        // flush against the canvas with a 1px border doing all the work.
        card: '0 1px 2px rgba(10,10,10,0.04)',
        elevated: '0 1px 3px rgba(10,10,10,0.06), 0 8px 24px -12px rgba(10,10,10,0.12)',
      },
      borderRadius: {
        card: '10px',
        control: '6px',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
