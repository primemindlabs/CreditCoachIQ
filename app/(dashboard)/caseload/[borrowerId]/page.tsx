'use client';

import { useEffect, useState, useCallback } from 'react';

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
}

interface StackSummary { capitalAvailable: number; activeApplicationCount: number; expiringWithin30Days: { lender_name: string }[]; }
interface Dispute { id: string; bureau: string; letter_body: string; sent_at: string | null; response_status: string; credit_tradelines: { creditor_name: string } | null; }

const STAGES = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off', 'paused', 'exited'];

function currency(n: number): string {
  return (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function ClientDetailPage({ params }: { params: { borrowerId: string } }) {
  const { borrowerId } = params;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [stack, setStack] = useState<StackSummary | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const detail = await fetch(`/api/coach/client/${borrowerId}`).then((r) => r.json());
    setData(detail);
    const [disputesRes, stackData] = await Promise.all([
      detail.enrollment ? fetch(`/api/disputes?enrollment_id=${detail.enrollment.id}`).then((r) => r.json()) : Promise.resolve({ disputes: [] }),
      fetch(`/api/stacking/summary?borrower_id=${borrowerId}`).then((r) => r.json()),
    ]);
    setDisputes(disputesRes.disputes ?? []);
    setStack(stackData);
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

  if (loading || !data) return <p className="text-sm text-muted">Loading…</p>;

  const { borrower, enrollment } = data;

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">{borrower.first_name} {borrower.last_name}</h1>
          <p className="mt-1 text-sm text-muted">{borrower.email ?? 'No email'} · {borrower.phone ?? 'No phone'} · {borrower.plan_tier.replace('_', ' ')}{data.referralPartnerName ? ` · Referred by ${data.referralPartnerName}` : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={placeCall} className="rounded-control bg-money px-4 py-2.5 text-sm font-medium text-white hover:bg-money-hover">Call</button>
          <button onClick={() => portalAction('reissue')} className="rounded-control border border-line px-4 py-2.5 text-sm text-ink hover:border-ink/30">Reissue portal link</button>
          <button onClick={() => portalAction('revoke')} className="rounded-control border border-line px-4 py-2.5 text-sm text-terra hover:border-terra/40">Revoke portal</button>
        </div>
      </div>
      {callStatus && <p className="mb-4 text-sm text-muted">{callStatus}</p>}
      {portalMsg && <p className="mb-4 break-all text-sm text-muted">{portalMsg}</p>}

      <div className="mb-8 rounded-card border border-line bg-white p-6">
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

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-white p-6">
          <p className="text-sm text-muted">Credit score</p>
          <p className="mt-1 text-[24px] font-medium text-ink">{enrollment?.current_score_exp ?? '—'}</p>
          <p className="mt-1 text-sm text-muted">Target: {enrollment?.target_score ?? '—'}</p>
          <p className={`mt-2 text-xs ${enrollment?.croa_disclosure_signed_at ? 'text-money' : 'text-terra'}`}>
            {enrollment?.croa_disclosure_signed_at ? 'CROA signed' : 'CROA not yet signed'}
          </p>
        </div>
        <div className="rounded-card border border-line bg-white p-6">
          <p className="text-sm text-muted">Stacked capital</p>
          <p className="mt-1 text-[24px] font-medium text-money">{stack ? currency(stack.capitalAvailable) : '—'}</p>
          <p className="mt-1 text-sm text-muted">{stack?.activeApplicationCount ?? 0} active lines</p>
        </div>
        <div className="rounded-card border border-line bg-white p-6">
          <p className="text-sm text-muted">Funding status</p>
          <p className="mt-1 text-[24px] font-medium text-ink">{borrower.funding_status ?? '—'}</p>
        </div>
      </div>

      {enrollment && (
        <div className="mb-8 rounded-card border border-line bg-white p-6">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-6">
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
        <div className="rounded-card border border-line bg-white p-6">
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
        <div className="mt-8 rounded-card border border-line bg-white p-6">
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
