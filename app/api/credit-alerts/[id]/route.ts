/**
 * Per credit alert:
 *   GET   → generate the warm re-engagement draft (Claude Haiku)
 *   PATCH → record the action taken (sent_rate_update | called_borrower | dismissed)
 *
 * Adapted from conduit-next's app/api/credit-alerts/[id]/route.ts — looks up
 * `borrowers` (local) instead of `leads`.
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateReengagementDraft } from '@/lib/creditAlerts/rateReengagement';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = ['sent_rate_update', 'called_borrower', 'dismissed'];

export const GET = withErrorHandling(async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 501 });

  const sb = createAdminClient();
  const { data: alert } = await sb.from('credit_alerts').select('alert_type, score_delta, borrower_id').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: borrower } = await sb.from('borrowers').select('first_name').eq('id', alert.borrower_id).maybeSingle();

  const draft = await generateReengagementDraft({ alertType: alert.alert_type, scoreDelta: alert.score_delta ?? 0, firstName: borrower?.first_name ?? 'there', loanSummary: null });
  return NextResponse.json({ draft });
});

export const PATCH = withErrorHandling(async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { action_taken?: string };
  if (!ACTIONS.includes(b.action_taken ?? '')) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  await sb.from('credit_alerts').update({ action_taken: b.action_taken, actioned_at: new Date().toISOString(), actioned_by: profile?.id ?? null }).eq('id', params.id).eq('org_id', orgId);
  return NextResponse.json({ ok: true });
});
