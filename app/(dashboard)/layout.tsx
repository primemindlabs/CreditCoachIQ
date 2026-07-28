import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

// Coach-facing shell. Minimal by design (see DESIGN_DIRECTION.md) — a thin
// top nav, generous white space, no dense sidebar. Auth itself is enforced
// by middleware.ts (Clerk protects everything outside the public-route list).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-5">
          <Link href="/" className="text-[15px] font-medium text-ink">CreditCoachIQ</Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/caseload" className="hover:text-ink">Caseload</Link>
            <Link href="/credit-reports" className="hover:text-ink">Credit Reports</Link>
            <Link href="/referral-partners" className="hover:text-ink">Referrals</Link>
            <Link href="/campaigns" className="hover:text-ink">Campaigns</Link>
            <Link href="/templates" className="hover:text-ink">Templates</Link>
            <Link href="/analytics" className="hover:text-ink">Analytics</Link>
            <UserButton afterSignOutUrl="/" />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-8 py-10">{children}</main>
    </div>
  );
}
