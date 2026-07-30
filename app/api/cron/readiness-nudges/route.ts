import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Daily scan: nudge the assigned coach when a client crosses a stage
 * threshold — score target hit, or stacking capital target hit — so
 * "ready to advance" isn't something a coach has to remember to check for
 * manually. Dedupes against an existing open task of the same type so a
 * client hovering right at the threshold doesn't spam the queue.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createAdminClient();
  let scoreNudges = 0;
  let capitalNudges = 0;

  // Score target hit — active enrollments where current score meets/exceeds target and hasn't been flagged.
  const { data: enrollments } = await sb
    .from('credit_repair_enrollments')
    .select('id, org_id, borrower_id, target_score, current_score_exp, current_score_eqx, current_score_tu')
    .eq('status', 'active');

  for (const e of enrollments ?? []) {
    const best = Math.max(e.current_score_exp ?? 0, e.current_score_eqx ?? 0, e.current_score_tu ?? 0);
    if (best < (e.target_score ?? 640)) continue;

    const { data: existing } = await sb.from('coach_tasks').select('id').eq('org_id', e.org_id).eq('borrower_id', e.borrower_id).eq('type', 'score_target_hit').is('completed_at', null).maybeSingle();
    if (existing) continue;

    const { data: borrower } = await sb.from('borrowers').select('assigned_agent_id').eq('id', e.borrower_id).maybeSingle();
    await sb.from('coach_tasks').insert({
      org_id: e.org_id, borrower_id: e.borrower_id, assigned_to: borrower?.assigned_agent_id ?? null,
      source: 'system', type: 'score_target_hit', title: `Score target hit (${best}), ready to advance?`, due_date: new Date().toISOString().slice(0, 10),
    });
    scoreNudges += 1;
  }

  // Stack capital target hit — active credit_stack_plans where approved capital meets/exceeds target_capital.
  const { data: plans } = await sb.from('credit_stack_plans').select('id, org_id, borrower_id, target_capital').eq('status', 'in_progress');
  for (const plan of plans ?? []) {
    const { data: apps } = await sb.from('credit_stack_applications').select('approved_limit').eq('org_id', plan.org_id).eq('borrower_id', plan.borrower_id).eq('status', 'active');
    const capital = (apps ?? []).reduce((s, a) => s + (Number(a.approved_limit) || 0), 0);
    if (capital < Number(plan.target_capital)) continue;

    const { data: existing } = await sb.from('coach_tasks').select('id').eq('org_id', plan.org_id).eq('borrower_id', plan.borrower_id).eq('type', 'stack_target_hit').is('completed_at', null).maybeSingle();
    if (existing) continue;

    const { data: borrower } = await sb.from('borrowers').select('assigned_agent_id').eq('id', plan.borrower_id).maybeSingle();
    await sb.from('coach_tasks').insert({
      org_id: plan.org_id, borrower_id: plan.borrower_id, assigned_to: borrower?.assigned_agent_id ?? null,
      source: 'system', type: 'stack_target_hit', title: `Stacking target hit ($${capital.toLocaleString()}), ready to advance?`, due_date: new Date().toISOString().slice(0, 10),
    });
    capitalNudges += 1;
  }

  return NextResponse.json({ scoreNudges, capitalNudges });
}
