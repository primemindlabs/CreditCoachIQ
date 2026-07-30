import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/permissions';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Backs the Cmd+K command palette. Same scoping rule as /api/coach/clients:
// a coach without manage_caseload only searches their own assigned
// borrowers, not the whole org. Matches name/email/phone with a single
// ILIKE OR clause rather than a real search index, fine at this data scale.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ results: [] });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const canSeeAll = hasPermission(role, 'manage_caseload');

  let query = sb
    .from('borrowers')
    .select('id, first_name, last_name, email, phone, lead_status, journey_stage')
    .eq('org_id', orgId)
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(8);
  if (!canSeeAll && profile?.id) query = query.eq('assigned_agent_id', profile.id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    results: (data ?? []).map((b) => ({
      id: b.id,
      name: `${b.first_name} ${b.last_name}`,
      detail: b.email ?? b.phone ?? '',
      status: b.lead_status !== 'converted' ? 'Lead' : (b.journey_stage as string)?.replace(/_/g, ' '),
    })),
  });
});
