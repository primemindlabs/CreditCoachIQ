import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

const TRIGGERS = ['manual', 'client_enrolled', 'journey_stage_enter', 'dispute_response_received', 'goal_achieved', 'stack_promo_expiring', 'loan_ready_reached', 'scheduled', 'lead_lost', 'stale_lead'];

// List / create campaigns. This + campaign_steps is the backend a visual
// drag-and-drop builder sits on top of — each campaign is a container,
// each step is a node in the sequence (see app/api/campaigns/[id]/steps).
export const GET = withErrorHandling(async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('campaigns')
    .select('*, campaign_steps(id, step_order, channel, delay_hours, template_id)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; description?: string; trigger_type?: string; trigger_config?: Record<string, unknown>;
  };
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const triggerType = body.trigger_type && TRIGGERS.includes(body.trigger_type) ? body.trigger_type : 'manual';

  const { data, error } = await sb.from('campaigns').insert({
    org_id: orgId, name: body.name, description: body.description ?? null,
    trigger_type: triggerType, trigger_config: body.trigger_config ?? {}, status: 'draft', created_by: profile?.id ?? null,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
});

// PATCH — activate/pause/archive a campaign. Kept separate from step-editing
// so "turn this on" is a single deliberate action.
export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; name?: string; description?: string; trigger_config?: Record<string, unknown> };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (b.status && !['draft', 'active', 'paused', 'archived'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const sb = createAdminClient();
  if (b.status === 'active') {
    const { data: steps } = await sb.from('campaign_steps').select('id').eq('campaign_id', b.id).limit(1);
    if (!steps || steps.length === 0) return NextResponse.json({ error: 'Cannot activate a campaign with no steps' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (b.status) patch.status = b.status;
  if (b.name) patch.name = b.name;
  if (b.description !== undefined) patch.description = b.description;
  if (b.trigger_config !== undefined) patch.trigger_config = b.trigger_config;
  const { error } = await sb.from('campaigns').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
