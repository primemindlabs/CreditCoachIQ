'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Question {
  id: string;
  question_order: number;
  question_key: string;
  prompt: string;
  question_type: 'single_select' | 'multi_select' | 'text' | 'number';
  options: string[] | null;
  helper_text: string | null;
  is_required: boolean;
}

interface QuizResponse { id: string; status: string; completed_at: string | null; recommended_plan_tier: string | null; }

export default function PortalQuizPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [response, setResponse] = useState<QuizResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smartCreditUrl, setSmartCreditUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/portal/${token}/quiz`);
    const data = await res.json();
    setQuestions(data.questions ?? []);
    setResponse(data.response ?? null);
    const initial: Record<string, string | string[]> = {};
    for (const a of data.existingAnswers ?? []) initial[a.question_id] = a.answer;
    setAnswers(initial);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function setAnswer(questionId: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function toggleMulti(questionId: string, option: string) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
      const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
      return { ...prev, [questionId]: next };
    });
  }

  async function submit() {
    setError(null);
    const missing = questions.filter((q) => q.is_required && !answers[q.id]);
    if (missing.length > 0) {
      setError(`Please answer: ${missing[0].prompt}`);
      return;
    }
    setSubmitting(true);
    const payload = {
      answers: questions.map((q) => ({ questionId: q.id, value: answers[q.id] })).filter((a) => a.value !== undefined),
      smartCreditClicked: !!smartCreditUrl,
    };
    const res = await fetch(`/api/portal/${token}/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Could not submit');
      return;
    }
    router.push(`/portal/${token}`);
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  if (response?.status === 'completed') {
    return (
      <div className="rounded-card border border-line bg-white p-8 text-center">
        <p className="text-[17px] font-medium text-ink">You&apos;re all set</p>
        <p className="mt-2 text-sm text-muted">Your coach has your quiz results and will be ready for your call.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[26px] font-medium text-ink">Quick prep quiz</h1>
      <p className="mt-1 mb-8 text-sm text-muted">A few minutes now means your coach comes prepared with a plan specific to you.</p>

      <div className="space-y-6">
        {questions.map((q) => (
          <div key={q.id} className="rounded-card border border-line bg-white p-6">
            <p className="text-[15px] font-medium text-ink">{q.prompt}{q.is_required && <span className="text-terra"> *</span>}</p>
            {q.helper_text && <p className="mt-1 text-sm text-muted">{q.helper_text}</p>}

            <div className="mt-4">
              {q.question_type === 'single_select' && q.options && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswer(q.id, opt)}
                      className={`rounded-control border px-4 py-2 text-sm ${
                        answers[q.id] === opt ? 'border-money bg-money-tint text-money-hover' : 'border-line text-ink hover:border-ink/30'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {q.question_type === 'multi_select' && q.options && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => {
                    const selected = Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggleMulti(q.id, opt)}
                        className={`rounded-control border px-4 py-2 text-sm ${selected ? 'border-money bg-money-tint text-money-hover' : 'border-line text-ink hover:border-ink/30'}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {(q.question_type === 'text' || q.question_type === 'number') && (
                <input
                  type={q.question_type === 'number' ? 'number' : 'text'}
                  value={(answers[q.id] as string) ?? ''}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="w-full rounded-control border border-line px-4 py-2.5 text-sm text-ink"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-terra">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-6 w-full rounded-control bg-money px-5 py-3 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  );
}
