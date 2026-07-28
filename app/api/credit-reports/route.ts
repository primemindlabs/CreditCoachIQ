import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseCreditReportPdf } from '@/lib/creditReport/parse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // PDF parsing via Claude can take a while for a long report

// Coach-facing: list uploads + parse status for an enrollment.
export async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enrollmentId = new URL(req.url).searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: uploads, error } = await sb
    .from('credit_report_uploads')
    .select('id, source_bureau, report_date, cycle_number, parse_status, parse_error, score_exp, score_eqx, score_tu, ai_analysis, created_at')
    .eq('enrollment_id', enrollmentId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ uploads: uploads ?? [] });
}

// Upload a credit report PDF, parse it with Claude, and import tradelines +
// scores. multipart/form-data: file, enrollmentId, sourceBureau.
export async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const enrollmentId = form?.get('enrollmentId');
  const sourceBureau = (form?.get('sourceBureau') as string) ?? 'unknown';

  if (!(file instanceof File) || typeof enrollmentId !== 'string') {
    return NextResponse.json({ error: 'file and enrollmentId are required' }, { status: 400 });
  }
  if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id, borrower_id')
    .eq('id', enrollmentId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const storagePath = `${orgId}/${enrollmentId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error: uploadError } = await sb.storage.from('credit-report-uploads').upload(storagePath, bytes, { contentType: 'application/pdf' });
  if (uploadError) return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });

  const { data: uploadRow, error: insertError } = await sb
    .from('credit_report_uploads')
    .insert({
      enrollment_id: enrollmentId,
      org_id: orgId,
      borrower_id: enrollment.borrower_id,
      storage_path: storagePath,
      source_bureau: ['experian', 'equifax', 'transunion', 'tri_merge'].includes(sourceBureau) ? sourceBureau : 'unknown',
      parse_status: 'parsing',
    })
    .select('id')
    .single();
  if (insertError || !uploadRow) return NextResponse.json({ error: insertError?.message ?? 'Could not create upload record' }, { status: 500 });

  try {
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const parsed = await parseCreditReportPdf(base64);

    await sb
      .from('credit_report_uploads')
      .update({
        parse_status: 'parsed',
        report_date: parsed.report_date,
        score_exp: parsed.score_exp,
        score_eqx: parsed.score_eqx,
        score_tu: parsed.score_tu,
        ai_analysis: { summary: parsed.summary, tradeline_count: parsed.tradelines.length },
        source_bureau: parsed.source_bureau !== 'unknown' ? parsed.source_bureau : sourceBureau,
      })
      .eq('id', uploadRow.id);

    if (parsed.tradelines.length > 0) {
      await sb.from('credit_tradelines').insert(
        parsed.tradelines.map((t) => ({
          enrollment_id: enrollmentId,
          report_upload_id: uploadRow.id,
          org_id: orgId,
          creditor_name: t.creditor_name,
          account_number: t.account_number,
          account_type: t.account_type,
          bureau: t.bureau,
          balance: t.balance,
          credit_limit: t.credit_limit,
          open_date: t.open_date,
          close_date: t.close_date,
          status: t.status,
          payment_status: t.payment_status,
          negative_remarks: t.negative_remarks,
          is_disputable: t.is_disputable,
          dispute_reason: t.dispute_reason,
          dispute_priority: t.dispute_priority,
          estimated_score_gain: t.estimated_score_gain,
          dispute_status: 'identified',
        }))
      );
    }

    // Keep the enrollment's current-score fields fresh — the same fields the
    // portal overview and readiness-nudge cron already read.
    const scorePatch: Record<string, unknown> = {};
    if (parsed.score_exp != null) scorePatch.current_score_exp = parsed.score_exp;
    if (parsed.score_eqx != null) scorePatch.current_score_eqx = parsed.score_eqx;
    if (parsed.score_tu != null) scorePatch.current_score_tu = parsed.score_tu;
    if (Object.keys(scorePatch).length > 0) {
      await sb.from('credit_repair_enrollments').update(scorePatch).eq('id', enrollmentId);
    }

    return NextResponse.json({
      ok: true,
      uploadId: uploadRow.id,
      scores: { exp: parsed.score_exp, eqx: parsed.score_eqx, tu: parsed.score_tu },
      tradelineCount: parsed.tradelines.length,
      disputableCount: parsed.tradelines.filter((t) => t.is_disputable).length,
      summary: parsed.summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parsing failed';
    await sb.from('credit_report_uploads').update({ parse_status: 'failed', parse_error: message }).eq('id', uploadRow.id);
    return NextResponse.json({ error: message, uploadId: uploadRow.id }, { status: 502 });
  }
}
