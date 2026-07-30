import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/permissions';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Lightweight staff roster for reassignment dropdowns — anyone who can
// manage the caseload can see who else is on it, not just admins (a coach
// reassigning a case to a covering teammate shouldn't need an admin).
export const GET = withErrorHandling(async function GET() {
  const { orgId, role } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_caseload')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('profiles')
    .select('id, first_name, last_name, role')
    .eq('org_id', orgId)
    .in('role', ['admin', 'coach', 'processor'])
    .order('first_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ agents: data ?? [] });
});
