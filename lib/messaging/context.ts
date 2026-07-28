import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { stageLabel, type MessageContext } from './render';

/**
 * Assemble the personalization context for a client — pulled fresh at send
 * time, not cached, so "current_score" and "stacked_capital" are always
 * today's numbers, not whatever they were when the campaign was built. This
 * is the mechanism that makes an automated sequence feel personal: the coach
 * writes one template with {{current_score}} in it once, and every client
 * who receives it sees their own number.
 */
export async function buildMessageContext(orgId: string, borrowerId: string): Promise<MessageContext> {
  const sb = createAdminClient();

  const { data: borrower } = await sb
    .from('borrowers')
    .select('first_name, last_name, journey_stage, assigned_agent_id, unsubscribe_token')
    .eq('id', borrowerId)
    .eq('org_id', orgId)
    .maybeSingle();

  const [{ data: coach }, { data: enrollment }, { data: stackApps }] = await Promise.all([
    borrower?.assigned_agent_id
      ? sb.from('profiles').select('first_name').eq('id', borrower.assigned_agent_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from('credit_repair_enrollments').select('current_score_exp, target_score').eq('borrower_id', borrowerId).eq('org_id', orgId).maybeSingle(),
    sb.from('credit_stack_applications').select('approved_limit').eq('borrower_id', borrowerId).eq('org_id', orgId).eq('status', 'active'),
  ]);

  const stackedCapital = (stackApps ?? []).reduce((s, a) => s + (Number(a.approved_limit) || 0), 0);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://creditcoachiq.com';

  return {
    first_name: borrower?.first_name ?? 'there',
    last_name: borrower?.last_name ?? '',
    coach_first_name: (coach as { first_name?: string } | null)?.first_name ?? 'your coach',
    current_score: enrollment?.current_score_exp ?? '',
    target_score: enrollment?.target_score ?? '',
    stacked_capital: stackedCapital ? `$${stackedCapital.toLocaleString()}` : '',
    journey_stage_label: stageLabel(borrower?.journey_stage ?? 'credit_coaching'),
    unsubscribe_url: `${appUrl}/api/messaging/unsubscribe?token=${borrower?.unsubscribe_token ?? ''}`,
  };
}
