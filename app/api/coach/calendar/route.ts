import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidAccessToken, listEventsInRange } from '@/lib/googleCalendar';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Backs the dedicated Calendar page — same call_bookings + Google Calendar
// sources as /api/coach/today, but over an arbitrary date range instead of
// hardcoded to today/this-week, so the Calendar page can page forward and
// back a week at a time.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end are required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const myBorrowerIds: string[] = [];
  if (profile?.id) {
    const { data: mine } = await sb.from('borrowers').select('id').eq('org_id', orgId).eq('assigned_agent_id', profile.id);
    myBorrowerIds.push(...(mine ?? []).map((b) => b.id as string));
  }

  const { data: calls } = myBorrowerIds.length
    ? await sb.from('call_bookings')
        .select('id, scheduled_at, status, borrower_id, borrowers(first_name, last_name)')
        .eq('org_id', orgId)
        .in('status', ['scheduled', 'completed'])
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .in('borrower_id', myBorrowerIds)
        .order('scheduled_at', { ascending: true })
    : { data: [] };

  let connected = false;
  let externalEvents: { id: string; summary: string; startISO: string | null }[] = [];
  if (profile?.id) {
    try {
      const conn = await getValidAccessToken(sb, orgId, profile.id);
      if (conn) {
        connected = true;
        externalEvents = await listEventsInRange(conn.accessToken, conn.calendarId, start, end);
      }
    } catch (err) {
      console.error('[google-calendar] Failed to list range events:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ calls: calls ?? [], externalEvents, connected });
});
