import 'server-only';
import type { PlanTier } from '@/lib/plans';

export interface QuizQuestion {
  id: string;
  question_key: string | null;
  question_type: 'single_choice' | 'multi_choice' | 'scale' | 'text' | 'number';
  options: { value: string; label: string; path_weight?: { tier: PlanTier; points: number } }[] | null;
}

export interface QuizAnswerInput {
  questionId: string;
  value: string | string[] | number | null;
}

export interface QuizScoreResult {
  recommendedTier: PlanTier;
  recommendedFocus: string;
  pathScore: Record<PlanTier, number>;
  selfReportedScore: number | null;
  primaryGoal: string | null;
  goalNotes: string | null;
}

const TIER_PRIORITY: PlanTier[] = ['investor_path', 'wealth_coaching', 'credit_coaching'];

/**
 * Deterministic path scoring. Every choice-type answer contributes its
 * option's path_weight to a running per-tier total; self_reported_score
 * (a plain number question) is scored via a fixed heuristic below since it
 * can't carry a path_weight in its own options. Ties break toward the
 * higher tier in TIER_PRIORITY — when signals are mixed, the Investor Path
 * conversation is worth having, and a coach can always downgrade after the call.
 *
 * This produces a deterministic, always-available recommendation even if
 * the AI summary call fails — the AI layer (summarize.ts) only adds the
 * narrative prep brief on top.
 */
export function scoreQuizResponse(questions: QuizQuestion[], answers: QuizAnswerInput[]): QuizScoreResult {
  const score: Record<PlanTier, number> = { credit_coaching: 0, wealth_coaching: 0, investor_path: 0 };
  const byId = new Map(questions.map((q) => [q.id, q]));

  let selfReportedScore: number | null = null;
  let primaryGoal: string | null = null;
  let goalNotes: string | null = null;

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) continue;

    if (question.question_key === 'self_reported_score' && typeof answer.value === 'number') {
      selfReportedScore = answer.value;
      if (answer.value < 600) score.credit_coaching += 3;
      else if (answer.value < 680) score.credit_coaching += 1;
      else score.wealth_coaching += 2;
      continue;
    }
    if (question.question_key === 'primary_goal' && typeof answer.value === 'string') primaryGoal = answer.value;
    if (question.question_key === 'goal_notes' && typeof answer.value === 'string') goalNotes = answer.value;

    if (!question.options) continue;
    const selectedValues = Array.isArray(answer.value) ? answer.value : answer.value != null ? [String(answer.value)] : [];
    for (const val of selectedValues) {
      const opt = question.options.find((o) => o.value === val);
      if (opt?.path_weight) score[opt.path_weight.tier] += opt.path_weight.points;
    }
  }

  let recommendedTier: PlanTier = 'credit_coaching';
  let best = -1;
  for (const tier of TIER_PRIORITY) {
    if (score[tier] > best) {
      best = score[tier];
      recommendedTier = tier;
    }
  }

  const focusByTier: Record<PlanTier, string> = {
    credit_coaching: 'Lead with credit repair fundamentals — dispute strategy and score-building timeline.',
    wealth_coaching: 'Lead with budgeting/debt-payoff — client is focused on financial fundamentals, not investing yet.',
    investor_path: 'Lead with the Investor Path — client is showing signals toward credit stacking and funding readiness.',
  };

  return {
    recommendedTier,
    recommendedFocus: focusByTier[recommendedTier],
    pathScore: score,
    selfReportedScore,
    primaryGoal,
    goalNotes,
  };
}
