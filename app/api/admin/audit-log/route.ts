import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Admin-facing compliance audit trail — who approved which AI-drafted
 * dispute letter, who signed off which loan-ready checklist item, and every
 * journey-stage move with who moved it. Deliberately a read-time aggregation
 * over existing actor/timestamp columns (credit_disputes.approved_by,
 * loan_ready_checklist_items.verified_by, journey_stage_events.moved_by)
 * rather than a separate duplicated audit table — those columns are already
 * the source of truth, this just surfaces them together for review.
 */
export async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
  const sb = createAdminClient();

  const [{ data: letters }, { data: checklistSignoffs }, { data: stageMoves }] = await Promise.all([
    sb.from('credit_disputes').select('id, borrower_name, bureau, letter_type, sent_at, approved_by, profiles:approved_by(first_name, last_name)').not('sent_at', 'is', null).eq('org_id', orgId).order('sent_at', { ascending: false }).limit(limit),
    sb.from('loan_ready_checklist_items').select('id, borrower_id, label, completed_at, verified_by, profiles:verified_by(first_name, last_name)').not('completed_at', 'is', null).eq('org_id', orgId).order('completed_at', { ascending: false }).limit(limit),
    sb.from('journey_stage_events').select('id, borrower_id, from_stage, to_stage, moved_by, reason, created_at, profiles:moved_by(first_name, last_name)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit),
  ]);

  const events = [
    ...(letters ?? []).map((l) => ({
      type: 'dispute_letter_sent' as const, at: l.sent_at,
      actor: l.profiles ? `${(l.profiles as { first_name?: string }).first_name ?? ''} ${(l.profiles as { last_name?: string }).last_name ?? ''}`.trim() : 'Unknown',
      detail: `${l.letter_type} letter to ${l.bureau} for ${l.borrower_name}`,
    })),
    ...(checklistSignoffs ?? []).map((c) => ({
      type: 'checklist_verified' as const, at: c.completed_at,
      actor: c.profiles ? `${(c.profiles as { first_name?: string }).first_name ?? ''} ${(c.profiles as { last_name?: string }).last_name ?? ''}`.trim() : 'Unknown',
      detail: c.label,
    })),
    ...(stageMoves ?? []).map((s) => ({
      type: 'journey_stage_move' as const, at: s.created_at,
      actor: s.profiles ? `${(s.profiles as { first_name?: string }).first_name ?? ''} ${(s.profiles as { last_name?: string }).last_name ?? ''}`.trim() : 'System',
      detail: `${s.from_stage ?? 'start'} → ${s.to_stage}${s.reason ? ` (${s.reason})` : ''}`,
    })),
  ].sort((a, b) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime());

  return NextResponse.json({ events: events.slice(0, limit) });
}
