import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Public, unauthenticated — resolves an org by its embed slug. No Clerk
// session exists here (see middleware.ts isPublicRoute), so this and the
// POST below are the entire trust boundary: only return what a public
// marketing page needs (branding + headline), never anything else about
// the org or its clients.
export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { slug: string } }) {
  const sb = createAdminClient();
  const { data: settings } = await sb
    .from('credit_repair_org_settings')
    .select('org_id, embed_enabled, embed_headline, brand_logo_url, brand_primary_color, brand_from_name')
    .eq('embed_slug', params.slug)
    .maybeSingle();

  if (!settings?.embed_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    headline: settings.embed_headline ?? 'Start your credit journey today',
    branding: {
      logoUrl: settings.brand_logo_url ?? null,
      primaryColor: settings.brand_primary_color ?? null,
      fromName: settings.brand_from_name ?? null,
    },
  });
});

// Public lead submission. Writes directly to borrowers with
// lead_source='embed' — same shape /api/leads POST produces for a
// manually-entered lead, so it flows into the existing pipeline (Clients
// page "Leads" tab, stale-lead nurture, etc.) without any special-casing.
export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { slug: string } }) {
  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string; lastName?: string; email?: string; phone?: string; interestLevel?: string;
  };
  if (!body.firstName?.trim() || !body.lastName?.trim()) {
    return NextResponse.json({ error: 'First and last name are required' }, { status: 400 });
  }
  if (!body.email?.trim() && !body.phone?.trim()) {
    return NextResponse.json({ error: 'An email or phone number is required' }, { status: 400 });
  }
  if (body.interestLevel && !['hot', 'warm', 'cold'].includes(body.interestLevel)) {
    return NextResponse.json({ error: 'Invalid interest level' }, { status: 400 });
  }

  const sb = createAdminClient();
  const { data: settings } = await sb
    .from('credit_repair_org_settings')
    .select('org_id, embed_enabled')
    .eq('embed_slug', params.slug)
    .maybeSingle();
  if (!settings?.embed_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const referrer = req.headers.get('referer') ?? null;

  const { error } = await sb.from('borrowers').insert({
    org_id: settings.org_id,
    first_name: body.firstName.trim(),
    last_name: body.lastName.trim(),
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    interest_level: body.interestLevel || null,
    lead_source: 'embed',
    lead_status: 'new',
    lead_referrer: referrer,
  });
  if (error) return NextResponse.json({ error: 'Could not submit — try again shortly.' }, { status: 500 });

  return NextResponse.json({ ok: true });
});
