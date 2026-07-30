import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyCalendlySignature, parseBorrowerFromTracking } from '@/lib/calendly';
import { getValidAccessToken, createCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mirrors a confirmed booking onto the coach's Google Calendar, if they've
// connected one (lib/googleCalendar.ts) — a no-op otherwise. Best-effort:
// a Google API failure here should never block the Calendly webhook from
// recording the booking itself, so errors are logged and swallowed.
async function syncBookingToGoogle(
  sb: SupabaseClient,
  orgId: string,
  coachId: string | null,
  borrowerName: string,
  startISO: string | null
): Promise<string | null> {
  if (!coachId || !startISO) return null;
  try {
    const conn = await getValidAccessToken(sb, orgId, coachId);
    if (!conn) return null;
    const start = new Date(startISO);
    const end = new Date(start.getTime() + 30 * 60 * 1000); // Calendly event duration isn't in this payload — 30min default
    return await createCalendarEvent(conn.accessToken, conn.calendarId, {
      summary: `Call with ${borrowerName}`,
      description: 'Booked via CreditCoachIQ client portal',
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    });
  } catch (err) {
    console.error('[google-calendar] Failed to sync booking:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function removeBookingFromGoogle(sb: SupabaseClient, orgId: string, coachId: string | null, googleEventId: string | null): Promise<void> {
  if (!coachId || !googleEventId) return;
  try {
    const conn = await getValidAccessToken(sb, orgId, coachId);
    if (!conn) return;
    await deleteCalendarEvent(conn.accessToken, conn.calendarId, googleEventId);
  } catch (err) {
    console.error('[google-calendar] Failed to remove canceled booking:', err instanceof Error ? err.message : err);
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Calendly webhook receiver — the source of truth for call_bookings.
 * Handles `invitee.created` (booking confirmed) and `invitee.canceled`.
 * The borrower is resolved via the `utm_content` tracking param set in
 * lib/calendly.ts's buildSchedulingUrl (`${orgId}:${borrowerId}`), and the
 * coach via coach_calendly_links matched on the event's scheduling URL owner.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey || !verifyCalendlySignature(rawBody, req.headers.get('calendly-webhook-signature'), signingKey)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    event: string;
    payload?: {
      uri?: string;
      event?: { uri?: string; start_time?: string };
      tracking?: { utm_content?: string };
      questions_and_answers?: unknown;
    };
  };

  const sb = createAdminClient();
  const eventUri = payload.payload?.event?.uri ?? payload.payload?.uri;
  const tracking = parseBorrowerFromTracking(payload.payload?.tracking?.utm_content);

  if (payload.event === 'invitee.created') {
    if (!eventUri || !tracking) return NextResponse.json({ ok: true, skipped: 'missing event uri or tracking' });

    let coachId: string | null = null;
    const { data: coachLink } = await sb.from('coach_calendly_links').select('profile_id').eq('org_id', tracking.orgId).eq('is_active', true).limit(1).maybeSingle();
    coachId = coachLink?.profile_id ?? null;

    const { data: borrower } = await sb.from('borrowers').select('first_name, last_name, plan_tier, assigned_agent_id').eq('id', tracking.borrowerId).eq('org_id', tracking.orgId).maybeSingle();
    if (borrower?.assigned_agent_id) coachId = borrower.assigned_agent_id as string;

    const googleEventId = await syncBookingToGoogle(
      sb, tracking.orgId, coachId,
      borrower ? `${borrower.first_name} ${borrower.last_name}` : 'a client',
      payload.payload?.event?.start_time ?? null
    );

    await sb.from('call_bookings').upsert({
      org_id: tracking.orgId,
      borrower_id: tracking.borrowerId,
      coach_id: coachId,
      plan_tier_at_booking: borrower?.plan_tier ?? null,
      calendly_event_uri: eventUri,
      calendly_invitee_uri: payload.payload?.uri ?? null,
      scheduled_at: payload.payload?.event?.start_time ?? null,
      status: 'scheduled',
      booked_via: 'portal',
      google_event_id: googleEventId,
    }, { onConflict: 'calendly_event_uri' });

    return NextResponse.json({ ok: true });
  }

  if (payload.event === 'invitee.canceled') {
    if (!eventUri) return NextResponse.json({ ok: true, skipped: 'missing event uri' });
    const { data: existing } = await sb.from('call_bookings').select('org_id, coach_id, google_event_id').eq('calendly_event_uri', eventUri).maybeSingle();
    await sb.from('call_bookings').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('calendly_event_uri', eventUri);
    if (existing) await removeBookingFromGoogle(sb, existing.org_id as string, existing.coach_id as string | null, existing.google_event_id as string | null);
    return NextResponse.json({ ok: true });
  }

  if (payload.event === 'invitee.rescheduled') {
    // Calendly sends the OLD event's URI in `old_invitee.event` and creates a brand-new
    // event+invitee for the new time — cancel the old booking and create a fresh one,
    // same as invitee.created, rather than trying to update scheduled_at in place.
    const oldUri = (payload.payload as unknown as { old_invitee?: { uri?: string } })?.old_invitee?.uri;
    if (oldUri) {
      const { data: oldBooking } = await sb.from('call_bookings').select('org_id, coach_id, google_event_id').eq('calendly_invitee_uri', oldUri).maybeSingle();
      await sb.from('call_bookings').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('calendly_invitee_uri', oldUri);
      if (oldBooking) await removeBookingFromGoogle(sb, oldBooking.org_id as string, oldBooking.coach_id as string | null, oldBooking.google_event_id as string | null);
    }
    if (!eventUri || !tracking) return NextResponse.json({ ok: true, skipped: 'missing event uri or tracking on reschedule' });

    const { data: borrower } = await sb.from('borrowers').select('first_name, last_name, plan_tier, assigned_agent_id').eq('id', tracking.borrowerId).eq('org_id', tracking.orgId).maybeSingle();
    const rescheduledGoogleEventId = await syncBookingToGoogle(
      sb, tracking.orgId, (borrower?.assigned_agent_id as string) ?? null,
      borrower ? `${borrower.first_name} ${borrower.last_name}` : 'a client',
      payload.payload?.event?.start_time ?? null
    );
    await sb.from('call_bookings').upsert({
      org_id: tracking.orgId, borrower_id: tracking.borrowerId, coach_id: borrower?.assigned_agent_id ?? null,
      plan_tier_at_booking: borrower?.plan_tier ?? null, calendly_event_uri: eventUri, calendly_invitee_uri: payload.payload?.uri ?? null,
      scheduled_at: payload.payload?.event?.start_time ?? null, status: 'scheduled', booked_via: 'portal',
      google_event_id: rescheduledGoogleEventId,
    }, { onConflict: 'calendly_event_uri' });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, skipped: 'unhandled event type' });
}
