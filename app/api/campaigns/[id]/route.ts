import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Single-campaign fetch (with its ordered steps + template info) — what the builder page loads.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();

  const { data: campaign, error } = await sb.from('campaigns').select('*').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: steps } = await sb
    .from('campaign_steps')
    .select('id, step_order, channel, delay_hours, template_id, condition, message_templates(id, name, channel, subject)')
    .eq('campaign_id', params.id)
    .eq('org_id', orgId)
    .order('step_order');

  return NextResponse.json({ campaign, steps: steps ?? [] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { error } = await sb.from('campaigns').update({ status: 'archived' }).eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
