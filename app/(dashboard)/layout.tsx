import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';

// Coach-facing shell. Minimal by design (see DESIGN_DIRECTION.md) — a thin
// top nav, generous white space, no dense sidebar. Auth itself is enforced
// by middleware.ts (Clerk protects everything outside the public-route list);
// this only trims nav items a role can't act on (a 'sales' user can't do
// anything on /campaigns or /analytics, so there's no reason to show them).
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getOrgContext();
  const isAdmin = role === 'admin';
  const isCoach = role === 'coach';
  const canDisputes = hasPermission(role, 'manage_disputes'); // admin, coach, processor
  const canComplaints = hasPermission(role, 'manage_complaints'); // admin, coach, processor
  const canIntake = hasPermission(role, 'manage_intake'); // admin, coach, sales

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4">
          <Link href="/today" className="flex items-center gap-2.5">
            <span className="inline-block h-7 w-7 rounded-full bg-gradient-money shadow-glow-money" />
            <span className="text-[15px] font-medium text-ink">CreditCoachIQ</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm text-muted">
            <Link href="/today" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Today</Link>
            {canIntake && <Link href="/leads" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Leads</Link>}
            <Link href="/caseload" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Caseload</Link>
            {canDisputes && <Link href="/credit-reports" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Credit Reports</Link>}
            {(isAdmin || isCoach) && <Link href="/referral-partners" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Referrals</Link>}
            {canComplaints && <Link href="/compliance/complaints" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Complaints</Link>}
            {(isAdmin || isCoach) && <Link href="/campaigns" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Campaigns</Link>}
            {(isAdmin || isCoach) && <Link href="/templates" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Templates</Link>}
            {isAdmin && <Link href="/analytics" className="rounded-full px-3 py-1.5 hover:bg-line/60 hover:text-ink">Analytics</Link>}
            <span className="ml-2"><UserButton afterSignOutUrl="/" /></span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-8 py-10">{children}</main>
    </div>
  );
}
