'use client';

import { useEffect, useState, useCallback } from 'react';
import { Sparkles } from 'lucide-react';

interface Enrollment {
  id: string;
  status: string;
  current_score_exp: number | null;
  current_score_eqx: number | null;
  current_score_tu: number | null;
  borrowers: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
}

interface Upload {
  id: string;
  source_bureau: string;
  parse_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  parse_error: string | null;
  score_exp: number | null;
  score_eqx: number | null;
  score_tu: number | null;
  ai_analysis: { summary?: string; tradeline_count?: number } | null;
  created_at: string;
}

interface Tradeline {
  id: string;
  report_upload_id: string | null;
  creditor_name: string;
  account_number: string | null;
  account_type: string | null;
  bureau: string;
  balance: number | null;
  status: string | null;
  payment_status: string | null;
  negative_remarks: string[] | null;
  is_disputable: boolean;
  dispute_reason: string | null;
  dispute_priority: number | null;
  estimated_score_gain: number | null;
  dispute_status: string;
}

interface BorrowerInfo {
  id: string;
  first_name: string;
  last_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

const DISPUTE_STATUS_LABEL: Record<string, string> = {
  identified: 'Not yet queued', queued: 'Letter drafted', letter_sent: 'Sent',
  verified: 'Verified by bureau', removed: 'Removed', updated: 'Updated', not_disputing: 'Not disputing',
};

function borrowerName(e: Enrollment): string {
  const b = Array.isArray(e.borrowers) ? e.borrowers[0] : e.borrowers;
  return b ? `${b.first_name} ${b.last_name}` : 'Unknown';
}

function hasAddress(b: BorrowerInfo | null): boolean {
  return !!(b?.address_line1 && b?.city && b?.state && b?.postal_code);
}

export default function CreditReportsPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [sourceBureau, setSourceBureau] = useState('unknown');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ summary: string; tradelineCount: number; disputableCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tradelines, setTradelines] = useState<Tradeline[]>([]);
  const [selectedTradelineIds, setSelectedTradelineIds] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<string | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [borrowerInfo, setBorrowerInfo] = useState<BorrowerInfo | null>(null);
  const [addressDraft, setAddressDraft] = useState({ addressLine1: '', addressLine2: '', city: '', postalCode: '' });
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [expandedUploadId, setExpandedUploadId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/overview').then((r) => r.json()).then((d) => setEnrollments(d.enrollments ?? []));
  }, []);

  const loadUploads = useCallback(async (enrollmentId: string) => {
    if (!enrollmentId) return setUploads([]);
    const res = await fetch(`/api/credit-reports?enrollmentId=${enrollmentId}`);
    const data = await res.json();
    setUploads(data.uploads ?? []);
  }, []);

  const loadTradelines = useCallback(async (enrollmentId: string) => {
    if (!enrollmentId) return setTradelines([]);
    const res = await fetch(`/api/credit-reports/tradelines?enrollmentId=${enrollmentId}`);
    const data = await res.json();
    setTradelines(data.tradelines ?? []);
    setSelectedTradelineIds(new Set((data.tradelines ?? []).filter((t: Tradeline) => t.is_disputable && t.dispute_status === 'identified').map((t: Tradeline) => t.id)));
  }, []);

  const loadBorrowerInfo = useCallback(async (enrollmentId: string) => {
    if (!enrollmentId) return setBorrowerInfo(null);
    const res = await fetch(`/api/credit-reports/borrower-info?enrollmentId=${enrollmentId}`);
    if (!res.ok) return setBorrowerInfo(null);
    const data = await res.json();
    setBorrowerInfo(data.borrower ?? null);
    setAddressDraft({
      addressLine1: data.borrower?.address_line1 ?? '',
      addressLine2: data.borrower?.address_line2 ?? '',
      city: data.borrower?.city ?? '',
      postalCode: data.borrower?.postal_code ?? '',
    });
  }, []);

  useEffect(() => {
    setStrategy(null);
    setGenerateResult(null);
    setShowAddressForm(false);
    loadUploads(selected);
    loadTradelines(selected);
    loadBorrowerInfo(selected);
  }, [selected, loadUploads, loadTradelines, loadBorrowerInfo]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);
    form.append('enrollmentId', selected);
    form.append('sourceBureau', sourceBureau);

    const res = await fetch('/api/credit-reports', { method: 'POST', body: form });
    const data = await res.json();
    setUploading(false);
    e.target.value = '';

    if (!res.ok) {
      setError(data.error ?? 'Upload failed');
      return;
    }
    setResult({ summary: data.summary, tradelineCount: data.tradelineCount, disputableCount: data.disputableCount });
    // The toast above fades from view on the next action — the row in Upload
    // history below is the persistent, revisitable version of this same
    // analysis, so open it automatically instead of leaving it buried.
    if (data.uploadId) setExpandedUploadId(data.uploadId);
    loadUploads(selected);
    loadTradelines(selected);
  }

  function toggleTradeline(id: string) {
    setSelectedTradelineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function getStrategy() {
    if (!borrowerInfo) return;
    setStrategyLoading(true);
    try {
      const res = await fetch('/api/credit-reports/dispute-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: borrowerInfo.first_name, tradelines }),
      });
      const d = await res.json();
      setStrategy(res.ok ? d.strategy : (d.error ?? 'Could not generate a strategy summary.'));
    } catch {
      setStrategy('Could not reach the server.');
    } finally {
      setStrategyLoading(false);
    }
  }

  async function generateLetters() {
    if (!borrowerInfo || selectedTradelineIds.size === 0) return;

    if (!hasAddress(borrowerInfo)) {
      setShowAddressForm(true);
      return;
    }

    setGenerating(true);
    setGenerateResult(null);
    try {
      const fullAddress = `${borrowerInfo.address_line1}${borrowerInfo.address_line2 ? `, ${borrowerInfo.address_line2}` : ''}, ${borrowerInfo.city}, ${borrowerInfo.state} ${borrowerInfo.postal_code}`;
      const res = await fetch('/api/disputes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentId: selected,
          borrowerName: `${borrowerInfo.first_name} ${borrowerInfo.last_name}`,
          borrowerAddress: fullAddress,
          tradelineIds: Array.from(selectedTradelineIds),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateResult(d.error ?? `Could not generate letters (${res.status}).`);
        return;
      }
      setGenerateResult(`${d.count} letter(s) drafted — review and send them from this client's profile page.`);
      loadTradelines(selected);
    } catch {
      setGenerateResult('Could not reach the server. Check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function saveAddressAndGenerate() {
    if (!borrowerInfo) return;
    if (!addressDraft.addressLine1.trim() || !addressDraft.city.trim() || !addressDraft.postalCode.trim()) {
      setGenerateResult('Street address, city, and ZIP are required to mail a dispute letter.');
      return;
    }
    setGenerating(true);
    setGenerateResult(null);
    try {
      const res = await fetch(`/api/coach/client/${borrowerInfo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addressDraft),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setGenerateResult(d.error ?? `Could not save address (${res.status}).`);
        return;
      }
      await loadBorrowerInfo(selected);
      setShowAddressForm(false);
      // borrowerInfo state won't have updated yet within this closure — re-run with the freshly saved draft directly.
      const updated: BorrowerInfo = { ...borrowerInfo, address_line1: addressDraft.addressLine1, address_line2: addressDraft.addressLine2, city: addressDraft.city, postal_code: addressDraft.postalCode };
      if (!hasAddress(updated)) return;
      const fullAddress = `${updated.address_line1}${updated.address_line2 ? `, ${updated.address_line2}` : ''}, ${updated.city}, ${updated.state} ${updated.postal_code}`;
      const genRes = await fetch('/api/disputes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentId: selected,
          borrowerName: `${updated.first_name} ${updated.last_name}`,
          borrowerAddress: fullAddress,
          tradelineIds: Array.from(selectedTradelineIds),
        }),
      });
      const genData = await genRes.json().catch(() => ({}));
      setGenerateResult(genRes.ok ? `${genData.count} letter(s) drafted — review and send them from this client's profile page.` : (genData.error ?? 'Could not generate letters.'));
      loadTradelines(selected);
    } catch {
      setGenerateResult('Could not reach the server. Check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <h1 className="text-[26px] font-medium text-ink">Credit report import</h1>
      <p className="mt-1 mb-8 text-sm text-muted">Upload a client's credit report PDF — Claude extracts scores and tradelines directly, flagging likely dispute candidates for your review.</p>

      <div className="mb-8 rounded-card border border-line bg-white p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs text-muted">Client</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm">
              <option value="">Select a client…</option>
              {enrollments.map((e) => (
                <option key={e.id} value={e.id}>{borrowerName(e)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Source bureau</label>
            <select value={sourceBureau} onChange={(e) => setSourceBureau(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm">
              <option value="unknown">Not sure / auto-detect</option>
              <option value="experian">Experian</option>
              <option value="equifax">Equifax</option>
              <option value="transunion">TransUnion</option>
              <option value="tri_merge">Tri-merge</option>
            </select>
          </div>
          <label className={`rounded-control px-5 py-2.5 text-sm font-medium text-white ${selected && !uploading ? 'cursor-pointer bg-money hover:bg-money-hover' : 'cursor-not-allowed bg-line text-muted'}`}>
            {uploading ? 'Parsing…' : 'Upload PDF'}
            <input type="file" accept="application/pdf" disabled={!selected || uploading} onChange={onFileChange} className="hidden" />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-terra">{error}</p>}
      </div>

      {result && (
        <div className="mb-8 rounded-card border border-line bg-money-tint p-6">
          <p className="text-sm font-medium text-ink">Import complete</p>
          <p className="mt-1 text-sm text-muted">{result.tradelineCount} tradelines imported, {result.disputableCount} flagged as likely disputable — review below before generating letters.</p>
          <p className="mt-2 text-sm text-ink">{result.summary}</p>
        </div>
      )}

      {selected && (
        <div className="mb-8 rounded-card border border-line bg-white p-6">
          <p className="mb-1 text-sm font-medium text-ink">Upload history</p>
          <p className="mb-4 text-xs text-muted">Every past import stays here as a revisitable record — click a row to reopen its full analysis.</p>
          {uploads.length === 0 ? (
            <p className="text-sm text-muted">No reports uploaded yet for this client.</p>
          ) : (
            <div className="space-y-2">
              {uploads.map((u) => {
                const expanded = expandedUploadId === u.id;
                const uploadTradelines = tradelines.filter((t) => t.report_upload_id === u.id);
                return (
                  <div key={u.id} className="border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                    <button
                      onClick={() => setExpandedUploadId(expanded ? null : u.id)}
                      className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
                    >
                      <div>
                        <p className="text-ink">{u.source_bureau} · {new Date(u.created_at).toLocaleDateString()}</p>
                        {u.parse_status === 'parsed' && (
                          <p className="text-muted">Scores — Exp: {u.score_exp ?? '—'} · Eqx: {u.score_eqx ?? '—'} · TU: {u.score_tu ?? '—'} · {u.ai_analysis?.tradeline_count ?? 0} tradelines</p>
                        )}
                        {u.parse_status === 'failed' && <p className="text-terra">{u.parse_error}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${u.parse_status === 'parsed' ? 'bg-money-tint text-money-hover' : u.parse_status === 'failed' ? 'bg-terra-tint text-terra' : 'bg-line text-muted'}`}>
                        {u.parse_status}
                      </span>
                    </button>
                    {expanded && u.parse_status === 'parsed' && (
                      <div className="mt-2 rounded-control border border-line bg-paper p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">AI analysis</p>
                        <p className="mt-1.5 text-sm text-ink">{u.ai_analysis?.summary ?? 'No summary was recorded for this import.'}</p>
                        {uploadTradelines.length > 0 && (
                          <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                            {uploadTradelines.map((t) => (
                              <div key={t.id} className="flex items-center justify-between text-xs">
                                <span className="text-ink">{t.creditor_name} · {t.bureau}</span>
                                <span className="text-muted">{t.is_disputable ? `disputable${t.dispute_priority ? ` · priority ${t.dispute_priority}` : ''}` : 'not flagged'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selected && tradelines.length > 0 && (
        <div className="rounded-card border border-line bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Tradelines & dispute strategy</p>
            <button onClick={getStrategy} disabled={strategyLoading} className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs text-ink hover:border-ink/30 disabled:opacity-60">
              <Sparkles size={13} strokeWidth={1.75} /> {strategyLoading ? 'Thinking…' : 'AI dispute strategy'}
            </button>
          </div>

          {strategy && <div className="mb-4 rounded-control border border-line bg-paper p-4 text-sm text-ink">{strategy}</div>}

          <div className="space-y-2">
            {tradelines.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-3 border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                <div className="flex items-start gap-2.5">
                  {t.is_disputable && t.dispute_status === 'identified' && (
                    <input type="checkbox" checked={selectedTradelineIds.has(t.id)} onChange={() => toggleTradeline(t.id)} className="mt-1 rounded border-line" />
                  )}
                  <div>
                    <p className="text-ink">{t.creditor_name} <span className="text-xs text-muted">· {t.bureau}{t.balance != null ? ` · $${Number(t.balance).toLocaleString()}` : ''}</span></p>
                    {t.is_disputable ? (
                      <p className="mt-0.5 text-xs text-muted">
                        Priority {t.dispute_priority ?? '—'}/10{t.estimated_score_gain != null ? ` · est. +${t.estimated_score_gain} pts` : ''} — {t.dispute_reason ?? 'flagged for review'}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted">Not flagged as disputable</p>
                    )}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${t.dispute_status === 'identified' ? 'bg-line text-muted' : t.dispute_status === 'queued' ? 'bg-gold-tint text-ink' : 'bg-money-tint text-money-hover'}`}>
                  {DISPUTE_STATUS_LABEL[t.dispute_status] ?? t.dispute_status}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <button
              onClick={generateLetters}
              disabled={generating || selectedTradelineIds.size === 0}
              className="rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50"
            >
              {generating ? 'Drafting…' : `Generate letters for ${selectedTradelineIds.size} selected`}
            </button>

            {showAddressForm && (
              <div className="mt-4 rounded-control border border-line bg-paper p-4">
                <p className="mb-3 text-xs text-muted">No mailing address on file for this client yet — required to send a dispute letter. Save it once, reused every time going forward.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input value={addressDraft.addressLine1} onChange={(e) => setAddressDraft({ ...addressDraft, addressLine1: e.target.value })} placeholder="Street address" className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
                  <input value={addressDraft.addressLine2} onChange={(e) => setAddressDraft({ ...addressDraft, addressLine2: e.target.value })} placeholder="Apt / unit (optional)" className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
                  <input value={addressDraft.city} onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })} placeholder="City" className="rounded-control border border-line px-3 py-2 text-sm" />
                  <input value={addressDraft.postalCode} onChange={(e) => setAddressDraft({ ...addressDraft, postalCode: e.target.value })} placeholder="ZIP" className="rounded-control border border-line px-3 py-2 text-sm" />
                </div>
                <p className="mt-2 text-xs text-muted">State on file: {borrowerInfo?.state ?? 'not set — update on the client profile'}</p>
                <button onClick={saveAddressAndGenerate} disabled={generating} className="mt-3 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
                  {generating ? 'Saving…' : 'Save address & generate'}
                </button>
              </div>
            )}

            {generateResult && <p className="mt-3 text-sm text-ink">{generateResult}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
