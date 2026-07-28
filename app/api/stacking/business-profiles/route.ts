import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';
import { encrypt, decrypt, maskTail } from '@/lib/crypto/encrypt';

export const dynamic = 'force-dynamic';

// Business credit identity (EIN/D-U-N-S/bureau files) — one or more per
// borrower, since a client may stack credit under multiple entities.
// EIN is stored encrypted (AES-256-GCM, see lib/crypto/encrypt.ts) — never
// written or logged as plaintext. Full EIN is only decrypted here, for an
// authenticated coach viewing their own org's data; nothing else in the
// app reads ein_encrypted directly.
export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  const reveal = new URL(req.url).searchParams.get('reveal') === 'true';
  const sb = createAdminClient();
  let query = sb.from('business_credit_profiles').select('*').eq('org_id', orgId);
  if (borrowerId) query = query.eq('borrower_id', borrowerId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profiles = (data ?? []).map((p) => {
    const { ein_encrypted, ...rest } = p as Record<string, unknown> & { ein_encrypted: string | null };
    let ein: string | null = p.ein_last4 ? `••••${p.ein_last4}` : null;
    if (reveal && ein_encrypted) {
      try { ein = decrypt(ein_encrypted); } catch { /* leave masked on decrypt failure */ }
    }
    return { ...rest, ein };
  });

  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.borrower_id || !body.entity_name) {
    return NextResponse.json({ error: 'borrower_id and entity_name are required' }, { status: 400 });
  }

  const { data: borrower } = await sb.from('borrowers').select('plan_tier').eq('id', String(body.borrower_id)).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });
  try {
    assertTierIncludes(borrower.plan_tier as string, 'credit_stacking');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const einRaw = typeof body.ein === 'string' ? body.ein.replace(/[^0-9]/g, '') : null;

  const { data, error } = await sb
    .from('business_credit_profiles')
    .insert({
      org_id: orgId,
      borrower_id: body.borrower_id,
      entity_name: body.entity_name,
      entity_type: body.entity_type ?? null,
      ein_encrypted: einRaw ? encrypt(einRaw) : null,
      ein_last4: einRaw ? maskTail(einRaw).slice(-4) : null,
      duns_number: body.duns_number ?? null,
      formation_date: body.formation_date ?? null,
      notes: body.notes ?? null,
    })
    .select('id, org_id, borrower_id, entity_name, entity_type, ein_last4, duns_number, formation_date, notes, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
