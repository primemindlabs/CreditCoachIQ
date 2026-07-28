'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad, type SignatureCaptureResult } from '@/lib/signing';

interface SignStatus {
  alreadySigned: boolean;
  signedAt: string | null;
  consumerRightsStatement: string;
  contractText: string;
}

export default function PortalSignCroaPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const router = useRouter();
  const [data, setData] = useState<SignStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/${token}/sign-croa`);
    setData(await res.json());
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function submit(capture: SignatureCaptureResult) {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/portal/${token}/sign-croa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capture }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Could not save your signature');
      return;
    }
    router.push(`/portal/${token}`);
  }

  if (loading || !data) return <p className="text-sm text-muted">Loading…</p>;

  if (data.alreadySigned) {
    return (
      <div className="rounded-card border border-line bg-white p-8 text-center">
        <p className="text-[17px] font-medium text-ink">Agreement signed</p>
        <p className="mt-2 text-sm text-muted">Signed on {new Date(data.signedAt!).toLocaleDateString()}. No action needed.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-[26px] font-medium text-ink">Sign your service agreement</h1>
      <p className="mb-6 text-sm text-muted">Federal law requires you to receive this rights statement before signing. Please read both sections below, then sign at the bottom.</p>

      <div className="mb-4 max-h-64 overflow-y-auto rounded-card border border-line bg-white p-6">
        <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{data.consumerRightsStatement}</pre>
      </div>
      <div className="mb-6 max-h-64 overflow-y-auto rounded-card border border-line bg-white p-6">
        <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{data.contractText}</pre>
      </div>

      <label className="mb-6 flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" checked={hasRead} onChange={(e) => setHasRead(e.target.checked)} className="mt-0.5" />
        <span>I have read both sections above in full.</span>
      </label>

      {hasRead ? (
        <div className="rounded-card border border-line bg-white p-6">
          <SignaturePad signerName="" onCapture={submit} />
          {submitting && <p className="mt-3 text-sm text-muted">Saving…</p>}
          {error && <p className="mt-3 text-sm text-terra">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">Check the box above to unlock the signature step.</p>
      )}
    </div>
  );
}
