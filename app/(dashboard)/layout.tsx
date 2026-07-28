import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

// Coach-facing shell. Minimal by design (see DESIGN_DIRECTION.md) — a thin
// top nav, generous white space, no dense sidebar. Auth itself is enforced
// by middleware.ts (Clerk protects everything outside the public-route list).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4">
          <Link href="/caseload" className="flex items-center gap-2.5">
            <span className="inline-block h-7 w-7 rounded-full bg-gradient-money shadow-glow-money" />
            <span className="text-[15px] font-medium text-ink">CreditCoachIQ</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm text-muted">
            <Link href="/caseload" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Caseload</Link>
            <Link href="/credit-reports" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Credit Reports</Link>
            <Link href="/referral-partners" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Referrals</Link>
            <Link href="/campaigns" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Campaigns</Link>
            <Link href="/templates" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Templates</Link>
            <Link href="/analytics" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Analytics</Link>
            <span className="ml-2"><UserButton afterSignOutUrl="/" /></span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-8 py-10">{children}</main>
    </div>
  );
}
