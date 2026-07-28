import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // CreditCoachIQ design system — see DESIGN_DIRECTION.md (v2: light, white space, money green, Apple-inspired).
        paper: '#FAFAF9',
        ink: '#1D1D1F',
        muted: '#6E6E73',
        line: '#E8E7E3',
        money: { DEFAULT: '#0F9D58', hover: '#0C7A45', tint: '#E6F4EC' },
        // Alert/error accent — used sparingly (validation, expired links, incorrect OTP).
        terra: { DEFAULT: '#C4452C', tint: '#FBEAE6' },
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
