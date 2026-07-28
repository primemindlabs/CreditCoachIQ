/**
 * Tier feature-gating. A client's `plan_tier` determines which modules
 * their record is allowed to touch — this is enforced server-side in each
 * module's API routes, not just hidden in the UI.
 */
export type PlanTier = 'credit_coaching' | 'wealth_coaching' | 'investor_path';

const TIER_FEATURES: Record<PlanTier, string[]> = {
  // ai_chat and ai_score_explainer are core credit-repair Q&A, not an
  // upsell — every tier includes them. ai_spending_digest reads Plaid
  // transaction data, which only exists once budgeting is part of the
  // client's plan, so it's gated the same as wealth_coaching itself.
  credit_coaching: ['credit_repair', 'ai_chat', 'ai_score_explainer'],
  wealth_coaching: ['credit_repair', 'wealth_coaching', 'ai_chat', 'ai_score_explainer', 'ai_spending_digest'],
  investor_path: ['credit_repair', 'wealth_coaching', 'credit_stacking', 'ashleyiq_handoff', 'ai_chat', 'ai_score_explainer', 'ai_spending_digest'],
};

export type Feature =
  | 'credit_repair' | 'wealth_coaching' | 'credit_stacking' | 'ashleyiq_handoff'
  | 'ai_chat' | 'ai_score_explainer' | 'ai_spending_digest';

export function tierIncludes(tier: string, feature: Feature): boolean {
  const features = TIER_FEATURES[tier as PlanTier];
  return features ? features.includes(feature) : false;
}

export function assertTierIncludes(tier: string, feature: Feature): void {
  if (!tierIncludes(tier, feature)) {
    throw new PlanGateError(`Plan tier "${tier}" does not include "${feature}".`);
  }
}

export class PlanGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanGateError';
  }
}

/**
 * Portal call-booking allowance per tier — calls permitted in a trailing
 * 30-day window. Enforced in app/api/portal/[token]/booking (GET usage,
 * blocks the booking link once exhausted) — the Calendly webhook is still
 * the source of truth for what actually got booked, this just gates access.
 */
const CALL_ALLOWANCE: Record<PlanTier, number> = {
  credit_coaching: 1,
  wealth_coaching: 2,
  investor_path: 4,
};

export function getCallAllowance(tier: string): number {
  return CALL_ALLOWANCE[tier as PlanTier] ?? 0;
}
