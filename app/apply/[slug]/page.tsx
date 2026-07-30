'use client';

import { useEffect, useState } from 'react';

interface EmbedConfig {
  headline: string;
  branding: { logoUrl: string | null; primaryColor: string | null; fromName: string | null };
}

export default function ApplyPage({ params }: { params: { slug: string } }) {
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', interestLevel: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/embed/${params.slug}`).then(async (res) => {
      if (!res.ok) return setNotFound(true);
      setConfig(await res.json());
    });
  }, [params.slug]);

  async function submit() {
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    if (!form.email.trim() && !form.phone.trim()) {
      setError('Enter an email or phone number so we can reach you.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/embed/${params.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, interestLevel: form.interestLevel || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Something went wrong. Try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <p className="text-sm text-muted">This page isn&apos;t available.</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const accent = config.branding.primaryColor || '#0F9D58';
  const brandName = config.branding.fromName || 'CreditCoachIQ';

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-8 shadow-elevated">
        <div className="mb-6 flex items-center gap-2">
          {config.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.branding.logoUrl} alt={brandName} className="h-6 w-auto" />
          ) : (
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
          )}
          <span className="text-[14px] font-medium tracking-tight text-ink">{brandName}</span>
        </div>

        {submitted ? (
          <div className="py-6 text-center">
            <p className="text-[17px] font-medium text-ink">Thanks — we&apos;ve got it.</p>
            <p className="mt-2 text-sm text-muted">Someone from our team will reach out shortly.</p>
          </div>
        ) : (
          <>
            <h1 className="mb-6 text-[22px] font-medium leading-tight text-ink">{config.headline}</h1>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="First name"
                  className="rounded-control border border-line px-3 py-2 text-sm"
                />
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Last name"
                  className="rounded-control border border-line px-3 py-2 text-sm"
                />
              </div>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
                type="email"
                className="w-full rounded-control border border-line px-3 py-2 text-sm"
              />
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone"
                type="tel"
                className="w-full rounded-control border border-line px-3 py-2 text-sm"
              />
              <select
                value={form.interestLevel}
                onChange={(e) => setForm({ ...form, interestLevel: e.target.value })}
                className="w-full rounded-control border border-line px-3 py-2 text-sm text-muted"
              >
                <option value="">How soon are you looking to get started?</option>
                <option value="hot">Right away</option>
                <option value="warm">In the next few months</option>
                <option value="cold">Just exploring</option>
              </select>
            </div>
            {error && <p className="mt-3 text-sm text-terra">{error}</p>}
            <button
              onClick={submit}
              disabled={submitting || !form.firstName.trim() || !form.lastName.trim()}
              className="mt-5 w-full rounded-control px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: accent }}
            >
              {submitting ? 'Submitting…' : 'Get started'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
