import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { fireTrigger } from '@/lib/messaging/triggers';

export type JourneyStage = 'credit_coaching' | 'credit_stacking' | 'loan_ready' | 'handed_off' | 'paused' | 'exited';

const ORDER: JourneyStage[] = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off'];

/**
 * Move a client to a new journey stage, with an audit-trail entry.
 *
 * `loan_ready` is a hard gate: it requires an explicit `movedBy` (a coach,
 * never a system/automated actor) and — unless `skipChecklistCheck` is set
 * for testing — that every required loan_ready_checklist_items row for this
 * borrower is already completed. This is deliberate: the journey should
 * never auto-advance a client into "ready to hand to AshleyIQ" on its own.
 */
export async function transitionStage(opts: {
  orgId: string;
  borrowerId: string;
  toStage: JourneyStage;
  movedBy: string | null;
  reason?: string;
  skipChecklistCheck?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = createAdminClient();

  const { data: borrower } = await sb
    .from('borrowers')
    .select('id, journey_stage')
    .eq('id', opts.borrowerId)
    .eq('org_id', opts.orgId)
    .maybeSingle();
  if (!borrower) return { ok: false, error: 'Borrower not found' };

  if (opts.toStage === 'loan_ready') {
    if (!opts.movedBy) return { ok: false, error: 'loan_ready requires an explicit coach sign-off (movedBy)' };
    if (!opts.skipChecklistCheck) {
      const { data: incomplete } = await sb
        .from('loan_ready_checklist_items')
        .select('id')
        .eq('borrower_id', opts.borrowerId)
        .eq('org_id', opts.orgId)
        .eq('is_required', true)
        .is('completed_at', null)
        .limit(1);
      if (incomplete && incomplete.length > 0) {
        return { ok: false, error: 'Required loan-ready checklist items are still incomplete' };
      }
    }
  }

  const { error: updateError } = await sb
    .from('borrowers')
    .update({ journey_stage: opts.toStage, journey_stage_updated_at: new Date().toISOString() })
    .eq('id', opts.borrowerId)
    .eq('org_id', opts.orgId);
  if (updateError) return { ok: false, error: updateError.message };

  await sb.from('journey_stage_events').insert({
    org_id: opts.orgId,
    borrower_id: opts.borrowerId,
    from_stage: borrower.journey_stage,
    to_stage: opts.toStage,
    moved_by: opts.movedBy,
    reason: opts.reason ?? null,
  });

  // Fire-and-forget: never let a messaging hiccup block a stage transition.
  void fireTrigger(opts.orgId, 'journey_stage_enter', { borrowerId: opts.borrowerId, stage: opts.toStage });
  if (opts.toStage === 'loan_ready') {
    void fireTrigger(opts.orgId, 'loan_ready_reached', { borrowerId: opts.borrowerId });
  }

  return { ok: true };
}

export function nextStage(current: JourneyStage): JourneyStage | null {
  const idx = ORDER.indexOf(current);
  if (idx === -1 || idx === ORDER.length - 1) return null;
  return ORDER[idx + 1];
}
