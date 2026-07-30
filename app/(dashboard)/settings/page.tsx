'use client';

import { useEffect, useState } from 'react';

interface Settings {
  brand_logo_url: string | null;
  brand_primary_color: string | null;
  brand_from_name: string | null;
  embed_enabled?: boolean;
  embed_slug?: string | null;
  embed_headline?: string | null;
  notify_on_item_removed?: boolean;
  notify_on_dispute_sent?: boolean;
  notify_on_bureau_response?: boolean;
  notify_sms_default?: boolean;
  lo_email_override?: string | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ brandLogoUrl: '', brandPrimaryColor: '', brandFromName: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [embedForm, setEmbedForm] = useState({ enabled: false, slug: '', headline: '' });
  const [embedSaving, setEmbedSaving] = useState(false);
  const [embedSaved, setEmbedSaved] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [appOrigin, setAppOrigin] = useState('');

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const [calendarDisconnecting, setCalendarDisconnecting] = useState(false);

  function loadCalendarStatus() {
    setCalendarLoading(true);
    fetch('/api/coach/calendar/google').then((r) => (r.ok ? r.json() : { connected: false })).then((d) => {
      setCalendarConnected(!!d.connected);
      setCalendarEmail(d.connectedEmail ?? null);
      setCalendarLoading(false);
    });
  }

