import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Inter_Tight, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// v4 design direction (see DESIGN_DIRECTION.md) — Inter Tight instead of
// plain Inter (which every AI-scaffolded SaaS product now uses by default)
// for prose/UI, IBM Plex Mono for every number that matters (scores,
// dollar amounts, percentages). The mono/prose split is the actual
// mechanism behind the Mercury/Ramp "engineered, not decorated" feel —
// treating figures as data typographically distinct from sentences.
const interTight = Inter_Tight({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'CreditCoachIQ',
  description: 'Consumer credit-repair platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${interTight.variable} ${plexMono.variable}`}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
