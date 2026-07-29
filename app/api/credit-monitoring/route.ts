/**
 * Credit monitoring enrollment CRUD.
 *   GET ?borrower_id= → enrollment + alert history for a borrower; else all active for org
 *   POST               → enroll (vendor + vendor_borrower_id — never SSN)
 *   PATCH              → pause / cancel / reactivate (body.id + is_active|cancel)
 *
 * Adapted from conduit-next's app/api/credit-monitoring/route.ts — keys off
 * `borrower_id` (local) instead of `lead_id`.
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VENDORS = ['creditxpert', 'factual_data', 'softpull', 'scoremaster', 'credco', 'xactus', 'meridianlink', 'other'];
const TYPES = ['inquiry_alert', 'score_change', 'score_improvement', 'full'];

export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  const sb = createAdminClient();
  if (borrowerId) {
    const [{ data: enrollment }, { data: alerts }] = await Promise.all([
      sb.from('credit_monitoring_enrollments').select('*').eq('org_id', orgId).eq('borrower_id', borrowerId).order('enrolled_at', { ascending: false }).maybeSingle(),
      sb.from('credit_alerts').select('id, alert_type, previous_score, new_score, score_delta, inquiring_lender, action_taken, actioned_at, received_at').eq('org_id', orgId).eq('borrower_id', borrowerId).order('received_at', { ascending: false }).limit(50),
    ]);
    return NextResponse.json({ enrollment: enrollment ?? null, alerts: alerts ?? [] });
  }
  const { data } = await sb.from('credit_monitoring_enrollments').select('*, borrowers(first_name, last_name)').eq('org_id', orgId).eq('is_active', true).order('enrolled_at', { ascending: false }).limit(500);
  return NextResponse.json({ enrollments: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.borrower_id || !VENDORS.includes(String(b.vendor)) || !b.vendor_borrower_id) {
    return NextResponse.json({ error: 'borrower_id, vendor and vendor_borrower_id are required' }, { status: 400 });
  }
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const { data, error } = await sb.from('credit_monitoring_enrollments').upsert({
    borrower_id: String(b.borrower_id), org_id: orgId, enrolled_by: profile?.id ?? null,
    vendor: String(b.vendor), vendor_borrower_id: String(b.vendor_borrower_id),
    monitoring_type: TYPES.includes(String(b.monitoring_type)) ? String(b.monitoring_type) : 'inquiry_alert',
    is_active: true, cancelled_at: null,
  }, { onConflict: 'vendor,vendor_borrower_id,org_id' }).select('*').single();
  if (error) { console.error('[credit-monitoring] enroll', error); return NextResponse.json({ error: 'save_failed' }, { status: 500 }); }
  return NextResponse.json({ enrollment: data });
});

export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; is_active?: boolean; cancel?: boolean };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (b.cancel) { patch.is_active = false; patch.cancelled_at = new Date().toISOString(); }
  else if (typeof b.is_active === 'boolean') patch.is_active = b.is_active;
  await sb.from('credit_monitoring_enrollments').update(patch).eq('id', b.id).eq('org_id', orgId);
  return NextResponse.json({ ok: true });
});
