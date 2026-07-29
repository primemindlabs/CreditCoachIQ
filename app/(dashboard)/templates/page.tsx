'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

interface Template { id: string; name: string; channel: 'email' | 'sms'; subject: string | null; body: string }

const TOKENS = ['first_name', 'coach_first_name', 'current_score', 'target_score', 'stacked_capital', 'journey_stage_label', 'unsubscribe_url'];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draftPurpose, setDraftPurpose] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/templates');
    const data = await res.json();
    setTemplates(data.templates ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, channel, subject: channel === 'email' ? subject : undefined, body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not save this template (${res.status}).`);
        return;
      }
      setName(''); setSubject(''); setBody(''); setShowCreate(false);
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  function insertToken(token: string) {
    setBody((b) => `${b}{{${token}}}`);
  }

  async function draftWithAI() {
    if (!draftPurpose.trim() || drafting) return;
    setDrafting(true);
    const res = await fetch('/api/templates/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: draftPurpose.trim(), channel }),
    });
    const d = await res.json();
    setDrafting(false);
    if (!res.ok) return;
    if (d.subject) setSubject(d.subject);
    setBody(d.body);
  }

  return (
    <div>
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Templates</h1>
          <p className="mt-1 text-sm text-muted">Email and text templates campaign steps send from. Tokens fill in fresh per client at send time.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-control bg-money px-5 py-3 text-sm font-medium text-white hover:bg-money-hover">New template</button>
      </div>

      {error && (
        <div className="mb-6 rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
      )}

      {showCreate && (
        <div className="mb-8 rounded-card border border-line bg-white p-6">
          <div className="mb-4 flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs text-muted">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm" placeholder="Welcome — day 1" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Channel</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'sms')} className="rounded-control border border-line px-3 py-2 text-sm">
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </div>
          {channel === 'email' && (
            <div className="mb-4">
              <label className="mb-1 block text-xs text-muted">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm" placeholder="{{first_name}}, a quick update" />
            </div>
          )}
          <div className="mb-4 rounded-control bg-iris-tint p-3">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink"><Sparkles size={12} strokeWidth={1.75} /> Draft with AI</label>
            <div className="mt-2 flex gap-2">
              <input
                value={draftPurpose}
                onChange={(e) => setDraftPurpose(e.target.value)}
                placeholder="e.g. congratulate a client on a 20-point score jump"
                className="flex-1 rounded-control border border-line bg-white px-3 py-2 text-sm"
              />
              <button onClick={draftWithAI} disabled={drafting || !draftPurpose.trim()} className="shrink-0 rounded-control bg-iris px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {drafting ? 'Drafting…' : 'Draft'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">Fills in the subject/body below — review and edit before saving.</p>
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-muted">Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full rounded-control border border-line px-3 py-2 text-sm" placeholder={`Hi {{first_name}}, your score is now {{current_score}}...`} />
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {TOKENS.map((t) => (
              <button key={t} onClick={() => insertToken(t)} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-money hover:text-money">{'{{' + t + '}}'}</button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={create} className="rounded-control bg-money px-5 py-2.5 text-sm font-medium text-white hover:bg-money-hover">Save template</button>
            <button onClick={() => setShowCreate(false)} className="rounded-control border border-line px-5 py-2.5 text-sm text-ink">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded-card border border-line bg-white p-5">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">{t.name}</p>
              <span className="rounded-full bg-line px-2.5 py-1 text-xs text-muted">{t.channel}</span>
            </div>
            {t.subject && <p className="mb-1 text-xs text-muted">{t.subject}</p>}
            <p className="line-clamp-2 text-xs text-muted">{t.body}</p>
          </div>
        ))}
        {templates.length === 0 && <p className="text-sm text-muted">No templates yet.</p>}
      </div>
    </div>
  );
}
