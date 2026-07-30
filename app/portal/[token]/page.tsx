'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Landmark, Phone, MessageCircle, Check, Lock, PartyPopper, X, Send } from 'lucide-react';
import RadialScore from '@/components/ui/RadialScore';
import Sparkline from '@/components/ui/Sparkline';
import StatCard from '@/components/ui/StatCard';

interface Overview {
  firstName: string;
  planTier: string;
  journeyStage: string;
  stageSince: string;
  coachName: string | null;
  credit: { currentScore: number | null; targetScore: number | null; status: string } | null;
  croaSigned: boolean;
  scoreHistory: { date: string; score: number }[];
  stackedCapital: number;
  goals: { id: string; title: string; target_amount: number; current_amount: number; target_date: string | null }[];
  quiz: { status: string; recommendedTier: string; completedAt: string | null } | null;
  upcomingCall: { id: string; scheduled_at: string; status: string } | null;
  callAllowance: { used: number; total: number; remaining: number };
  unreadMessages: number;
}

interface PlaidAccount { id: string; institution_name: string; status: string; last_synced_at: string | null; }
interface PlaidTx { id: string; amount: number; merchant_name: string | null; category: string | null; posted_at: string; }

const JOURNEY_STAGES = [
  { key: 'credit_coaching', label: 'Credit coaching' },
  { key: 'credit_stacking', label: 'Credit stacking' },
  { key: 'loan_ready', label: 'Loan ready' },
  { key: 'handed_off', label: 'Handed off' },
] as const;

