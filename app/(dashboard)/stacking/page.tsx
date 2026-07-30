'use client';

import { useEffect, useState, useCallback } from 'react';
import StatCard from '@/components/ui/StatCard';

interface Person { id: string; first_name: string; last_name: string; plan_tier: string }
interface BusinessProfile {
  id: string; entity_name: string; entity_type: string | null; ein: string | null;
  duns_number: string | null; formation_date: string | null; notes: string | null;
}
interface Application {
  id: string; lender_name: string; product_name: string | null; status: string;
  approved_limit: number | null; promo_apr_months: number | null; promo_apr_ends_at: string | null;
  standard_apr: number | null; denial_reason: string | null;
}
interface Plan {
  id: string; target_capital: number; status: string; business_credit_profile_id: string | null;
  planned_sequence: unknown; created_at: string; credit_stack_applications: Application[];
}
interface Summary { capitalAvailable: number; activeApplicationCount: number; expiringWithin30Days: { lender_name: string }[] }
interface VaultDoc { id: string; doc_type: string; file_name: string; url: string | null }

const APP_STATUSES = ['planned', 'applied', 'approved', 'denied', 'active', 'promo_expired', 'closed'];
const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', applied: 'Applied', approved: 'Approved', denied: 'Denied',
  active: 'Active', promo_expired: 'Promo expired', closed: 'Closed',
};

