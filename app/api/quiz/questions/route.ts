import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Coach-editable question bank behind the intake quiz. Seeded with a
// default set per org in the migration; this lets a coach tune wording and
// path_weight scoring without a deploy.
export async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('intake_quiz_questions').select('*').eq('org_id', orgId).order('question_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questions: data ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string; question_type?: string; options?: unknown; helper_text?: string; question_key?: string; is_required?: boolean;
  };
  if (!body.prompt || !body.question_type) return NextResponse.json({ error: 'prompt and question_type are required' }, { status: 400 });
  if (!['single_choice', 'multi_choice', 'scale', 'text', 'number'].includes(body.question_type)) return NextResponse.json({ error: 'Invalid question_type' }, { status: 400 });

  const { data: maxOrder } = await sb.from('intake_quiz_questions').select('question_order').eq('org_id', orgId).order('question_order', { ascending: false }).limit(1);
  const nextOrder = (maxOrder?.[0]?.question_order ?? 0) + 1;

  const { data, error } = await sb.from('intake_quiz_questions').insert({
    org_id: orgId, question_order: nextOrder, question_key: body.question_key ?? null, prompt: body.prompt,
    question_type: body.question_type, options: body.options ?? null, helper_text: body.helper_text ?? null,
    is_required: body.is_required ?? true,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data });
}

export async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; prompt?: string; options?: unknown; helper_text?: string; is_active?: boolean; is_required?: boolean };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (b.prompt) patch.prompt = b.prompt;
  if (b.options !== undefined) patch.options = b.options;
  if (b.helper_text !== undefined) patch.helper_text = b.helper_text;
  if (b.is_active !== undefined) patch.is_active = b.is_active;
  if (b.is_required !== undefined) patch.is_required = b.is_required;
  const { error } = await sb.from('intake_quiz_questions').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
