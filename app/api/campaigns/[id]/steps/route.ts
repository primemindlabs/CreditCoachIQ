import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Ordered steps within one campaign — the nodes of the visual builder.
// step_order is 1-indexed and must be contiguous; reordering is a full
// replace (send the whole new order) rather than per-step move operations,
// which keeps the builder's drag-and-drop reorder simple to implement against.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('campaign_steps').select('*, message_templates(name, channel, subject)').eq('campaign_id', params.id).eq('org_id', orgId).order('step_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ steps: data ?? [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as {
    channel?: string; template_id?: string; delay_hours?: number; condition?: Record<string, unknown>;
  };
  if (!body.channel || !body.template_id) return NextResponse.json({ error: 'channel and template_id are required' }, { status: 400 });

  const { data: existingSteps } = await sb.from('campaign_steps').select('step_order').eq('campaign_id', params.id).order('step_order', { ascending: false }).limit(1);
  const nextOrder = (existingSteps?.[0]?.step_order ?? 0) + 1;

  const { data, error } = await sb.from('campaign_steps').insert({
    org_id: orgId, campaign_id: params.id, step_order: nextOrder,
    channel: body.channel, template_id: body.template_id, delay_hours: body.delay_hours ?? 0, condition: body.condition ?? null,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ step: data });
}

// PUT — replace the full step sequence in one call (drag-and-drop reorder,
// or bulk edit from the builder UI). Deletes and re-inserts rather than
// diffing, since campaign_sends references step_id historically, not the
// live sequence — past sends keep their original step_id even after a
// reorder recreates the row.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    steps?: { channel: string; template_id: string; delay_hours?: number; condition?: Record<string, unknown> }[];
  };
  if (!body.steps) return NextResponse.json({ error: 'steps array required' }, { status: 400 });

  const sb = createAdminClient();
  await sb.from('campaign_steps').delete().eq('campaign_id', params.id).eq('org_id', orgId);
  if (body.steps.length > 0) {
    const { error } = await sb.from('campaign_steps').insert(
      body.steps.map((s, i) => ({
        org_id: orgId, campaign_id: params.id, step_order: i + 1,
        channel: s.channel, template_id: s.template_id, delay_hours: s.delay_hours ?? 0, condition: s.condition ?? null,
      }))
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
