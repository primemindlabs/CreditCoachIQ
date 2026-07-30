import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { stampSignatureCertificate, type SignatureRecord } from '@/lib/signing';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WRAP_WIDTH = 92; // characters per line at the font/size used below — plain-text wrap, not measured

function wrapText(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') { lines.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > WRAP_WIDTH) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Renders the stored contract text into a base PDF, then appends the
// signature-certificate page from lib/signing — the same document a
// coach or auditor would need to prove a CROA disclosure was properly
// signed. Everything here reads what's already stored (croa_contract_text,
// croa_signature_record); nothing is re-derived or guessed.
async function buildContractPdf(contractText: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapText(contractText);
  const pageHeight = 792;
  const pageWidth = 612;
  const lineHeight = 14;
  const marginTop = 72;
  const marginBottom = 54;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginTop;
  for (const line of lines) {
    if (y < marginBottom) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - marginTop;
    }
    page.drawText(line, { x: 54, y, size: 10, font, color: rgb(0.11, 0.11, 0.12) });
    y -= lineHeight;
  }
  return doc.save();
}

export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { borrowerId: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const verifyOnly = new URL(req.url).searchParams.get('verifyOnly') === 'true';

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('croa_disclosure_signed_at, croa_contract_text, croa_signature_record')
    .eq('org_id', orgId)
    .eq('borrower_id', params.borrowerId)
    .maybeSingle();

  if (!enrollment?.croa_disclosure_signed_at || !enrollment.croa_signature_record) {
    return NextResponse.json({ error: 'No signed CROA disclosure on file for this client' }, { status: 404 });
  }

  const record = enrollment.croa_signature_record as SignatureRecord;
  const { verifySignatureRecord } = await import('@/lib/signing');
  const result = await verifySignatureRecord(record);

  if (verifyOnly) {
    return NextResponse.json({ valid: result.valid, reason: result.reason, signedAt: record.signedAt, signerName: record.signerName, method: record.method });
  }

  if (!result.valid) {
    return NextResponse.json({ error: `Signature record failed integrity check: ${result.reason}` }, { status: 409 });
  }

  const basePdf = await buildContractPdf((enrollment.croa_contract_text as string) ?? 'Contract text not on file.');
  const stamped = await stampSignatureCertificate(basePdf, record);

  return new NextResponse(Buffer.from(stamped), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="croa-signed-agreement-${params.borrowerId}.pdf"`,
    },
  });
});
