'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface Message { id: string; sender: 'coach' | 'borrower'; body: string; created_at: string; read_at: string | null; }

export default function PortalMessagesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/messages`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not load your messages (${res.status}).`);
        return;
      }
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    const res = await fetch(`/api/portal/${token}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: draft.trim() }),
    });
    setSending(false);
    if (res.ok) {
      setDraft('');
      load();
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-[26px] font-medium text-ink">Messages</h1>

      {error && <p className="mb-4 text-sm text-terra">{error}</p>}

      <div className="mb-4 h-[420px] overflow-y-auto rounded-card border border-line bg-white p-6">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted">No messages yet — send your coach a note anytime.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'borrower' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.sender === 'borrower' ? 'bg-money text-white' : 'bg-line text-ink'
                  }`}
                >
                  {m.body}
                  <div className={`mt-1 text-[10px] ${m.sender === 'borrower' ? 'text-white/70' : 'text-muted'}`}>
                    {new Date(m.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Write a message…"
          className="flex-1 rounded-control border border-line px-4 py-3 text-sm text-ink"
        />
        <button onClick={send} disabled={sending || !draft.trim()} className="rounded-control bg-money px-5 py-3 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
