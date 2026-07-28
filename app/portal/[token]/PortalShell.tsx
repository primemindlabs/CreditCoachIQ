'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type GateState = 'checking' | 'invalid' | 'needs_mfa' | 'ready';

const NAV = [
  { href: '', label: 'Overview' },
  { href: '/quiz', label: 'Quiz' },
  { href: '/sign', label: 'Sign agreement' },
  { href: '/messages', label: 'Messages' },
  { href: '/booking', label: 'Book a call' },
];

/**
 * Every client-portal page mounts inside this shell. It enforces the GLBA
 * step-up MFA gate (lib/portal/otp.ts) before rendering any real content —
 * a magic-link click alone isn't enough; the client also has to confirm a
 * code sent to the email on file, once per ~30-day session.
 */
export default function PortalShell({ token, children }: { token: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [gate, setGate] = useState<GateState>('checking');
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${token}/status`);
      const data = await res.json();
      if (!data.valid) return setGate('invalid');
      setGate(data.mfaCurrent ? 'ready' : 'needs_mfa');
    } catch {
      setGate('invalid');
    }
  }, [token]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const sendCode = useCallback(async () => {
    setSending(true);
    setError(null);
    const res = await fetch(`/api/portal/${token}/mfa/challenge`, { method: 'POST' });
    const data = await res.json();
    setSending(false);
    if (!res.ok) return setError(data.error ?? 'Could not send code');
    setOtpSent(true);
  }, [token]);

  useEffect(() => {
    if (gate === 'needs_mfa' && !otpSent) sendCode();
  }, [gate, otpSent, sendCode]);

  async function verifyCode() {
    setError(null);
    const res = await fetch(`/api/portal/${token}/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Incorrect code');
    setGate('ready');
  }

  if (gate === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (gate === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="max-w-sm rounded-card border border-line bg-white p-8 text-center shadow-elevated">
          <p className="text-[17px] font-medium text-ink">This link isn&apos;t valid</p>
          <p className="mt-2 text-sm text-muted">It may have expired or been revoked. Contact your coach for a fresh link.</p>
        </div>
      </div>
    );
  }

  if (gate === 'needs_mfa') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-white p-8 shadow-elevated">
          <div className="mb-5 h-9 w-9 rounded-full bg-gradient-money" />
          <p className="text-[17px] font-medium text-ink">Verify it&apos;s you</p>
          <p className="mt-2 text-sm text-muted">
            {otpSent ? 'We sent a 6-digit code to your email. Enter it below.' : 'Sending a verification code to your email…'}
          </p>
          {otpSent && (
            <div className="mt-6">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                className="w-full rounded-control border border-line px-4 py-3 text-center text-lg tracking-[6px] text-ink"
              />
              {error && <p className="mt-2 text-sm text-terra">{error}</p>}
              <button
                onClick={verifyCode}
                disabled={code.length !== 6}
                className="mt-4 w-full rounded-control bg-money px-5 py-3 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-40"
              >
                Verify
              </button>
              <button onClick={sendCode} disabled={sending} className="mt-3 w-full text-center text-xs text-muted hover:text-ink">
                {sending ? 'Sending…' : 'Resend code'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const base = `/portal/${token}`;
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-block h-7 w-7 rounded-full bg-gradient-money shadow-glow-money" />
            <span className="text-[15px] font-medium text-ink">CreditCoachIQ</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const href = `${base}${item.href}`;
              const active = pathname === href;
              return (
                <Link
                  key={item.href}
                  href={href}
                  className={`rounded-full px-3 py-1.5 transition-colors ${active ? 'bg-ink text-white' : 'text-muted hover:bg-line/60 hover:text-ink'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
