'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Overview {
  firstName: string;
  planTier: string;
  journeyStage: string;
  stageSince: string;
  coachName: string | null;
  credit: { currentScore: number | null; targetScore: number | null; status: string } | null;
  stackedCapital: number;
  goals: { id: string; name: string; target_amount: number; progress_amount: number; target_date: string | null }[];
  quiz: { status: string; recommendedTier: string; completedAt: string | null } | null;
  upcomingCall: { id: string; scheduled_at: string; status: string } | null;
  callAllowance: { used: number; total: number; remaining: number };
  unreadMessages: number;
}

interface PlaidAccount { id: string; institution_name: string; status: string; last_synced_at: string | null; }
interface PlaidTx { id: string; amount: number; merchant_name: string | null; category: string | null; posted_at: string; }

const JOURNEY_STAGES = [
  { key: 'credit_coaching', label: 'Credit coaching' },
  { key: 'credit_stacking', label: 'Credit stacking' },
  { key: 'loan_ready', label: 'Loan ready' },
  { key: 'handed_off', label: 'Handed off' },
] as const;

function currency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function PortalOverviewPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [plaidConfigured, setPlaidConfigured] = useState(false);
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<PlaidTx[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ov, plaid] = await Promise.all([
      fetch(`/api/portal/${token}/overview`).then((r) => r.json()),
      fetch(`/api/portal/${token}/plaid/accounts`).then((r) => r.json()),
    ]);
    setData(ov);
    setPlaidConfigured(!!plaid.configured);
    setAccounts(plaid.accounts ?? []);
    setTransactions(plaid.recentTransactions ?? []);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function linkBank() {
    setLinkError(null);
    setLinking(true);
    const res = await fetch(`/api/portal/${token}/plaid/link-token`);
    const linkData = await res.json();
    if (!linkData.configured) {
      setLinking(false);
      setLinkError('Bank linking isn’t enabled yet — ask your coach.');
      return;
    }
    if (linkData.error || !linkData.linkToken) {
      setLinking(false);
      setLinkError(linkData.error ?? 'Could not start bank linking.');
      return;
    }

    // Load Plaid's hosted Link script on demand rather than bundling a
    // client SDK dependency for a feature most orgs won't have keys for yet.
    if (!(window as any).Plaid) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load Plaid'));
        document.body.appendChild(script);
      }).catch(() => setLinkError('Could not load bank linking. Try again.'));
    }

    const plaidHandler = (window as any).Plaid?.create({
      token: linkData.linkToken,
      onSuccess: async (publicToken: string, metadata: any) => {
        await fetch(`/api/portal/${token}/plaid/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken, institutionName: metadata?.institution?.name }),
        });
        setLinking(false);
        load();
      },
      onExit: () => setLinking(false),
    });
    plaidHandler?.open();
  }

  if (loading || !data) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  const stageIndex = JOURNEY_STAGES.findIndex((s) => s.key === data.journeyStage);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[26px] font-medium text-ink">Welcome back, {data.firstName}</h1>
        <p className="mt-1 text-sm text-muted">
          {data.coachName ? `Your coach is ${data.coachName}.` : 'Your coach will be assigned shortly.'}
        </p>
      </div>

      {/* "You are here" journey map */}
      <div className="rounded-card border border-line bg-white p-6">
        <p className="mb-5 text-sm font-medium text-ink">Your journey</p>
        {stageIndex === -1 ? (
          <p className="text-sm text-muted">Your plan is currently {data.journeyStage.replace('_', ' ')}.</p>
        ) : (
          <div className="flex items-center">
            {JOURNEY_STAGES.map((stage, i) => {
              const done = i < stageIndex;
              const current = i === stageIndex;
              return (
                <div key={stage.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium ${
                        current ? 'bg-money text-white' : done ? 'bg-money-tint text-money-hover' : 'bg-line text-muted'
                      }`}
                    >
                      {i + 1}
                    </div>
                    <p className={`mt-2 max-w-[80px] text-center text-xs ${current ? 'font-medium text-ink' : 'text-muted'}`}>{stage.label}</p>
                  </div>
                  {i < JOURNEY_STAGES.length - 1 && <div className={`mx-2 h-px flex-1 ${done ? 'bg-money' : 'bg-line'}`} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.credit && (
          <div className="rounded-card border border-line bg-white p-6">
            <p className="text-sm text-muted">Credit score</p>
            <p className="mt-1 text-[28px] font-medium text-ink">{data.credit.currentScore ?? '—'}</p>
            {data.credit.targetScore && <p className="mt-1 text-sm text-muted">Target: {data.credit.targetScore}</p>}
          </div>
        )}
        <div className="rounded-card border border-line bg-white p-6">
          <p className="text-sm text-muted">Stacked capital</p>
          <p className="mt-1 text-[28px] font-medium text-money">{currency(data.stackedCapital)}</p>
        </div>
      </div>

      {data.goals.length > 0 && (
        <div className="rounded-card border border-line bg-white p-6">
          <p className="mb-4 text-sm font-medium text-ink">Goals</p>
          <div className="space-y-4">
            {data.goals.map((g) => {
              const pct = g.target_amount > 0 ? Math.min(100, Math.round((g.progress_amount / g.target_amount) * 100)) : 0;
              return (
                <div key={g.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-ink">{g.name}</span>
                    <span className="text-muted">{currency(g.progress_amount)} / {currency(g.target_amount)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-money" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-6">
          <p className="text-sm font-medium text-ink">Calls</p>
          <p className="mt-1 text-sm text-muted">{data.callAllowance.remaining} of {data.callAllowance.total} remaining this period</p>
          {data.upcomingCall ? (
            <p className="mt-2 text-sm text-ink">Next: {new Date(data.upcomingCall.scheduled_at).toLocaleString()}</p>
          ) : (
            <Link href={`/portal/${token}/booking`} className="mt-3 inline-block rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">
              Book a call
            </Link>
          )}
        </div>
        <div className="rounded-card border border-line bg-white p-6">
          <p className="text-sm font-medium text-ink">Messages</p>
          <p className="mt-1 text-sm text-muted">{data.unreadMessages > 0 ? `${data.unreadMessages} unread` : 'All caught up'}</p>
          <Link href={`/portal/${token}/messages`} className="mt-3 inline-block rounded-control border border-line px-4 py-2 text-sm text-ink hover:border-ink/30">
            Open messages
          </Link>
        </div>
      </div>

      {data.quiz?.status !== 'completed' && (
        <div className="rounded-card border border-line bg-money-tint p-6">
          <p className="text-sm font-medium text-ink">Quick prep before your call</p>
          <p className="mt-1 text-sm text-muted">Take 2 minutes to complete your intake quiz so your coach can prep for your goals.</p>
          <Link href={`/portal/${token}/quiz`} className="mt-3 inline-block rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">
            Take the quiz
          </Link>
        </div>
      )}

      {/* Bank linking */}
      {plaidConfigured && (
        <div className="rounded-card border border-line bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Linked accounts</p>
            <button onClick={linkBank} disabled={linking} className="rounded-control border border-line px-4 py-2 text-sm text-ink hover:border-ink/30 disabled:opacity-50">
              {linking ? 'Connecting…' : 'Link a bank account'}
            </button>
          </div>
          {linkError && <p className="mb-3 text-sm text-terra">{linkError}</p>}
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">No accounts linked yet. Linking lets your coach see real spending trends alongside your budget.</p>
          ) : (
            <>
              <div className="mb-4 space-y-2">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{a.institution_name}</span>
                    <span className="text-muted">{a.status}</span>
                  </div>
                ))}
              </div>
              {transactions.length > 0 && (
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-xs text-muted">Recent transactions</p>
                  <div className="space-y-1.5">
                    {transactions.slice(0, 8).map((t) => (
                      <div key={t.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{t.merchant_name ?? 'Transaction'}</span>
                        <span className="text-muted">{currency(t.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