function currency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function PortalOverviewPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [plaidConfigured, setPlaidConfigured] = useState(false);
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<PlaidTx[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ type: 'score'; delta: number; score: number } | { type: 'goal'; title: string } | null>(null);
  const [scoreExplanation, setScoreExplanation] = useState<string | null>(null);
  const [spendingDigest, setSpendingDigest] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, plaidRes] = await Promise.all([
        fetch(`/api/portal/${token}/overview`),
        fetch(`/api/portal/${token}/plaid/accounts`),
      ]);
      if (!ovRes.ok) {
        const d = await ovRes.json().catch(() => ({}));
        setError(d.error ?? `Could not load your dashboard (${ovRes.status}).`);
        return;
      }
      if (!plaidRes.ok) {
        const d = await plaidRes.json().catch(() => ({}));
        setError(d.error ?? `Could not load your linked accounts (${plaidRes.status}).`);
        return;
      }
      const ov = await ovRes.json();
      const plaid = await plaidRes.json();
      setData(ov);
      setPlaidConfigured(!!plaid.configured);
      setAccounts(plaid.accounts ?? []);
      setTransactions(plaid.recentTransactions ?? []);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Milestone celebration — a real score increase (comparing the last two
  // real report-upload scores) or a goal actually reaching its target.
  // localStorage remembers what's already been celebrated per token/goal so
  // this shows once, then recedes, per DESIGN_DIRECTION.md's spec.
  useEffect(() => {
    if (!data || typeof window === 'undefined') return;
    const hist = data.scoreHistory;
    if (hist.length >= 2) {
      const latest = hist[hist.length - 1].score;
      const previous = hist[hist.length - 2].score;
      const key = `ccq_celebrated_score_${token}`;
      const lastCelebrated = Number(window.localStorage.getItem(key) ?? '0');
      if (latest > previous && latest > lastCelebrated) {
        setCelebration({ type: 'score', delta: latest - previous, score: latest });
        window.localStorage.setItem(key, String(latest));
        fetch(`/api/portal/${token}/score-explanation?from=${previous}&to=${latest}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => setScoreExplanation(d?.explanation ?? null))
          .catch(() => undefined);
        return;
      }
    }
    for (const g of data.goals) {
      if (g.target_amount > 0 && g.current_amount >= g.target_amount) {
        const key = `ccq_celebrated_goal_${g.id}`;
        if (!window.localStorage.getItem(key)) {
          setCelebration({ type: 'goal', title: g.title });
          window.localStorage.setItem(key, '1');
          return;
        }
      }
    }
  }, [data, token]);

  // Fetch the spending digest once there's something to summarize — no
  // point calling Haiku over zero transactions.
  useEffect(() => {
    if (accounts.length === 0 || spendingDigest) return;
    fetch(`/api/portal/${token}/spending-digest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSpendingDigest(d?.digest ?? null))
      .catch(() => undefined);
  }, [accounts.length, spendingDigest, token]);

  async function sendChatMessage() {
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    const nextMessages = [...chatMessages, { role: 'user' as const, content: question }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch(`/api/portal/${token}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: chatMessages }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setChatMessages([...nextMessages, { role: 'assistant', content: d.error ?? 'Something went wrong.' }]);
        return;
      }
      const d = await res.json();
      setChatMessages([...nextMessages, { role: 'assistant', content: d.answer }]);
    } catch {
      setChatMessages([...nextMessages, { role: 'assistant', content: 'Could not reach the server. Check your connection and try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function linkBank() {
    setLinkError(null);
    setLinking(true);
    const res = await fetch(`/api/portal/${token}/plaid/link-token`);
    const linkData = await res.json();
    if (!linkData.configured) {
      setLinking(false);
      setLinkError('Bank linking isn’t enabled yet. Ask your coach.');
      return;
    }
    if (linkData.error || !linkData.linkToken) {
      setLinking(false);
      setLinkError(linkData.error ?? 'Could not start bank linking.');
      return;
    }

    // Load Plaid's hosted Link script on demand rather than bundling a
    // client SDK dependency for a feature most orgs won't have keys for yet.
    if (!(window as any).Plaid) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load Plaid'));
        document.body.appendChild(script);
      }).catch(() => setLinkError('Could not load bank linking. Try again.'));
    }

    const plaidHandler = (window as any).Plaid?.create({
      token: linkData.linkToken,
      onSuccess: async (publicToken: string, metadata: any) => {
        await fetch(`/api/portal/${token}/plaid/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken, institutionName: metadata?.institution?.name }),
        });
        setLinking(false);
        load();
      },
      onExit: () => setLinking(false),
    });
    plaidHandler?.open();
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {error ? <p className="text-sm text-terra">{error}</p> : <p className="text-sm text-muted">Loading…</p>}
      </div>
    );
  }

  const stageIndex = JOURNEY_STAGES.findIndex((s) => s.key === data.journeyStage);
  const scoreValues = data.scoreHistory.map((h) => h.score);

  // Setup-progress checklist — every item reflects real state already
  // fetched for this page (quiz status, CROA signature, a booked call, a
  // goal on file, and — only when the org has Plaid configured — a linked
  // bank account). Deliberately hidden once everything's done rather than
  // sticking around as permanent clutter.
  const checklist = [
    { label: 'Complete your intake quiz', done: data.quiz?.status === 'completed' },
    { label: 'Sign your agreement', done: data.croaSigned },
    { label: 'Book your first call', done: !!data.upcomingCall },
    { label: 'Set a goal', done: data.goals.length > 0 },
    ...(plaidConfigured ? [{ label: 'Link a bank account', done: accounts.length > 0 }] : []),
  ];
  const checklistDone = checklist.filter((c) => c.done).length;

  return (
    <div className="space-y-6">
      {celebration && (
        <div className="relative overflow-hidden rounded-card border border-line bg-money-tint p-6">
          <button onClick={() => setCelebration(null)} aria-label="Dismiss" className="absolute right-4 top-4 text-money-hover/60 hover:text-money-hover">
            <X size={16} strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-4">
            <PartyPopper size={24} strokeWidth={1.5} className="text-money-hover" />
            <div>
              {celebration.type === 'score' ? (
                <>
                  <p className="text-[16px] font-medium text-ink">Your score went up <span className="figure">{celebration.delta}</span> points</p>
                  <p className="mt-1 text-sm text-money-hover">{scoreExplanation ?? `Now at ${celebration.score}. Keep it up.`}</p>
                </>
              ) : (
                <>
                  <p className="text-[16px] font-medium text-ink">Goal achieved: {celebration.title}</p>
                  <p className="mt-1 text-sm text-money-hover">Nice work. Talk to your coach about what's next.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hero — the one moment on the screen with real weight, but flat:
          bordered white card, oversized precise type, a plain score ring.
          No dark surface, no gradient — see DESIGN_DIRECTION.md v4. */}
      <div className="rounded-card border border-line bg-white p-8 shadow-card">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <p className="text-[12px] uppercase tracking-wide text-muted">{data.coachName ? `Coached by ${data.coachName}` : 'Welcome'}</p>
            <h1 className="mt-1 text-[30px] font-medium leading-tight text-ink">Welcome back, {data.firstName}</h1>
            <p className="mt-2 text-sm text-muted">
              {data.planTier.replace('_', ' ')} plan · {(stageIndex >= 0 ? JOURNEY_STAGES[stageIndex].label : data.journeyStage.replace('_', ' '))}
            </p>
            {scoreValues.length >= 2 && (
              <div className="mt-6">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Score trend</p>
                <Sparkline values={scoreValues} color="#0F9D58" width={180} height={44} />
              </div>
            )}
          </div>
          {data.credit && <RadialScore score={data.credit.currentScore} target={data.credit.targetScore} size={140} />}
        </div>
      </div>

      {checklistDone < checklist.length && (
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Get set up</p>
            <span className="text-xs text-muted">{checklistDone} of {checklist.length} done</span>
          </div>
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-money transition-all duration-700" style={{ width: `${(checklistDone / checklist.length) * 100}%` }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {checklist.map((item) => (
              <span
                key={item.label}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${item.done ? 'bg-money-tint text-money-hover' : 'bg-line text-muted'}`}
              >
                {item.done && <Check size={12} strokeWidth={2.5} />}
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* "You are here" journey map */}
      <div className="rounded-card border border-line bg-white p-6 shadow-card">
        <p className="mb-5 text-sm font-medium text-ink">Your journey</p>
        {stageIndex === -1 ? (
          <p className="text-sm text-muted">Your plan is currently {data.journeyStage.replace('_', ' ')}.</p>
        ) : (
          <div className="flex items-center">
            {JOURNEY_STAGES.map((stage, i) => {
              const done = i < stageIndex;
              const current = i === stageIndex;
              return (
                <div key={stage.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`figure flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium ${
                        current ? 'bg-money text-white' : done ? 'bg-money-tint text-money-hover' : 'bg-line text-muted'
                      }`}
                    >
                      {i + 1}
                    </div>
                    <p className={`mt-2 max-w-[80px] text-center text-xs ${current ? 'font-medium text-ink' : 'text-muted'}`}>{stage.label}</p>
                  </div>
                  {i < JOURNEY_STAGES.length - 1 && <div className={`mx-2 h-px flex-1 ${done ? 'bg-money' : 'bg-line'}`} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Stacked capital" value={currency(data.stackedCapital)} accent="money" icon={<Landmark size={16} strokeWidth={1.75} />} />
        <StatCard
          label="Calls remaining"
          value={`${data.callAllowance.remaining}/${data.callAllowance.total}`}
          accent="iris"
          icon={<Phone size={16} strokeWidth={1.75} />}
          sub={
            data.upcomingCall ? (
              `Next call ${new Date(data.upcomingCall.scheduled_at).toLocaleDateString()}`
            ) : (
              <Link href={`/portal/${token}/booking`} className="text-money underline underline-offset-2 hover:no-underline">
                Book a call →
              </Link>
            )
          }
        />
      </div>

      {data.goals.length > 0 && (
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-4 text-sm font-medium text-ink">Goals</p>
          <div className="space-y-4">
            {data.goals.map((g) => {
              const pct = g.target_amount > 0 ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100)) : 0;
              return (
                <div key={g.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-ink">{g.title}</span>
                    <span className="text-muted">{currency(g.current_amount)} / {g.target_amount ? currency(g.target_amount) : '—'}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-money" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-card border border-line bg-white p-6 shadow-card">
        <div className="flex items-center gap-2 text-ink">
          <MessageCircle size={16} strokeWidth={1.75} className="text-muted" />
          <p className="text-sm font-medium">Messages</p>
        </div>
        <p className="mt-1 text-sm text-muted">{data.unreadMessages > 0 ? `${data.unreadMessages} unread` : 'All caught up'}</p>
        <Link href={`/portal/${token}/messages`} className="mt-3 inline-block rounded-control border border-line px-4 py-2 text-sm text-ink hover:border-ink/30">
          Open messages
        </Link>
      </div>

      {data.quiz?.status !== 'completed' && (
        <div className="rounded-card bg-money-tint p-6">
          <p className="text-sm font-medium text-ink">Quick prep before your call</p>
          <p className="mt-1 text-sm text-muted">Take 2 minutes to complete your intake quiz so your coach can prep for your goals.</p>
          <Link href={`/portal/${token}/quiz`} className="mt-3 inline-block rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">
            Take the quiz
          </Link>
        </div>
      )}

      {/* Bank linking */}
      {plaidConfigured && (
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Linked accounts</p>
            <button onClick={linkBank} disabled={linking} className="rounded-control border border-line px-4 py-2 text-sm text-ink hover:border-ink/30 disabled:opacity-50">
              {linking ? 'Connecting…' : 'Link a bank account'}
            </button>
          </div>
          <p className="mb-4 flex items-center gap-1 text-xs text-muted">
            <Lock size={11} strokeWidth={2} /> Bank-grade encryption via Plaid. We never see or store your login credentials.
          </p>
          {linkError && <p className="mb-3 text-sm text-terra">{linkError}</p>}
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">No accounts linked yet. Linking lets your coach see real spending trends alongside your budget.</p>
          ) : (
            <>
              {spendingDigest && (
                <div className="mb-4 rounded-control bg-iris-tint p-4 text-sm text-ink">{spendingDigest}</div>
              )}
              <div className="mb-4 space-y-2">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{a.institution_name}</span>
                    <span className="text-muted">{a.status}</span>
                  </div>
                ))}
              </div>
              {transactions.length > 0 && (
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-xs text-muted">Recent transactions</p>
                  <div className="space-y-1.5">
                    {transactions.slice(0, 8).map((t) => (
                      <div key={t.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{t.merchant_name ?? 'Transaction'}</span>
                        <span className="text-muted">{currency(t.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Grounded assistant — answers only from this client's own data (see
          app/api/portal/[token]/chat/route.ts). Fixed widget so it's
          reachable from anywhere on the overview without a page nav. */}
      <div className="fixed bottom-6 right-6 z-20">
        {chatOpen ? (
          <div className="flex h-[420px] w-[340px] flex-col overflow-hidden rounded-card border border-line bg-white shadow-elevated">
            <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 text-white">
              <span className="text-sm font-medium">Ask about your credit</span>
              <button onClick={() => setChatOpen(false)} aria-label="Close"><X size={16} strokeWidth={1.75} /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {chatMessages.length === 0 && (
                <p className="text-xs text-muted">Ask things like &ldquo;what does this negative remark mean&rdquo; or &ldquo;why can&apos;t I dispute this yet&rdquo;, answered from your own account data.</p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`rounded-control px-3 py-2 text-sm ${m.role === 'user' ? 'ml-6 bg-iris-tint text-ink' : 'mr-6 bg-paper text-ink'}`}>
                  {m.content}
                </div>
              ))}
              {chatLoading && <div className="mr-6 rounded-control bg-paper px-3 py-2 text-sm text-muted">Thinking…</div>}
            </div>
            <div className="flex items-center gap-2 border-t border-line p-3">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Ask a question…"
                className="flex-1 rounded-control border border-line px-3 py-2 text-sm focus:border-ink/30 focus:outline-none"
              />
              <button onClick={sendChatMessage} disabled={chatLoading} className="rounded-control bg-iris px-3 py-2 text-white disabled:opacity-50">
                <Send size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-elevated hover:bg-ink/90"
          >
            <MessageCircle size={15} strokeWidth={1.75} /> Ask a question
          </button>
        )}
      </div>
    </div>
  );
}
