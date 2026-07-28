import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Consolidated "what needs you right now" view — the coach landing page.
 * Every section here already exists as real data (coach_tasks, call_bookings,
 * portal_messages, complaint_log, credit_repair_enrollments' dunning columns)
 * — this just aggregates it into one call instead of five separate
 * client-side fetches, same pattern as /api/coach/client/[borrowerId].
 */
export async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [tasksRes, callsRes, messagesRes, complaintsRes, paymentsRes] = await Promise.all([
    sb.from('coach_tasks')
      .select('id, type, title, due_date, borrower_id, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .is('completed_at', null)
      .eq('assigned_to', profile?.id ?? '00000000-0000-0000-0000-000000000000')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(15),
    sb.from('call_bookings')
      .select('id, scheduled_at, borrower_id, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', weekOut)
      .order('scheduled_at', { ascending: true })
      .limit(10),
    sb.from('portal_messages')
      .select('id, borrower_id, body, created_at, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('sender', 'borrower')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
    sb.from('complaint_log')
      .select('id, borrower_id, category, status, opened_at, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .in('status', ['open', 'investigating'])
      .order('opened_at', { ascending: false })
      .limit(10),
    sb.from('credit_repair_enrollments')
      .select('id, borrower_id, last_payment_failed_at, payment_retry_count, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .not('last_payment_failed_at', 'is', null)
      .order('last_payment_failed_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    tasks: tasksRes.data ?? [],
    upcomingCalls: callsRes.data ?? [],
    unreadMessages: messagesRes.data ?? [],
    openComplaints: complaintsRes.data ?? [],
    paymentFailures: paymentsRes.data ?? [],
  });
}
