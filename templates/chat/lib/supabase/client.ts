import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseUrl,
  getBrowserPooledOptions,
  getServerPooledOptions,
} from "./config";

// Lazy-initialized browser client singleton
let _supabaseClient: SupabaseClient | null = null;

/**
 * Get the browser Supabase client - uses anon key with RLS
 *
 * Connection pooling is enabled by default with HTTP keepalive.
 * Configure via environment variables:
 * - SUPABASE_REQUEST_TIMEOUT: Request timeout in ms (default: 30000)
 * - SUPABASE_KEEP_ALIVE: Enable HTTP keepalive (default: true)
 *
 * @see lib/supabase/config.ts for full pooling configuration
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      getBrowserPooledOptions()
    );
  }
  return _supabaseClient;
}

/**
 * Browser client - uses anon key with RLS
 * @deprecated Use getSupabaseClient() instead for lazy initialization
 *
 * Note: This export is kept for backwards compatibility but may fail
 * during Next.js build if env vars aren't set at module load time.
 */
export const supabase: SupabaseClient = (() => {
  // During build, env vars may not be set - return a placeholder
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a dummy client during build that will be replaced at runtime
    // This allows Next.js to complete static analysis
    return createClient(
      "https://placeholder.supabase.co",
      "placeholder-key",
      getBrowserPooledOptions()
    );
  }

  return createClient(url, key, getBrowserPooledOptions());
})();

/**
 * Server client - uses service role key for admin operations (API routes only)
 *
 * This client uses connection pooling configuration optimized for server use.
 * If SUPABASE_USE_POOLER is true and SUPABASE_POOLER_URL is set,
 * it will use the Supavisor pooled connection URL.
 *
 * @see lib/supabase/config.ts for full pooling configuration
 */
export function createServerClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceRoleKey, getServerPooledOptions());
}
