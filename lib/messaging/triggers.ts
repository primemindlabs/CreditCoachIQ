import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { enrollBorrowerInCampaign } from './enroll';

export type TriggerEvent =
  | 'client_enrolled'
  | 'journey_stage_enter'
  | 'dispute_response_received'
  | 'goal_achieved'
  | 'stack_promo_expiring'
  | 'loan_ready_reached';

/**
 * Fire an event and auto-enroll the client in every active campaign whose
 * trigger matches. Called from lib/journey.ts on stage transitions,
 * app/api/enroll/route.ts on signup, and the stacking-promo cron scan.
 * Never throws — a messaging failure should never block the underlying
 * business action (e.g. a stage transition still succeeds even if the
 * welcome-email campaign lookup errors).
 */
export async function fireTrigger(orgId: string, event: TriggerEvent, opts: { borrowerId: string; stage?: string }): Promise<void> {
  try {
    const sb = createAdminClient();
    const { data: campaigns } = await sb
      .from('campaigns')
      .select('id, trigger_config')
      .eq('org_id', orgId)
      .eq('trigger_type', event)
      .eq('status', 'active');

    for (const campaign of campaigns ?? []) {
      const config = (campaign.trigger_config ?? {}) as { stage?: string };
      if (event === 'journey_stage_enter' && config.stage && config.stage !== opts.stage) continue;
      await enrollBorrowerInCampaign(orgId, campaign.id, opts.borrowerId);
    }
  } catch (err) {
    console.error(`[triggers] fireTrigger(${event}) failed:`, err instanceof Error ? err.message : err);
  }
}
