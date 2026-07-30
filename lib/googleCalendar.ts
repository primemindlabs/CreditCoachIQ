import 'server-only';
import { encrypt, decrypt } from '@/lib/crypto/encrypt';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Google Calendar two-way sync per coach — OAuth 2.0 authorization-code
 * flow. Requires a Google Cloud OAuth client:
 *   TODO: set GOOGLE_CALENDAR_CLIENT_ID
 *   TODO: set GOOGLE_CALENDAR_CLIENT_SECRET
 *   TODO: set GOOGLE_CALENDAR_REDIRECT_URI (e.g. https://app.creditcoachiq.com/api/coach/calendar/google/callback)
 * Register these at https://console.cloud.google.com/apis/credentials with
 * the Google Calendar API enabled, and add the redirect URI to the OAuth
 * client's authorized redirect URIs.
 *
 * Scope: calendar.events (create/update/delete events on the coach's own
 * calendar) + calendar.readonly (read today's events back into the Today
 * page). Not requesting broader calendar management scopes than needed.
 */

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'].join(' ');
const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set. Connect a Google Cloud OAuth client before using Google Calendar sync.`);
  return val;
}

export function buildAuthUrl(state: string): string {
  const clientId = requireEnv('GOOGLE_CALENDAR_CLIENT_ID');
  const redirectUri = requireEnv('GOOGLE_CALENDAR_REDIRECT_URI');
  const url = new URL(AUTH_BASE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline'); // required to get a refresh_token
  url.searchParams.set('prompt', 'consent'); // force refresh_token on every connect, not just the first
  url.searchParams.set('state', state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
      redirect_uri: requireEnv('GOOGLE_CALENDAR_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export interface CalendarConnection {
  calendarId: string;
  connectedEmail: string | null;
}

/**
 * Resolves a valid (non-expired) access token for a coach's connection,
 * refreshing and re-persisting it first if needed. Returns null if the
 * coach has no Google Calendar connected — callers should treat that as
 * "sync is a no-op for this coach," not an error.
 */
export async function getValidAccessToken(
  sb: SupabaseClient,
  orgId: string,
  profileId: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const { data: conn } = await sb
    .from('coach_calendar_connections')
    .select('id, access_token_encrypted, refresh_token_encrypted, token_expires_at, calendar_id')
    .eq('org_id', orgId)
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .maybeSingle();
  if (!conn) return null;

  const expiresAt = new Date(conn.token_expires_at as string);
  if (expiresAt.getTime() - Date.now() > 60_000) {
    return { accessToken: decrypt(conn.access_token_encrypted as string), calendarId: conn.calendar_id as string };
  }

  const refreshToken = decrypt(conn.refresh_token_encrypted as string);
  const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);
  await sb.from('coach_calendar_connections').update({
    access_token_encrypted: encrypt(accessToken),
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }).eq('id', conn.id);

  return { accessToken, calendarId: conn.calendar_id as string };
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
}

/** Creates an event on the coach's calendar, returns the Google event id. */
export async function createCalendarEvent(accessToken: string, calendarId: string, event: CalendarEventInput): Promise<string> {
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startISO },
      end: { dateTime: event.endISO },
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar event create failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function deleteCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 410 Gone = already deleted on Google's side — not an error for our purposes.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Google Calendar event delete failed: ${res.status} ${await res.text()}`);
  }
}

export interface CalendarEvent {
  id: string;
  summary: string;
  startISO: string | null;
}

/** Lists the coach's own calendar events for today — used to fold external (non-portal-booked) appointments into the Today page. */
export async function listTodayEvents(accessToken: string, calendarId: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);

  const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', dayStart.toISOString());
  url.searchParams.set('timeMax', dayEnd.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Calendar list failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string } }[] };
  return (data.items ?? []).map((e) => ({ id: e.id, summary: e.summary ?? '(No title)', startISO: e.start?.dateTime ?? e.start?.date ?? null }));
}
