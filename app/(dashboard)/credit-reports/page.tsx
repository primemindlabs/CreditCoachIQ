'use client';

import { useEffect, useState, useCallback } from 'react';

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

function borrowerName(e: Enrollment): string {
  const b = Array.isArray(e.borrowers) ? e.borrowers[0] : e.borrowers;
  return b ? `${b.first_name} ${b.last_name}` : 'Unknown';
}

export default function CreditReportsPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [sourceBureau, setSourceBureau] = useState('unknown');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ summary: string; tradelineCount: number; disputableCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/overview').then((r) => r.json()).then((d) => setEnrollments(d.enrollments ?? []));
  }, []);

  const loadUploads = useCallback(async (enrollmentId: string) => {
    if (!enrollmentId) return setUploads([]);
    const res = await fetch(`/api/credit-reports?enrollmentId=${enrollmentId}`);
    const data = await res.json();
    setUploads(data.uploads ?? []);
  }, []);

  useEffect(() => { loadUploads(selected); }, [selected, loadUploads]);

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
    loadUploads(selected);
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
          <p className="mt-1 text-sm text-muted">{result.tradelineCount} tradelines imported, {result.disputableCount} flagged as likely disputable — review before generating letters.</p>
          <p className="mt-2 text-sm text-ink">{result.summary}</p>
        </div>
      )}

      {selected && (
        <div className="rounded-card border border-line bg-white p-6">
          <p className="mb-4 text-sm font-medium text-ink">Upload history</p>
          {uploads.length === 0 ? (
            <p className="text-sm text-muted">No reports uploaded yet for this client.</p>
          ) : (
            <div className="space-y-3">
              {uploads.map((u) => (
                <div key={u.id} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                  <div>
                    <p className="text-ink">{u.source_bureau} · {new Date(u.created_at).toLocaleDateString()}</p>
                    {u.parse_status === 'parsed' && (
                      <p className="text-muted">Scores — Exp: {u.score_exp ?? '—'} · Eqx: {u.score_eqx ?? '—'} · TU: {u.score_tu ?? '—'} · {u.ai_analysis?.tradeline_count ?? 0} tradelines</p>
                    )}
                    {u.parse_status === 'failed' && <p className="text-terra">{u.parse_error}</p>}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${u.parse_status === 'parsed' ? 'bg-money-tint text-money-hover' : u.parse_status === 'failed' ? 'bg-terra-tint text-terra' : 'bg-line text-muted'}`}>
                    {u.parse_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
