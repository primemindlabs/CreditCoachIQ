import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashDocument, buildSignatureRecord, type SignatureCaptureResult } from '@/lib/signing';
import { CROA_CONSUMER_RIGHTS_STATEMENT, CROA_CONTRACT_TEXT } from '@/lib/legal/croaDisclosure';

export const dynamic = 'force-dynamic';

// The dispute-generate route (app/api/disputes/generate) is gated on
// credit_repair_enrollments.croa_disclosure_signed_at — no dispute letters
// can be drafted for a client until they've signed here.
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/sign-croa'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id, croa_disclosure_signed_at')
    .eq('org_id', ctx.orgId)
    .eq('borrower_id', ctx.borrowerId)
    .maybeSingle();

  if (!enrollment) return NextResponse.json({ error: 'No credit-repair enrollment found' }, { status: 404 });

  return NextResponse.json({
    alreadySigned: !!enrollment.croa_disclosure_signed_at,
    signedAt: enrollment.croa_disclosure_signed_at,
    consumerRightsStatement: CROA_CONSUMER_RIGHTS_STATEMENT,
    contractText: CROA_CONTRACT_TEXT,
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/sign-croa'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { capture?: SignatureCaptureResult };
  if (!body.capture || !body.capture.method || !body.capture.consentAcceptedAt) {
    return NextResponse.json({ error: 'Signature capture payload required' }, { status: 400 });
  }

  const sb = createAdminClient();
  const [{ data: enrollment }, { data: borrower }] = await Promise.all([
    sb.from('credit_repair_enrollments').select('id, croa_disclosure_signed_at').eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).maybeSingle(),
    sb.from('borrowers').select('first_name, last_name, email').eq('id', ctx.borrowerId).maybeSingle(),
  ]);
  if (!enrollment) return NextResponse.json({ error: 'No credit-repair enrollment found' }, { status: 404 });
  if (enrollment.croa_disclosure_signed_at) return NextResponse.json({ error: 'Already signed' }, { status: 409 });

  const fullContractText = `${CROA_CONSUMER_RIGHTS_STATEMENT}\n\n${CROA_CONTRACT_TEXT}`;
  const documentHash = await hashDocument(fullContractText);
  const meta = requestMeta(req, '/portal/sign-croa');

  const record = await buildSignatureRecord({
    documentHash,
    signerName: `${borrower?.first_name ?? ''} ${borrower?.last_name ?? ''}`.trim() || 'Client',
    signerEmail: (borrower?.email as string) ?? undefined,
    capture: body.capture,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const signedAt = record.signedAt;
  await sb
    .from('credit_repair_enrollments')
    .update({
      croa_disclosure_signed_at: signedAt,
      croa_disclosure_ip: meta.ipAddress,
      croa_contract_text: fullContractText,
      croa_signature_record: record,
    })
    .eq('id', enrollment.id);

  await sb.from('portal_access_log').insert({ org_id: ctx.orgId, borrower_id: ctx.borrowerId, portal_token_id: ctx.portalTokenId, event: 'croa_signed' });

  return NextResponse.json({ ok: true, signedAt });
}
