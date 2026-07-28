import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Rules-of-thumb stack-sequencing suggestion. This is deliberately NOT a
 * prediction model — it's a ranked filter over lender_criteria (a small,
 * hand-seeded reference table of generally-known underwriting patterns,
 * see 0006_nudges_stacking_compliance_billing.sql) against what's already
 * known about the client. It exists to give a coach a sensible starting
 * order, not a guarantee — always presented with that caveat.
 */
export interface StackRecommendation {
  lenderName: string;
  cardOrProduct: string;
  reason: string;
  sortPriority: number;
  meetsKnownCriteria: boolean;
}

export async function recommendStackSequence(orgId: string, borrowerId: string): Promise<StackRecommendation[]> {
  const sb = createAdminClient();

  const [{ data: profiles }, { data: applications }, { data: enrollment }] = await Promise.all([
    sb.from('business_credit_profiles').select('formation_date, bureau_files_established').eq('org_id', orgId).eq('borrower_id', borrowerId).order('created_at', { ascending: true }).limit(1),
    sb.from('credit_stack_applications').select('lender_name').eq('org_id', orgId).eq('borrower_id', borrowerId),
    sb.from('credit_repair_enrollments').select('current_score_exp, current_score_eqx, current_score_tu').eq('org_id', orgId).eq('borrower_id', borrowerId).maybeSingle(),
  ]);

  const alreadyApplied = new Set((applications ?? []).map((a) => (a.lender_name as string)?.toLowerCase()));
  const personalScore = Math.max(enrollment?.current_score_exp ?? 0, enrollment?.current_score_eqx ?? 0, enrollment?.current_score_tu ?? 0) || null;

  const monthsInBusiness = profiles?.[0]?.formation_date
    ? Math.floor((Date.now() - new Date(profiles[0].formation_date as string).getTime()) / (30 * 24 * 60 * 60 * 1000))
    : 0;

  const { data: criteria } = await sb.from('lender_criteria').select('*').eq('is_active', true).order('sort_priority');

  return (criteria ?? [])
    .filter((c) => !alreadyApplied.has((c.lender_name as string).toLowerCase()))
    .map((c) => {
      const meetsTime = monthsInBusiness >= (c.min_time_in_business_months as number);
      const meetsScore = c.min_personal_score == null || personalScore == null || personalScore >= (c.min_personal_score as number);
      const meetsKnownCriteria = meetsTime && meetsScore;
      const gaps: string[] = [];
      if (!meetsTime) gaps.push(`needs ${c.min_time_in_business_months}mo in business (client has ~${monthsInBusiness}mo)`);
      if (!meetsScore && c.min_personal_score != null) gaps.push(`typically wants ${c.min_personal_score}+ personal score`);

      return {
        lenderName: c.lender_name as string,
        cardOrProduct: c.card_or_product as string,
        reason: meetsKnownCriteria ? (c.notes as string) ?? 'Fits known criteria for this client today.' : `Not yet — ${gaps.join('; ')}.`,
        sortPriority: c.sort_priority as number,
        meetsKnownCriteria,
      };
    })
    .sort((a, b) => (a.meetsKnownCriteria === b.meetsKnownCriteria ? a.sortPriority - b.sortPriority : a.meetsKnownCriteria ? -1 : 1));
}
