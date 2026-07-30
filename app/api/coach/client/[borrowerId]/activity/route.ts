import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

type ActivityItem = {
  id: string;
  type: 'stage_change' | 'note' | 'call' | 'sms' | 'email' | 'portal_message' | 'status_change';
  label: string;
  detail: string | null;
  actor: string | null;
  createdAt: string;
};

function actorName(p: { first_name?: string | null; last_name?: string | null } | null | undefined): string | null {
  if (!p) return null;
  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return name || null;
}

// Unified "what's happened with this person" feed for the client detail
// page — merges 4 tables that each independently log borrower-scoped events
// (journey_stage_events, lead_activity_log, call_logs, portal_messages) into
// one sorted timeline. Nothing new is written here; this only reads what
// already-existing writes elsewhere in the app produce. Deliberately leaves
// out sms_messages — the caseload page already has a dedicated two-way SMS
// thread panel, and duplicating every text into the timeline too would bury
// the events that don't have their own panel.
export const GET = withErrorHandling(async function GET(_req: Request, { params }: { params: { borrowerId: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const [{ data: stageEvents }, { data: activity }, { data: calls }, { data: messages }] = await Promise.all([
    sb
      .from('journey_stage_events')
      .select('id, from_stage, to_stage, reason, created_at, profiles(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('borrower_id', params.borrowerId)
      .order('created_at', { ascending: false })
      .limit(30),
    sb
      .from('lead_activity_log')
      .select('id, type, body, created_at, profiles(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('borrower_id', params.borrowerId)
      .order('created_at', { ascending: false })
      .limit(30),
    sb
      .from('call_logs')
      .select('id, direction, status, duration_seconds, notes, started_at, profiles(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('borrower_id', params.borrowerId)
      .order('started_at', { ascending: false })
      .limit(30),
    sb
      .from('portal_messages')
      .select('id, sender, body, created_at, profiles(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('borrower_id', params.borrowerId)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const items: ActivityItem[] = [];

  for (const e of stageEvents ?? []) {
    const profile = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
    items.push({
      id: `stage-${e.id}`,
      type: 'stage_change',
      label: e.from_stage ? `Moved from ${String(e.from_stage).replace(/_/g, ' ')} to ${String(e.to_stage).replace(/_/g, ' ')}` : `Entered ${String(e.to_stage).replace(/_/g, ' ')}`,
      detail: (e.reason as string) ?? null,
      actor: actorName(profile as { first_name?: string; last_name?: string } | null),
      createdAt: e.created_at as string,
    });
  }

  for (const a of activity ?? []) {
    const profile = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
    const type = a.type as string;
    items.push({
      id: `activity-${a.id}`,
      type: type === 'status_change' ? 'status_change' : type === 'note' ? 'note' : type === 'call' ? 'call' : type === 'sms' ? 'sms' : 'email',
      label: type === 'note' ? 'Note added' : type === 'status_change' ? 'Status updated' : type === 'call' ? 'Call logged' : type === 'sms' ? 'Text logged' : 'Email logged',
      detail: (a.body as string) ?? null,
      actor: actorName(profile as { first_name?: string; last_name?: string } | null),
      createdAt: a.created_at as string,
    });
  }

  for (const c of calls ?? []) {
    const profile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    const mins = c.duration_seconds ? Math.round((c.duration_seconds as number) / 60) : null;
    items.push({
      id: `call-${c.id}`,
      type: 'call',
      label: `${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} call, ${c.status}${mins ? ` (${mins} min)` : ''}`,
      detail: (c.notes as string) ?? null,
      actor: actorName(profile as { first_name?: string; last_name?: string } | null),
      createdAt: c.started_at as string,
    });
  }

  for (const m of messages ?? []) {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    items.push({
      id: `portal-${m.id}`,
      type: 'portal_message',
      label: m.sender === 'borrower' ? 'Client sent a portal message' : 'Coach sent a portal message',
      detail: (m.body as string) ?? null,
      actor: actorName(profile as { first_name?: string; last_name?: string } | null),
      createdAt: m.created_at as string,
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ items: items.slice(0, 40) });
});
