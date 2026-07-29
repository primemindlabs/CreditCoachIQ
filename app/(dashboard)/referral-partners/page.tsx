'use client';

import { useEffect, useState, useCallback } from 'react';

interface Partner {
  id: string;
  name: string;
  partner_type: string;
  referral_code: string;
  commission_type: string;
  commission_value: number;
  status: string;
  clientsReferred: number;
  commissionAccrued: number;
  commissionPaid: number;
  commissionOutstanding: number;
}

function currency(n: number): string {
  return (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function ReferralPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [partnerType, setPartnerType] = useState<'individual' | 'business' | 'affiliate'>('individual');
  const [commissionType, setCommissionType] = useState<'none' | 'flat_per_enrollment' | 'percent_of_first_payment'>('none');
  const [commissionValue, setCommissionValue] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/referral-partners');
    const data = await res.json();
    setPartners(data.partners ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createPartner() {
    if (!name.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/referral-partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, partnerType, commissionType, commissionValue: commissionValue ? Number(commissionValue) : 0 }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not save this partner (${res.status}).`);
        return;
      }
      setName('');
      setCommissionValue('');
      setShowCreate(false);
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  async function recordPayment(partnerId: string) {
    if (!payAmount) return;
    setError(null);
    try {
      const res = await fetch(`/api/referral-partners/${partnerId}/commission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'commission_paid', amount: Number(payAmount) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not record that payment (${res.status}).`);
        return;
      }
      setPayingId(null);
      setPayAmount('');
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  return (
    <div>
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Referral partners</h1>
          <p className="mt-1 text-sm text-muted">Track who sends business your way, and what you owe them.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-control bg-money px-5 py-3 text-sm font-medium text-white hover:bg-money-hover">
          Add partner
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
      )}

      {showCreate && (
        <div className="mb-8 rounded-card border border-line bg-white p-6">
          <p className="mb-4 text-[15px] font-medium text-ink">New referral partner</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs text-muted">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Realtor" className="w-full rounded-control border border-line px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Type</label>
              <select value={partnerType} onChange={(e) => setPartnerType(e.target.value as typeof partnerType)} className="rounded-control border border-line px-3 py-2 text-sm">
                <option value="individual">Individual</option>
                <option value="business">Business</option>
                <option value="affiliate">Affiliate</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Commission</label>
              <select value={commissionType} onChange={(e) => setCommissionType(e.target.value as typeof commissionType)} className="rounded-control border border-line px-3 py-2 text-sm">
                <option value="none">None</option>
                <option value="flat_per_enrollment">Flat $ per enrollment</option>
                <option value="percent_of_first_payment">% of first payment</option>
              </select>
            </div>
            {commissionType !== 'none' && (
              <div>
                <label className="mb-1 block text-xs text-muted">{commissionType === 'flat_per_enrollment' ? 'Amount ($)' : 'Percent'}</label>
                <input value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} type="number" className="w-24 rounded-control border border-line px-3 py-2 text-sm" />
              </div>
            )}
            <button onClick={createPartner} className="rounded-control bg-money px-5 py-2.5 text-sm font-medium text-white hover:bg-money-hover">Create</button>
            <button onClick={() => setShowCreate(false)} className="rounded-control border border-line px-5 py-2.5 text-sm text-ink">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : partners.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center">
          <p className="text-[15px] text-ink">No referral partners yet</p>
          <p className="mt-1 text-sm text-muted">Add one to start tracking who sends you business.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {partners.map((p) => (
            <div key={p.id} className="rounded-card border border-line bg-white p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[15px] font-medium text-ink">{p.name}</p>
                  <p className="mt-1 text-sm text-muted">Referral code: <code className="rounded bg-line px-1.5 py-0.5">{p.referral_code}</code> · {p.partner_type} · {p.clientsReferred} client{p.clientsReferred === 1 ? '' : 's'} referred</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${p.status === 'active' ? 'bg-money-tint text-money-hover' : 'bg-line text-muted'}`}>{p.status}</span>
              </div>

              {p.commission_type !== 'none' && (
                <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm">
                  <div className="flex gap-6">
                    <span className="text-muted">Accrued: <span className="text-ink">{currency(p.commissionAccrued)}</span></span>
                    <span className="text-muted">Paid: <span className="text-ink">{currency(p.commissionPaid)}</span></span>
                    <span className="text-muted">Outstanding: <span className="font-medium text-money">{currency(p.commissionOutstanding)}</span></span>
                  </div>
                  {payingId === p.id ? (
                    <div className="flex items-center gap-2">
                      <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} type="number" placeholder="Amount" className="w-28 rounded-control border border-line px-2 py-1.5 text-sm" />
                      <button onClick={() => recordPayment(p.id)} className="rounded-control bg-money px-3 py-1.5 text-xs font-medium text-white hover:bg-money-hover">Save</button>
                      <button onClick={() => setPayingId(null)} className="text-xs text-muted">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setPayingId(p.id)} className="rounded-control border border-line px-3 py-1.5 text-xs text-ink hover:border-ink/30">Record payment</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
