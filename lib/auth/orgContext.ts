import { auth, clerkClient } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type OrgContext = {
  userId: string | null;
  /** Clerk organization id (org_...) — this is CreditCoachIQ's OWN Clerk app,
   *  a separate instance from any originating CRM (e.g. conduit-next). */
  clerkOrgId: string | null;
  /** Supabase organizations.id (uuid) — this is what every `org_id` column expects */
  orgId: string | null;
  role: string;
};

/**
 * The single, reliable way to get the current user's org context in server code.
 * Ported from conduit-next's lib/auth/orgContext.ts, unchanged in shape — only
 * the underlying `organizations`/`profiles` tables differ (they're CreditCoachIQ's
 * own tenants now, not conduit-next's).
 */
export async function getOrgContext(): Promise<OrgContext> {
  const { userId, orgId: sessionOrgId } = await auth();
  if (!userId) return { userId: null, clerkOrgId: null, orgId: null, role: 'admin' };

  const sb = createAdminClient();

  const { data: existingProfile } = await sb
    .from('profiles')
    .select('org_id, role')
    .eq('clerk_user_id', userId)
    .maybeSingle();
  if (existingProfile?.org_id) {
    return {
      userId,
      clerkOrgId: sessionOrgId ?? null,
      orgId: existingProfile.org_id as string,
      role: (existingProfile.role as string) ?? 'admin',
    };
  }

  let clerkOrgId: string | null = sessionOrgId ?? null;
  let role = 'admin';

  if (!clerkOrgId) {
    try {
      const clerk = await clerkClient();
      const memberships = await clerk.users.getOrganizationMembershipList({ userId, limit: 1 });
      const m = memberships.data[0];
      clerkOrgId = m?.organization.id ?? null;
      if (m?.role === 'org:admin' || m?.role === 'admin') role = 'admin';
    } catch {
      // No org / Clerk lookup failed.
    }
  }

  if (!clerkOrgId) return { userId, clerkOrgId: null, orgId: null, role };

  let { data: org } = await sb
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .maybeSingle();

  if (!org) {
    let name = 'My Company';
    try {
      const clerk = await clerkClient();
      const o = await clerk.organizations.getOrganization({ organizationId: clerkOrgId });
      name = o.name || name;
    } catch {
      // Fall back to the default name.
    }
    const { data: created } = await sb
      .from('organizations')
      .upsert({ clerk_org_id: clerkOrgId, name }, { onConflict: 'clerk_org_id' })
      .select('id')
      .maybeSingle();
    org = created ?? null;
  }

  const orgId = org?.id ?? null;

  if (orgId) {
    const { data: profile } = await sb
      .from('profiles')
      .select('role, org_id')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    if (!profile || profile.org_id !== orgId) {
      let email = '';
      let firstName = '';
      let lastName = '';
      try {
        const clerk = await clerkClient();
        const u = await clerk.users.getUser(userId);
        email =
          u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
          u.emailAddresses[0]?.emailAddress ??
          '';
        firstName = u.firstName ?? '';
        lastName = u.lastName ?? '';
      } catch {
        // best-effort
      }
      await sb
        .from('profiles')
        .upsert(
          {
            clerk_user_id: userId,
            org_id: orgId,
            email,
            first_name: firstName,
            last_name: lastName,
            role: profile?.role ?? role,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id' }
        )
        .then(() => undefined, () => undefined);
    } else if (profile?.role) {
      role = profile.role;
    }
  }

  return { userId, clerkOrgId, orgId, role };
}
