import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getServerPooledOptions } from "./config";

/**
 * Creates a Supabase client using the service role key with connection pooling.
 * Use ONLY in server-side code (API routes, server components).
 * This bypasses RLS - use with caution.
 *
 * Connection pooling is configured via environment variables:
 * - SUPABASE_USE_POOLER: Set to "true" to use pooler URL
 * - SUPABASE_POOLER_URL: The pooled connection URL
 * - SUPABASE_REQUEST_TIMEOUT: Request timeout in ms (default: 30000)
 * - SUPABASE_KEEP_ALIVE: Enable HTTP keepalive (default: true)
 * - SUPABASE_MAX_RETRIES: Max retries for failed requests (default: 3)
 *
 * @see lib/supabase/config.ts for full pooling configuration
 */
export function getServiceSupabase(): SupabaseClient {
  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  }

  return createClient(url, serviceKey, getServerPooledOptions());
}
