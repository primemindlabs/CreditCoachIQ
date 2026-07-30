import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidAccessToken, listTodayEvents } from '@/lib/googleCalendar';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

/**
 * Consolidated "what needs you right now" view — the coach landing page.
 * Every section here already exists as real data (coach_tasks, call_bookings,
 * portal_messages, complaint_log, credit_repair_enrollments' dunning columns)
 * — this just aggregates it into one call instead of five separate
 * client-side fetches, same pattern as /api/coach/client/[borrowerId].
 */
export const GET = withErrorHandling(async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Today is a personal queue, not an org overview — tasks were already
  // scoped to `assigned_to = profile.id` unconditionally (even for admins).
  // Everything else here previously wasn't: any coach could see every other
  // coach's calls, unread messages, complaints, and payment failures
  // org-wide. Fixed by resolving this coach's own assigned borrowers first,
  // then scoping every section to that set — same "your queue" model the
  // tasks section already used.
  const myBorrowerIds: string[] = [];
  if (profile?.id) {
    const { data: mine } = await sb.from('borrowers').select('id').eq('org_id', orgId).eq('assigned_agent_id', profile.id);
    myBorrowerIds.push(...(mine ?? []).map((b) => b.id as string));
  }

  const [tasksRes, callsRes, messagesRes, smsRes, complaintsRes, paymentsRes, newLeadsRes, uploadsRes] = await Promise.all([
    sb.from('coach_tasks')
      .select('id, type, title, due_date, borrower_id, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .is('completed_at', null)
      .eq('assigned_to', profile?.id ?? '00000000-0000-0000-0000-000000000000')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(15),
    myBorrowerIds.length
      ? sb.from('call_bookings')
          .select('id, scheduled_at, borrower_id, borrowers(first_name, last_name)')
          .eq('org_id', orgId)
          .eq('status', 'scheduled')
          .gte('scheduled_at', now.toISOString())
          .lte('scheduled_at', weekOut)
          .in('borrower_id', myBorrowerIds)
          .order('scheduled_at', { ascending: true })
          .limit(10)
      : Promise.resolve({ data: [] }),
    myBorrowerIds.length
      ? sb.from('portal_messages')
          .select('id, borrower_id, body, created_at, borrowers(first_name, last_name)')
          .eq('org_id', orgId)
          .eq('sender', 'borrower')
          .is('read_at', null)
          .in('borrower_id', myBorrowerIds)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    myBorrowerIds.length
      ? sb.from('sms_messages')
          .select('id, borrower_id, body, created_at, borrowers(first_name, last_name)')
          .eq('org_id', orgId)
          .eq('direction', 'inbound')
          .is('read_at', null)
          .in('borrower_id', myBorrowerIds)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    myBorrowerIds.length
      ? sb.from('complaint_log')
          .select('id, borrower_id, category, status, opened_at, borrowers(first_name, last_name)')
          .eq('org_id', orgId)
          .in('status', ['open', 'investigating'])
          .in('borrower_id', myBorrowerIds)
          .order('opened_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    myBorrowerIds.length
      ? sb.from('credit_repair_enrollments')
          .select('id, borrower_id, last_payment_failed_at, payment_retry_count, borrowers(first_name, last_name)')
          .eq('org_id', orgId)
          .not('last_payment_failed_at', 'is', null)
          .in('borrower_id', myBorrowerIds)
          .order('last_payment_failed_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    sb.from('borrowers')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('lead_status', 'new')
      .eq('assigned_agent_id', profile?.id ?? '00000000-0000-0000-0000-000000000000'),
    // Score-jump detection — real deltas from actual report uploads, not
    // estimated. Grouped/compared in JS below since this needs "the last
    // two uploads per enrollment," not a simple filter.
    myBorrowerIds.length
      ? sb.from('credit_report_uploads')
          .select('enrollment_id, borrower_id, score_exp, created_at')
          .eq('org_id', orgId)
          .eq('parse_status', 'parsed')
          .not('score_exp', 'is', null)
          .gte('created_at', thirtyDaysAgo)
          .in('borrower_id', myBorrowerIds)
          .order('enrollment_id', { ascending: true })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  // Split "this week" into a dedicated "today" bucket — WiseAgent-style daily
  // call list, surfaced first rather than buried inside the week view.
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const allCalls = callsRes.data ?? [];
  const todayCalls = allCalls.filter((c) => new Date(c.scheduled_at as string) <= todayEnd);
  const laterCalls = allCalls.filter((c) => new Date(c.scheduled_at as string) > todayEnd);

  const byEnrollment = new Map<string, { borrower_id: string; score_exp: number; created_at: string }[]>();
  for (const row of uploadsRes.data ?? []) {
    const key = row.enrollment_id as string;
    const list = byEnrollment.get(key) ?? [];
    list.push({ borrower_id: row.borrower_id as string, score_exp: row.score_exp as number, created_at: row.created_at as string });
    byEnrollment.set(key, list);
  }
  const jumpCandidates: { borrowerId: string; delta: number }[] = [];
  for (const uploads of byEnrollment.values()) {
    if (uploads.length < 2) continue;
    const latest = uploads[uploads.length - 1];
    const previous = uploads[uploads.length - 2];
    const delta = latest.score_exp - previous.score_exp;
    if (delta >= 15 && new Date(latest.created_at) >= sevenDaysAgo) {
      jumpCandidates.push({ borrowerId: latest.borrower_id, delta });
    }
  }
  let scoreJumps: { borrowerId: string; delta: number; name: string }[] = [];
  if (jumpCandidates.length > 0) {
    const { data: jumpBorrowers } = await sb.from('borrowers').select('id, first_name, last_name').in('id', jumpCandidates.map((j) => j.borrowerId));
    scoreJumps = jumpCandidates.map((j) => {
      const b = jumpBorrowers?.find((x) => x.id === j.borrowerId);
      return { borrowerId: j.borrowerId, delta: j.delta, name: b ? `${b.first_name} ${b.last_name}` : 'A client' };
    });
  }

  // Pull side of Google Calendar sync — fold in events on the coach's own
  // calendar that didn't come through a Calendly booking (e.g. blocked-off
  // time, an appointment they added directly in Google), best-effort.
  let externalTodayEvents: { id: string; summary: string; startISO: string | null }[] = [];
  if (profile?.id) {
    try {
      const conn = await getValidAccessToken(sb, orgId, profile.id);
      if (conn) externalTodayEvents = await listTodayEvents(conn.accessToken, conn.calendarId);
    } catch (err) {
      console.error('[google-calendar] Failed to list today events:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    tasks: tasksRes.data ?? [],
    todayCalls,
    upcomingCalls: laterCalls,
    externalTodayEvents,
    unreadMessages: messagesRes.data ?? [],
    unreadTexts: smsRes.data ?? [],
    openComplaints: complaintsRes.data ?? [],
    paymentFailures: paymentsRes.data ?? [],
    newLeadsCount: newLeadsRes.count ?? 0,
    scoreJumps,
  });
});
