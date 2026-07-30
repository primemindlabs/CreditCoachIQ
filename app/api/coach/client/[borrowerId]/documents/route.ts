import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DOC_TYPES = [
  'government_id', 'proof_of_income', 'bank_statement', 'croa_disclosure',
  'dispute_correspondence', 'credit_report', 'business_formation', 'ein_letter',
  'voided_check', 'other',
];
const MAX_BYTES = 20 * 1024 * 1024; // 20MB, matches the credit-report upload limit convention

// General-purpose document storage per client — separate from the
// single-purpose credit_report_uploads pipeline. enrollment_id is optional:
// omitted = client-level document, set = scoped to that enrollment/deal.
export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { borrowerId: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('borrower_documents')
    .select('id, doc_type, file_name, mime_type, size_bytes, enrollment_id, uploaded_by, storage_path, created_at')
    .eq('org_id', orgId)
    .eq('borrower_id', params.borrowerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Short-lived signed URLs so a coach can view/download without the bucket
  // ever being public — generated per-request, not stored.
  const documents = await Promise.all(
    (data ?? []).map(async (doc) => {
      const { data: signed } = await sb.storage.from('borrower-documents').createSignedUrl(doc.storage_path, 300);
      const { storage_path, ...rest } = doc;
      return { ...rest, url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ documents });
});

export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { borrowerId: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const docType = form?.get('docType') as string | null;
  const enrollmentId = (form?.get('enrollmentId') as string | null) || null;

  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!docType || !DOC_TYPES.includes(docType)) return NextResponse.json({ error: 'A valid docType is required' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 20MB' }, { status: 400 });

  const sb = createAdminClient();
  const { data: borrower } = await sb.from('borrowers').select('id').eq('id', params.borrowerId).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const arrayBuffer = await file.arrayBuffer();
  const storagePath = `${orgId}/${params.borrowerId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error: uploadError } = await sb.storage.from('borrower-documents').upload(storagePath, new Uint8Array(arrayBuffer), { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });

  const { data, error } = await sb
    .from('borrower_documents')
    .insert({
      org_id: orgId,
      borrower_id: params.borrowerId,
      enrollment_id: enrollmentId,
      doc_type: docType,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: profile?.id ?? null,
    })
    .select('id, doc_type, file_name, mime_type, size_bytes, enrollment_id, uploaded_by, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ document: data });
});

// Soft delete — ?id=<documentId>. Consistent with this codebase's
// append-only posture for anything with a compliance trail; the storage
// object is left in place too, only the listing reference is hidden.
export const DELETE = withErrorHandling(async function DELETE(req: Request, { params }: { params: { borrowerId: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb
    .from('borrower_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('borrower_id', params.borrowerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
