import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// IMPORTANT: This client uses the service role key and bypasses RLS.
// It must ONLY be used in server-side code (API routes, Server Actions).
// NEVER import this in client components or expose it to the browser.

type AdminClient = SupabaseClient<any, any, any>;

let adminClient: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set. Admin client cannot be initialized.');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Admin client cannot be initialized.');
  }

  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return adminClient;
}
