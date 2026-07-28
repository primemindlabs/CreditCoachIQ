/**
 * Caseload churn-risk scoring. Deterministic and explainable by design —
 * same "deterministic score, not an LLM guess" posture as lib/quiz/score.ts
 * and lib/stacking/recommend.ts elsewhere in this codebase. A number used
 * to prioritize outreach needs to be auditable (a coach should be able to
 * see exactly why a client is flagged), which an LLM-generated raw score
 * wouldn't reliably give — the reasons array below is what actually gets
 * shown, not a black-box number.
 */
export interface ChurnInputs {
  daysInStage: number;
  paymentRetryCount: number;
  openComplaintCount: number;
  journeyStage: string;
}

export interface ChurnRisk {
  score: number; // 0-100, higher = more at risk
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}

export function computeChurnRisk(inputs: ChurnInputs): ChurnRisk {
  let score = 0;
  const reasons: string[] = [];

  if (inputs.paymentRetryCount > 0) {
    score += 40;
    reasons.push('payment failing');
  }
  if (inputs.openComplaintCount > 0) {
    score += 25;
    reasons.push(inputs.openComplaintCount === 1 ? 'open complaint' : `${inputs.openComplaintCount} open complaints`);
  }
  if (inputs.daysInStage > 60) {
    score += 25;
    reasons.push('stalled 60+ days');
  } else if (inputs.daysInStage > 30) {
    score += 12;
    reasons.push('stalled 30+ days');
  }
  if (inputs.journeyStage === 'paused') {
    score += 15;
    reasons.push('plan paused');
  }

  score = Math.min(100, score);
  const level: ChurnRisk['level'] = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';
  return { score, level, reasons };
}
