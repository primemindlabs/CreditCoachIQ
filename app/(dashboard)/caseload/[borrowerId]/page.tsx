'use client';

import { useEffect, useState, useCallback } from 'react';
import { Phone, RefreshCw, ShieldOff } from 'lucide-react';
import RadialScore from '@/components/ui/RadialScore';
import Sparkline from '@/components/ui/Sparkline';
import StatCard from '@/components/ui/StatCard';

interface ClientDetail {
  borrower: {
    id: string; first_name: string; last_name: string; email: string | null; phone: string | null;
    plan_tier: string; journey_stage: string; state: string | null; funding_status: string | null;
  };
  enrollment: {
    id: string; status: string; target_score: number; current_score_exp: number | null; current_score_eqx: number | null; current_score_tu: number | null;
    croa_disclosure_signed_at: string | null; mortgage_ready_at: string | null;
  } | null;
  goals: { id: string; title: string; target_amount: number | null; current_amount: number | null; status: string }[];
  openTasks: { id: string; type: string; title: string; due_date: string | null }[];
  recentCalls: { id: string; status: string; duration_seconds: number | null; started_at: string }[];
  referralPartnerName: string | null;
  scoreHistory: { date: string; score: number }[];
}

interface StackSummary { capitalAvailable: number; activeApplicationCount: number; expiringWithin30Days: { lender_name: string }[]; }
interface Dispute { id: string; bureau: string; letter_body: string; sent_at: string | null; response_status: string; credit_tradelines: { creditor_name: string } | null; }
interface BillingInfo {
  configured: boolean;
  subscriptionStatus: string | null;
  lastPaymentFailedAt: string | null;
  lastPaymentFailureReason: string | null;
  paymentRetryCount: number;
  invoices: { id: string; number: string | null; status: string | null; amountDue: number; amountPaid: number; created: string; hostedInvoiceUrl: string | null }[];
}

const STAGES = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off', 'paused', 'exited'];

