import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Admin management of which states EquityNest Capital is registered/bonded
// in — gates app/api/enroll's CROA state-registration check.
export async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('state_compliance_status').select('*').eq('org_id', orgId).order('state');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ states: data ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    state?: string; registered?: boolean; bond_on_file?: boolean; fee_cap_notes?: string; active_clients_allowed?: boolean;
  };
  if (!body.state || body.state.length !== 2) return NextResponse.json({ error: 'A 2-letter state code is required' }, { status: 400 });

  const sb = createAdminClient();
  const { data, error } = await sb.from('state_compliance_status').upsert({
    org_id: orgId, state: body.state.toUpperCase(), registered: body.registered ?? false, bond_on_file: body.bond_on_file ?? false,
    fee_cap_notes: body.fee_cap_notes ?? null, active_clients_allowed: body.active_clients_allowed ?? false, updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,state' }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ state: data });
}