function currency(n: number): string {
  return (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function StackingPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState('');
  const [loadingPeople, setLoadingPeople] = useState(true);

  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[]>([]);
  const [gateError, setGateError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [profileForm, setProfileForm] = useState({ entityName: '', entityType: '', ein: '', dunsNumber: '', formationDate: '', notes: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  const [planTargetCapital, setPlanTargetCapital] = useState('');
  const [planBusinessProfileId, setPlanBusinessProfileId] = useState('');
  const [planInputMethod, setPlanInputMethod] = useState<'existing_doc' | 'upload_new' | 'skip'>('skip');
  const [planExistingDocId, setPlanExistingDocId] = useState('');
  const [planNewDocFile, setPlanNewDocFile] = useState<File | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [appForms, setAppForms] = useState<Record<string, { lenderName: string; productName: string }>>({});
  const [appSavingPlanId, setAppSavingPlanId] = useState<string | null>(null);

  useEffect(() => {
    setLoadingPeople(true);
    // investor_path is the only tier credit_stacking is gated to — pull every
    // segment and keep only that tier, since there's no single "all clients"
    // endpoint independent of the Clients page's segment tabs.
    Promise.all(
      ['leads', 'active', 'funded', 'denied'].map((segment) =>
        fetch(`/api/coach/clients?segment=${segment}&all=true`).then((r) => (r.ok ? r.json() : { people: [] }))
      )
    ).then((results) => {
      const merged = new Map<string, Person>();
      results.forEach((r) => (r.people ?? []).forEach((p: Person) => { if (p.plan_tier === 'investor_path') merged.set(p.id, p); }));
      setPeople(Array.from(merged.values()));
      setLoadingPeople(false);
    });
  }, []);

  const loadDetail = useCallback(async (borrowerId: string) => {
    if (!borrowerId) return;
    setLoadingDetail(true);
    setGateError(null);
    try {
      const [profilesRes, plansRes, summaryRes, docsRes] = await Promise.all([
        fetch(`/api/stacking/business-profiles?borrower_id=${borrowerId}`).then((r) => (r.ok ? r.json() : { profiles: [] })),
        fetch(`/api/stacking/plans?borrower_id=${borrowerId}`).then((r) => (r.ok ? r.json() : { plans: [] })),
        fetch(`/api/stacking/summary?borrower_id=${borrowerId}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/coach/client/${borrowerId}/documents`).then((r) => (r.ok ? r.json() : { documents: [] })),
      ]);
      setProfiles(profilesRes.profiles ?? []);
      setPlans(plansRes.plans ?? []);
      setSummary(summaryRes);
      setVaultDocs(docsRes.documents ?? []);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    setProfileForm({ entityName: '', entityType: '', ein: '', dunsNumber: '', formationDate: '', notes: '' });
    setPlanTargetCapital('');
    setPlanBusinessProfileId('');
    setPlanInputMethod('skip');
    setPlanExistingDocId('');
    setPlanNewDocFile(null);
    setPlanError(null);
    setProfileError(null);
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  async function saveProfile() {
    if (!profileForm.entityName.trim() || !selected) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const res = await fetch('/api/stacking/business-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower_id: selected,
          entity_name: profileForm.entityName.trim(),
          entity_type: profileForm.entityType || null,
          ein: profileForm.ein || null,
          duns_number: profileForm.dunsNumber || null,
          formation_date: profileForm.formationDate || null,
          notes: profileForm.notes || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileError(d.error ?? `Could not save that business profile (${res.status}).`);
        return;
      }
      setProfileForm({ entityName: '', entityType: '', ein: '', dunsNumber: '', formationDate: '', notes: '' });
      loadDetail(selected);
    } catch {
      setProfileError('Could not reach the server.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function revealEin(profileId: string) {
    if (revealedIds.has(profileId)) return;
    const res = await fetch(`/api/stacking/business-profiles?borrower_id=${selected}&reveal=true`);
    if (!res.ok) return;
    const d = await res.json();
    setProfiles(d.profiles ?? []);
    setRevealedIds((prev) => new Set(prev).add(profileId));
  }

  async function generatePlan() {
    if (!selected || !planTargetCapital) return;
    setPlanSaving(true);
    setPlanError(null);
    try {
      // Input method is a data-capture choice only — CreditCoachIQ does not
      // run an AI stack-recommendation engine (EquityNest uses Trulli AI for
      // that externally). "Generate Funding Plan" here means: create the
      // tracked plan record and, if requested, attach supporting docs.
      let docNoteSuffix = '';
      if (planInputMethod === 'upload_new' && planNewDocFile) {
        const form = new FormData();
        form.append('file', planNewDocFile);
        form.append('docType', 'credit_report');
        const upRes = await fetch(`/api/coach/client/${selected}/documents`, { method: 'POST', body: form });
        if (!upRes.ok) {
          const d = await upRes.json().catch(() => ({}));
          setPlanError(d.error ?? 'Could not upload the supporting document.');
          setPlanSaving(false);
          return;
        }
        docNoteSuffix = ` · supporting doc uploaded (${planNewDocFile.name})`;
      } else if (planInputMethod === 'existing_doc' && planExistingDocId) {
        const doc = vaultDocs.find((d) => d.id === planExistingDocId);
        docNoteSuffix = doc ? ` · linked to vault doc: ${doc.file_name}` : '';
      }

      const res = await fetch('/api/stacking/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower_id: selected,
          business_credit_profile_id: planBusinessProfileId || null,
          target_capital: Number(planTargetCapital),
          planned_sequence: docNoteSuffix ? [{ note: docNoteSuffix.replace(' · ', '') }] : [],
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPlanError(d.error ?? `Could not generate that plan (${res.status}).`);
        return;
      }
      setPlanTargetCapital('');
      setPlanBusinessProfileId('');
      setPlanInputMethod('skip');
      setPlanExistingDocId('');
      setPlanNewDocFile(null);
      loadDetail(selected);
      if (planInputMethod === 'upload_new') {
        const docsRes = await fetch(`/api/coach/client/${selected}/documents`).then((r) => (r.ok ? r.json() : { documents: [] }));
        setVaultDocs(docsRes.documents ?? []);
      }
    } catch {
      setPlanError('Could not reach the server.');
    } finally {
      setPlanSaving(false);
    }
  }

  async function addApplication(planId: string) {
    const form = appForms[planId];
    if (!form?.lenderName.trim() || !selected) return;
    setAppSavingPlanId(planId);
    try {
      const res = await fetch('/api/stacking/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stack_plan_id: planId, borrower_id: selected, lender_name: form.lenderName.trim(), product_name: form.productName || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPlanError(d.error ?? `Could not add that application (${res.status}).`);
        return;
      }
      setAppForms((prev) => ({ ...prev, [planId]: { lenderName: '', productName: '' } }));
      loadDetail(selected);
    } catch {
      setPlanError('Could not reach the server.');
    } finally {
      setAppSavingPlanId(null);
    }
  }

  async function updateApplicationStatus(app: Application, status: string) {
    let promoApr: string | undefined;
    let approvedLimit: number | undefined;
    if (status === 'active') {
      const ends = window.prompt('Promo APR end date (YYYY-MM-DD) — required to disclose deferred-interest terms:');
      if (!ends) return; // don't submit an active status without the disclosure date
      promoApr = ends;
      const limitStr = window.prompt('Approved limit ($) — optional, leave blank to skip:', app.approved_limit ? String(app.approved_limit) : '');
      if (limitStr && !Number.isNaN(Number(limitStr))) approvedLimit = Number(limitStr);
    }
    try {
      const res = await fetch('/api/stacking/applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: app.id,
          status,
          ...(promoApr ? { promo_apr_ends_at: promoApr } : {}),
          ...(approvedLimit !== undefined ? { approved_limit: approvedLimit } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPlanError(d.error ?? `Could not update that application (${res.status}).`);
        return;
      }
      loadDetail(selected);
    } catch {
      setPlanError('Could not reach the server.');
    }
  }

  const selectedPerson = people.find((p) => p.id === selected);

  return (
    <div>
      <h1 className="text-[26px] font-medium text-ink">Credit stacking</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Track business credit profiles, funding plans, and lender applications for Investor Path clients. This is a
        tracking tool, not a recommendation engine — stack sequencing is decided with Trulli AI outside this system.
      </p>

      <div className="mb-8 rounded-card border border-line bg-white p-6">
        <label className="mb-1 block text-xs text-muted">Client</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loadingPeople} className="w-full max-w-sm rounded-control border border-line px-3 py-2 text-sm">
          <option value="">{loadingPeople ? 'Loading…' : 'Select an Investor Path client…'}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
          ))}
        </select>
        {!loadingPeople && people.length === 0 && (
          <p className="mt-3 text-sm text-muted">No clients are on the Investor Path plan tier yet — credit stacking is gated to that tier.</p>
        )}
      </div>

      {selected && selectedPerson?.plan_tier !== 'investor_path' && (
        <div className="rounded-card border border-line bg-gold-tint p-6 text-sm text-ink">
          Credit stacking requires the Investor Path plan tier. Upgrade this client&apos;s plan tier from their profile to unlock this module.
        </div>
      )}

      {selected && selectedPerson?.plan_tier === 'investor_path' && (
        <>
          {gateError && <div className="mb-8 rounded-card border border-line bg-terra-tint p-6 text-sm text-terra">{gateError}</div>}

          {summary && (
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Stacked capital" value={currency(summary.capitalAvailable)} accent="money" />
              <StatCard label="Active lines" value={summary.activeApplicationCount} />
              <StatCard
                label="Promo expiring <30d"
                value={summary.expiringWithin30Days.length}
                sub={summary.expiringWithin30Days.length > 0 ? summary.expiringWithin30Days.map((a) => a.lender_name).join(', ') : undefined}
                accent={summary.expiringWithin30Days.length > 0 ? 'gold' : undefined}
              />
            </div>
          )}

          {/* Business credit profiles */}
          <div className="mb-8 rounded-card border border-line bg-white p-6">
            <p className="mb-4 text-sm font-medium text-ink">Business credit profiles</p>
            {profiles.length === 0 ? (
              <p className="mb-4 text-sm text-muted">No business entity on file yet.</p>
            ) : (
              <div className="mb-4 space-y-3">
                {profiles.map((p) => (
                  <div key={p.id} className="border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                    <p className="text-ink">{p.entity_name}{p.entity_type ? ` · ${p.entity_type}` : ''}</p>
                    <p className="text-xs text-muted">
                      EIN: {p.ein ?? 'not on file'}
                      {p.ein && p.ein.startsWith('••••') && (
                        <button onClick={() => revealEin(p.id)} className="ml-2 text-money hover:underline">Reveal</button>
                      )}
                      {p.duns_number ? ` · D-U-N-S ${p.duns_number}` : ''}
                      {p.formation_date ? ` · formed ${p.formation_date}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <input value={profileForm.entityName} onChange={(e) => setProfileForm({ ...profileForm, entityName: e.target.value })} placeholder="Entity name" className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
              <input value={profileForm.entityType} onChange={(e) => setProfileForm({ ...profileForm, entityType: e.target.value })} placeholder="Entity type (LLC, S-Corp…)" className="rounded-control border border-line px-3 py-2 text-sm" />
              <input value={profileForm.ein} onChange={(e) => setProfileForm({ ...profileForm, ein: e.target.value })} placeholder="EIN" className="rounded-control border border-line px-3 py-2 text-sm" />
              <input value={profileForm.dunsNumber} onChange={(e) => setProfileForm({ ...profileForm, dunsNumber: e.target.value })} placeholder="D-U-N-S number" className="rounded-control border border-line px-3 py-2 text-sm" />
              <input type="date" value={profileForm.formationDate} onChange={(e) => setProfileForm({ ...profileForm, formationDate: e.target.value })} className="figure rounded-control border border-line px-3 py-2 text-sm" />
              <textarea value={profileForm.notes} onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })} placeholder="Notes" rows={2} className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
            </div>
            {profileError && <p className="mt-2 text-xs text-terra">{profileError}</p>}
            <button onClick={saveProfile} disabled={profileSaving || !profileForm.entityName.trim()} className="mt-3 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
              {profileSaving ? 'Saving…' : 'Add business profile'}
            </button>
          </div>

          {/* New funding plan intake */}
          <div className="mb-8 rounded-card border border-line bg-white p-6">
            <p className="mb-2 text-sm font-medium text-ink">New funding plan</p>
            <div className="mb-4 rounded-control border border-line bg-paper p-3 text-xs text-muted">
              Recommended: use a tri-merge report (all 3 bureaus) as the basis for this plan — single-bureau reports are
              supported but tend to surface fewer usable tradelines.
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Target capital ($)</label>
                <input type="number" value={planTargetCapital} onChange={(e) => setPlanTargetCapital(e.target.value)} placeholder="50000" className="w-full rounded-control border border-line px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Business profile</label>
                <select value={planBusinessProfileId} onChange={(e) => setPlanBusinessProfileId(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm">
                  <option value="">None / personal credit only</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.entity_name}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs text-muted">Supporting documentation</label>
              <div className="flex flex-wrap gap-3 text-sm text-ink">
                <label className="flex items-center gap-1.5"><input type="radio" checked={planInputMethod === 'existing_doc'} onChange={() => setPlanInputMethod('existing_doc')} /> Attach existing vault document</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={planInputMethod === 'upload_new'} onChange={() => setPlanInputMethod('upload_new')} /> Upload new document</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={planInputMethod === 'skip'} onChange={() => setPlanInputMethod('skip')} /> Skip for now</label>
              </div>
              {planInputMethod === 'existing_doc' && (
                <select value={planExistingDocId} onChange={(e) => setPlanExistingDocId(e.target.value)} className="mt-2 w-full max-w-sm rounded-control border border-line px-3 py-2 text-sm">
                  <option value="">{vaultDocs.length === 0 ? 'No documents in vault yet' : 'Select a document…'}</option>
                  {vaultDocs.map((d) => <option key={d.id} value={d.id}>{d.file_name}</option>)}
                </select>
              )}
              {planInputMethod === 'upload_new' && (
                <input type="file" onChange={(e) => setPlanNewDocFile(e.target.files?.[0] ?? null)} className="mt-2 text-xs text-ink file:mr-2 file:rounded-control file:border file:border-line file:bg-white file:px-2 file:py-1 file:text-xs file:text-ink" />
              )}
            </div>

            {planError && <p className="mt-3 text-xs text-terra">{planError}</p>}
            <button
              onClick={generatePlan}
              disabled={planSaving || !planTargetCapital}
              className="mt-4 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50"
            >
              {planSaving ? 'Generating…' : 'Generate funding plan'}
            </button>
          </div>

          {/* Plans + applications */}
          <div className="rounded-card border border-line bg-white p-6">
            <p className="mb-4 text-sm font-medium text-ink">Funding plans</p>
            {loadingDetail ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted">No funding plans yet — generate one above.</p>
            ) : (
              <div className="space-y-6">
                {plans.map((plan) => (
                  <div key={plan.id} className="rounded-control border border-line p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm text-ink">{currency(plan.target_capital)} target · {new Date(plan.created_at).toLocaleDateString()}</p>
                      <span className="rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted">{plan.status}</span>
                    </div>

                    {plan.credit_stack_applications.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {plan.credit_stack_applications.map((app) => (
                          <div key={app.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                            <div>
                              <p className="text-ink">{app.lender_name}{app.product_name ? ` · ${app.product_name}` : ''}</p>
                              <p className="text-xs text-muted">
                                {app.approved_limit ? `${currency(app.approved_limit)} approved` : ''}
                                {app.promo_apr_ends_at ? ` · promo ends ${app.promo_apr_ends_at}` : ''}
                                {app.denial_reason ? ` · ${app.denial_reason}` : ''}
                              </p>
                            </div>
                            <select
                              value={app.status}
                              onChange={(e) => updateApplicationStatus(app, e.target.value)}
                              className="shrink-0 rounded-control border border-line px-2 py-1 text-xs text-ink"
                            >
                              {APP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 border-t border-line pt-3">
                      <input
                        value={appForms[plan.id]?.lenderName ?? ''}
                        onChange={(e) => setAppForms((prev) => ({ ...prev, [plan.id]: { lenderName: e.target.value, productName: prev[plan.id]?.productName ?? '' } }))}
                        placeholder="Lender name"
                        className="min-w-0 flex-1 rounded-control border border-line px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
                      />
                      <input
                        value={appForms[plan.id]?.productName ?? ''}
                        onChange={(e) => setAppForms((prev) => ({ ...prev, [plan.id]: { lenderName: prev[plan.id]?.lenderName ?? '', productName: e.target.value } }))}
                        placeholder="Product (optional)"
                        className="min-w-0 flex-1 rounded-control border border-line px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
                      />
                      <button
                        onClick={() => addApplication(plan.id)}
                        disabled={appSavingPlanId === plan.id || !appForms[plan.id]?.lenderName.trim()}
                        className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm text-ink hover:border-ink/30 disabled:opacity-60"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
