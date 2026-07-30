import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCallAllowance } from '@/lib/plans';
import { buildSchedulingUrl } from '@/lib/calendly';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Returns the assigned coach's Calendly link (prefilled + tracked) plus the
// client's remaining call allowance for their plan tier. The booking itself
// happens on Calendly; app/api/webhooks/calendly is the source of truth for
// what actually got scheduled — this route only gates *access* to the link.
export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/booking'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });
  const sb = createAdminClient();

  const { data: borrower } = await sb.from('borrowers').select('first_name, last_name, email, plan_tier, assigned_agent_id').eq('id', ctx.borrowerId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const allowance = getCallAllowance(borrower.plan_tier as string);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: used } = await sb.from('call_bookings').select('id', { count: 'exact', head: true }).eq('borrower_id', ctx.borrowerId).eq('org_id', ctx.orgId).in('status', ['scheduled', 'completed']).gte('created_at', thirtyDaysAgo);
  const remaining = Math.max(0, allowance - (used ?? 0));

  const { data: upcoming } = await sb.from('call_bookings').select('id, scheduled_at, status').eq('borrower_id', ctx.borrowerId).eq('org_id', ctx.orgId).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(1).maybeSingle();

  if (remaining <= 0) {
    return NextResponse.json({ canBook: false, reason: 'You have used all your calls for this period. Reach out via message and your coach can help.', allowance: { used: used ?? 0, total: allowance, remaining }, upcoming: upcoming ?? null });
  }

  if (!borrower.assigned_agent_id) {
    return NextResponse.json({ canBook: false, reason: 'No coach is assigned yet. Send a message and we\'ll get you scheduled.', allowance: { used: used ?? 0, total: allowance, remaining }, upcoming: upcoming ?? null });
  }

  const { data: calendlyLink } = await sb.from('coach_calendly_links').select('scheduling_url').eq('org_id', ctx.orgId).eq('profile_id', borrower.assigned_agent_id).eq('is_active', true).maybeSingle();
  if (!calendlyLink) {
    return NextResponse.json({ canBook: false, reason: 'Your coach hasn\'t set up scheduling yet. Send a message and we\'ll get you on the calendar.', allowance: { used: used ?? 0, total: allowance, remaining }, upcoming: upcoming ?? null });
  }

  const url = buildSchedulingUrl(calendlyLink.scheduling_url as string, {
    name: `${borrower.first_name ?? ''} ${borrower.last_name ?? ''}`.trim() || undefined,
    email: (borrower.email as string) ?? undefined,
    borrowerId: ctx.borrowerId,
    orgId: ctx.orgId,
  });

  return NextResponse.json({ canBook: true, schedulingUrl: url, allowance: { used: used ?? 0, total: allowance, remaining }, upcoming: upcoming ?? null });
});
