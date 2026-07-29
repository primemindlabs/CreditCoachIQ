import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('message_templates').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const body = (await req.json().catch(() => ({}))) as { name?: string; channel?: string; subject?: string; body?: string };
  if (!body.name || !body.channel || !body.body) return NextResponse.json({ error: 'name, channel, and body are required' }, { status: 400 });
  if (!['email', 'sms'].includes(body.channel)) return NextResponse.json({ error: 'channel must be email or sms' }, { status: 400 });
  if (body.channel === 'email' && !body.subject) return NextResponse.json({ error: 'subject is required for email templates' }, { status: 400 });

  const { data, error } = await sb.from('message_templates').insert({
    org_id: orgId, name: body.name, channel: body.channel, subject: body.subject ?? null, body: body.body, created_by: profile?.id ?? null,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
});

export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; name?: string; subject?: string; body?: string };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (b.name) patch.name = b.name;
  if (b.subject !== undefined) patch.subject = b.subject;
  if (b.body) patch.body = b.body;
  const { error } = await sb.from('message_templates').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