function currency(n: number): string {
  return (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function ClientDetailPage({ params }: { params: { borrowerId: string } }) {
  const { borrowerId } = params;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [stack, setStack] = useState<StackSummary | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const detail = await fetch(`/api/coach/client/${borrowerId}`).then((r) => r.json());
    setData(detail);
    const [disputesRes, stackData, billingData] = await Promise.all([
      detail.enrollment ? fetch(`/api/disputes?enrollment_id=${detail.enrollment.id}`).then((r) => r.json()) : Promise.resolve({ disputes: [] }),
      fetch(`/api/stacking/summary?borrower_id=${borrowerId}`).then((r) => r.json()),
      fetch(`/api/billing/invoices?borrowerId=${borrowerId}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setDisputes(disputesRes.disputes ?? []);
    setStack(stackData);
    setBilling(billingData);
    setLoading(false);
  }, [borrowerId]);

  useEffect(() => { load(); }, [load]);

  async function placeCall() {
    setCallStatus('Calling…');
    const res = await fetch('/api/coach/dialer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerId }),
    });
    const d = await res.json();
    setCallStatus(res.ok ? 'Call placed — your phone should ring now.' : d.error);
  }

  async function changeStage(toStage: string) {
    setStageBusy(true);
    const res = await fetch('/api/journey/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrower_id: borrowerId, to_stage: toStage }),
    });
    setStageBusy(false);
    if (!res.ok) {
      const d = await res.json();
      setPortalMsg(d.error);
      return;
    }
    load();
  }

  async function portalAction(action: 'revoke' | 'reissue') {
    const res = await fetch('/api/coach/portal-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerId, action }),
    });
    const d = await res.json();
    setPortalMsg(action === 'reissue' && d.portalUrl ? `New link: ${d.portalUrl}` : action === 'revoke' ? 'Portal access revoked.' : d.error ?? null);
  }

  async function approveDispute(id: string) {
    await fetch('/api/disputes/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disputeIds: [id] }),
    });
    load();
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const { borrower, enrollment } = data;
  const scoreValues = data.scoreHistory.map((h) => h.score);

  return (
    <div>
      {/* Hero */}
      <div className="mb-6 overflow-hidden rounded-card bg-gradient-dark p-8 text-white shadow-elevated">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-[28px] font-medium leading-tight">{borrower.first_name} {borrower.last_name}</h1>
            <p className="mt-2 text-sm text-white/60">
              {borrower.email ?? 'No email'} · {borrower.phone ?? 'No phone'} · {borrower.plan_tier.replace('_', ' ')}
              {data.referralPartnerName ? ` · Referred by ${data.referralPartnerName}` : ''}
            </p>
            <p className={`mt-3 text-xs ${enrollment?.croa_disclosure_signed_at ? 'text-money' : 'text-gold'}`}>
              {enrollment?.croa_disclosure_signed_at ? 'CROA signed' : 'CROA not yet signed'}
            </p>
            {scoreValues.length >= 2 && (
              <div className="mt-6">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-white/40">Score trend</p>
                <Sparkline values={scoreValues} color="#16B872" width={180} height={44} />
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={placeCall} className="flex items-center gap-1.5 rounded-control bg-gradient-money px-4 py-2.5 text-sm font-medium text-white shadow-glow-money">
                <Phone size={14} strokeWidth={1.75} /> Call
              </button>
              <button onClick={() => portalAction('reissue')} className="flex items-center gap-1.5 rounded-control border border-white/20 px-4 py-2.5 text-sm text-white hover:bg-white/10">
                <RefreshCw size={14} strokeWidth={1.75} /> Reissue portal link
              </button>
              <button onClick={() => portalAction('revoke')} className="flex items-center gap-1.5 rounded-control border border-white/20 px-4 py-2.5 text-sm text-white hover:bg-white/10">
                <ShieldOff size={14} strokeWidth={1.75} /> Revoke portal
              </button>
            </div>
            {callStatus && <p className="mt-3 text-sm text-white/60">{callStatus}</p>}
            {portalMsg && <p className="mt-3 break-all text-sm text-white/60">{portalMsg}</p>}
          </div>
          <RadialScore score={enrollment?.current_score_exp ?? null} target={enrollment?.target_score ?? null} dark size={148} />
        </div>
      </div>

      <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
        <p className="mb-3 text-sm font-medium text-ink">Journey stage</p>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => changeStage(s)}
              disabled={stageBusy || s === borrower.journey_stage}
              className={`rounded-control border px-3 py-1.5 text-xs ${s === borrower.journey_stage ? 'border-money bg-money-tint text-money-hover' : 'border-line text-ink hover:border-ink/30'}`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Stacked capital" value={stack ? currency(stack.capitalAvailable) : '—'} sub={`${stack?.activeApplicationCount ?? 0} active lines`} accent="money" />
        <StatCard label="Funding status" value={borrower.funding_status ?? '—'} accent="gold" />
      </div>

      {enrollment && (
        <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-4 text-sm font-medium text-ink">Dispute letters</p>
          {disputes.length === 0 ? (
            <p className="text-sm text-muted">No disputes drafted yet.</p>
          ) : (
            <div className="space-y-3">
              {disputes.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                  <span className="text-ink">{d.credit_tradelines?.creditor_name ?? 'Account'} · {d.bureau}</span>
                  {d.sent_at ? (
                    <span className="text-muted">{d.response_status}</span>
                  ) : (
                    <button onClick={() => approveDispute(d.id)} className="rounded-control bg-money px-3 py-1.5 text-xs font-medium text-white hover:bg-money-hover">Approve & mail</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {billing?.configured && (
        <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Billing</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billing.subscriptionStatus === 'past_due' ? 'bg-terra-tint text-terra' : billing.subscriptionStatus === 'active' ? 'bg-money-tint text-money-hover' : 'bg-line text-muted'}`}>
              {billing.subscriptionStatus?.replace('_', ' ') ?? '—'}
            </span>
          </div>
          {billing.lastPaymentFailedAt && (
            <div className="mb-4 rounded-control bg-terra-tint p-4 text-sm text-terra">
              Payment failed {new Date(billing.lastPaymentFailedAt).toLocaleDateString()} ({billing.paymentRetryCount} attempt{billing.paymentRetryCount === 1 ? '' : 's'}). {billing.lastPaymentFailureReason}
            </div>
          )}
          {billing.invoices.length === 0 ? (
            <p className="text-sm text-muted">No invoices yet.</p>
          ) : (
            <div className="space-y-2">
              {billing.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                  <span className="text-ink">{new Date(inv.created).toLocaleDateString()} {inv.number ? `· ${inv.number}` : ''}</span>
                  <span className="text-muted">{currency(inv.amountPaid || inv.amountDue)} · {inv.status}</span>
                  {inv.hostedInvoiceUrl && (
                    <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-money hover:underline">View</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 text-sm font-medium text-ink">Goals</p>
          {data.goals.length === 0 ? <p className="text-sm text-muted">No goals set.</p> : (
            <div className="space-y-2">
              {data.goals.map((g) => (
                <div key={g.id} className="flex justify-between text-sm">
                  <span className="text-ink">{g.title}</span>
                  <span className="text-muted">{currency(g.current_amount ?? 0)} / {g.target_amount ? currency(g.target_amount) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 text-sm font-medium text-ink">Open tasks</p>
          {data.openTasks.length === 0 ? <p className="text-sm text-muted">Nothing open.</p> : (
            <div className="space-y-2">
              {data.openTasks.map((t) => (
                <div key={t.id} className="flex justify-between text-sm">
                  <span className="text-ink">{t.title}</span>
                  <span className="text-muted">{t.due_date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.recentCalls.length > 0 && (
        <div className="mt-8 rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 text-sm font-medium text-ink">Recent calls</p>
          <div className="space-y-2">
            {data.recentCalls.map((c) => (
              <div key={c.id} className="flex justify-between text-sm">
                <span className="text-ink">{new Date(c.started_at).toLocaleString()}</span>
                <span className="text-muted">{c.status}{c.duration_seconds ? ` · ${Math.round(c.duration_seconds / 60)}m` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