  async function disconnectCalendar() {
    setCalendarDisconnecting(true);
    try {
      await fetch('/api/coach/calendar/google', { method: 'DELETE' });
      loadCalendarStatus();
    } finally {
      setCalendarDisconnecting(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarResult = params.get('calendar');
    if (calendarResult === 'connected') setCalendarMsg('Google Calendar connected.');
    else if (calendarResult === 'error') setCalendarMsg('Could not connect Google Calendar. Try again.');
    else if (calendarResult === 'no_refresh_token') setCalendarMsg('Google didn’t return a refresh token. Try disconnecting your CreditCoachIQ access at myaccount.google.com/permissions and reconnecting.');
    else if (calendarResult === 'state_mismatch') setCalendarMsg('That connection attempt expired. Try again.');
    if (calendarResult) window.history.replaceState({}, '', window.location.pathname);
    loadCalendarStatus();
  }, []);

  useEffect(() => {
    setAppOrigin(window.location.origin);
    fetch('/api/settings').then((r) => (r.ok ? r.json() : { settings: null })).then((d) => {
      setSettings(d.settings);
      setForm({
        brandLogoUrl: d.settings?.brand_logo_url ?? '',
        brandPrimaryColor: d.settings?.brand_primary_color ?? '',
        brandFromName: d.settings?.brand_from_name ?? '',
      });
      setEmbedForm({
        enabled: d.settings?.embed_enabled ?? false,
        slug: d.settings?.embed_slug ?? '',
        headline: d.settings?.embed_headline ?? '',
      });
      setLoading(false);
    });
  }, []);

  async function saveEmbed() {
    setEmbedSaving(true);
    setEmbedSaved(false);
    setEmbedError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embed_enabled: embedForm.enabled,
          embed_slug: embedForm.slug || null,
          embed_headline: embedForm.headline || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setEmbedError(d.error ?? `Could not save (${res.status}).`);
        return;
      }
      setEmbedSaved(true);
    } catch {
      setEmbedError('Could not reach the server.');
    } finally {
      setEmbedSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_logo_url: form.brandLogoUrl || null,
          brand_primary_color: form.brandPrimaryColor || null,
          brand_from_name: form.brandFromName || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not save settings (${res.status}).`);
        return;
      }
      setSaved(true);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <h1 className="text-[26px] font-medium text-ink">Settings</h1>
      <p className="mt-1 mb-8 text-sm text-muted">Organization-wide configuration.</p>

      <div className="rounded-card border border-line bg-white p-6">
        <p className="mb-1 text-sm font-medium text-ink">Branding</p>
        <p className="mb-5 text-xs text-muted">
          Set once, applied everywhere: the client portal, dispute-letter letterheads, and outbound email &quot;from&quot; name.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm text-ink">
            Logo URL
            <input
              value={form.brandLogoUrl}
              onChange={(e) => setForm({ ...form, brandLogoUrl: e.target.value })}
              placeholder="https://…/logo.png"
              className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-ink">
            Primary color
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(form.brandPrimaryColor) ? form.brandPrimaryColor : '#0f9d58'}
                onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded-control border border-line"
              />
              <input
                value={form.brandPrimaryColor}
                onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                placeholder="#0F9D58"
                className="w-full rounded-control border border-line px-3 py-2 text-sm"
              />
            </div>
          </label>
          <label className="text-sm text-ink sm:col-span-2">
            From name
            <input
              value={form.brandFromName}
              onChange={(e) => setForm({ ...form, brandFromName: e.target.value })}
              placeholder="Your Company Name"
              className="mt-1 w-full max-w-sm rounded-control border border-line px-3 py-2 text-sm"
            />
          </label>
        </div>

        {form.brandLogoUrl && (
          <div className="mt-5 rounded-control border border-line bg-paper p-4">
            <p className="mb-2 text-xs text-muted">Preview</p>
            <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: form.brandPrimaryColor || undefined }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.brandLogoUrl} alt="Logo preview" className="h-6 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span className="text-sm font-medium text-ink">{form.brandFromName || 'Your Company Name'}</span>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-terra">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
            {saving ? 'Saving…' : 'Save branding'}
          </button>
          {saved && !saving && <span className="text-xs text-money">Saved</span>}
        </div>
      </div>

      {/* Google Calendar — two-way sync per coach. Confirmed bookings push
          onto the coach's own calendar; the coach's calendar events for
          today read back into the Today page. */}
      <div className="mt-6 rounded-card border border-line bg-white p-6">
        <p className="mb-1 text-sm font-medium text-ink">Google Calendar</p>
        <p className="mb-4 text-xs text-muted">
          Connect your own Google Calendar. Confirmed portal bookings are added to it automatically, and today&apos;s events from it show up on your Today page.
        </p>
        {calendarMsg && <p className="mb-3 text-xs text-ink">{calendarMsg}</p>}
        {calendarLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : calendarConnected ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-money-tint px-2.5 py-1 text-xs font-medium text-money-hover">Connected{calendarEmail ? ` · ${calendarEmail}` : ''}</span>
            <button onClick={disconnectCalendar} disabled={calendarDisconnecting} className="text-xs text-muted hover:text-terra disabled:opacity-50">
              {calendarDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <a href="/api/coach/calendar/google/connect" className="inline-block rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">
            Connect Google Calendar
          </a>
        )}
      </div>

      {/* Public lead-capture form — creditcoachiq.com/apply/{slug}, writes
          directly into the Leads pipeline with lead_source='embed'. */}
      <div className="mt-6 rounded-card border border-line bg-white p-6">
        <p className="mb-1 text-sm font-medium text-ink">Lead capture page</p>
        <p className="mb-5 text-xs text-muted">
          A hosted, brandable form you can link to or embed anywhere. Submissions land directly in your Leads tab.
        </p>

        <label className="mb-4 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={embedForm.enabled} onChange={(e) => setEmbedForm({ ...embedForm, enabled: e.target.checked })} />
          Enabled
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm text-ink">
            URL slug
            <div className="mt-1 flex items-center overflow-hidden rounded-control border border-line">
              <span className="whitespace-nowrap bg-paper px-2.5 py-2 text-xs text-muted">/apply/</span>
              <input
                value={embedForm.slug}
                onChange={(e) => setEmbedForm({ ...embedForm, slug: e.target.value.toLowerCase() })}
                placeholder="equitynest"
                className="w-full px-2 py-2 text-sm outline-none"
              />
            </div>
          </label>
          <label className="text-sm text-ink sm:col-span-2">
            Headline
            <input
              value={embedForm.headline}
              onChange={(e) => setEmbedForm({ ...embedForm, headline: e.target.value })}
              placeholder="Start your credit journey today"
              className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm"
            />
          </label>
        </div>

        {embedForm.slug && (
          <div className="mt-4 flex items-center gap-2 rounded-control border border-line bg-paper px-3 py-2 text-xs text-muted">
            <span className="truncate">{appOrigin}/apply/{embedForm.slug}</span>
            <button
              onClick={() => navigator.clipboard.writeText(`${appOrigin}/apply/${embedForm.slug}`)}
              className="ml-auto shrink-0 text-money hover:underline"
            >
              Copy link
            </button>
          </div>
        )}

        {embedError && <p className="mt-3 text-xs text-terra">{embedError}</p>}
        <div className="mt-5 flex items-center gap-3">
          <button onClick={saveEmbed} disabled={embedSaving} className="rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
            {embedSaving ? 'Saving…' : 'Save lead capture settings'}
          </button>
          {embedSaved && !embedSaving && <span className="text-xs text-money">Saved</span>}
        </div>
      </div>
    </div>
  );
}
