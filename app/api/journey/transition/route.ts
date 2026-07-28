import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { transitionStage, type JourneyStage } from '@/lib/journey';

export const dynamic = 'force-dynamic';

const STAGES: JourneyStage[] = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off', 'paused', 'exited'];

// Move a client to a new journey stage. `loan_ready` requires the acting
// coach's profile id and a complete required-checklist (enforced in
// lib/journey.ts) — this endpoint never lets the transition happen silently.
export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { borrower_id?: string; to_stage?: string; reason?: string };
  if (!body.borrower_id || !body.to_stage || !STAGES.includes(body.to_stage as JourneyStage)) {
    return NextResponse.json({ error: 'borrower_id and a valid to_stage are required' }, { status: 400 });
  }

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const result = await transitionStage({
    orgId,
    borrowerId: body.borrower_id,
    toStage: body.to_stage as JourneyStage,
    movedBy: profile?.id ?? null,
    reason: body.reason,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
