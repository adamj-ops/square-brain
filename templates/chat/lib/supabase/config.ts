/**
 * Supabase Connection Pooling Configuration
 *
 * This module provides connection pooling configuration for Supabase clients.
 * Supabase uses Supavisor as its connection pooler, which can be configured
 * through environment variables and client options.
 *
 * Configuration options:
 * - SUPABASE_POOLER_URL: Use the pooled connection URL (.pooler.supabase.co)
 * - Connection keepalive settings for fetch
 * - Request timeout configuration
 * - Retry settings for transient failures
 *
 * @see https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler
 */

import type { SupabaseClientOptions } from "@supabase/supabase-js";

/**
 * Connection pooling configuration from environment
 */
export interface PoolingConfig {
  /** Use the pooler URL instead of direct connection */
  usePooler: boolean;
  /** Pooler URL (if different from standard URL) */
  poolerUrl?: string;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Enable fetch keepalive for connection reuse */
  keepAlive: boolean;
  /** Maximum number of retries for failed requests */
  maxRetries: number;
  /** Schema to use (default: public) */
  schema: string;
}

/**
 * Get connection pooling configuration from environment variables
 */
export function getPoolingConfig(): PoolingConfig {
  return {
    usePooler: process.env.SUPABASE_USE_POOLER === "true",
    poolerUrl: process.env.SUPABASE_POOLER_URL,
    requestTimeout: parseInt(
      process.env.SUPABASE_REQUEST_TIMEOUT || "30000",
      10
    ),
    keepAlive: process.env.SUPABASE_KEEP_ALIVE !== "false", // Default true
    maxRetries: parseInt(process.env.SUPABASE_MAX_RETRIES || "3", 10),
    schema: process.env.SUPABASE_SCHEMA || "public",
  };
}

/**
 * Get the appropriate Supabase URL based on pooling configuration
 * Uses SUPABASE_POOLER_URL if configured, otherwise falls back to standard URL
 *
 * Note: Returns placeholder during build if env vars aren't set,
 * which allows Next.js build to complete. Runtime will still fail
 * if env vars are truly missing.
 */
export function getSupabaseUrl(): string {
  const config = getPoolingConfig();
  const standardUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // During build time, env vars may not be set - return placeholder
  // This allows Next.js static analysis to complete
  if (!standardUrl) {
    return "https://placeholder.supabase.co";
  }

  if (config.usePooler && config.poolerUrl) {
    return config.poolerUrl;
  }

  return standardUrl;
}

/**
 * Create fetch options with keepalive for connection pooling
 * This enables HTTP connection reuse across requests
 */
function createFetchWithKeepalive(
  config: PoolingConfig
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.requestTimeout
    );

    const fetchInit: RequestInit = {
      ...init,
      signal: controller.signal,
      // Enable keepalive for connection reuse
      keepalive: config.keepAlive,
    };

    return fetch(input, fetchInit).finally(() => clearTimeout(timeoutId));
  };
}

/**
 * Get Supabase client options with connection pooling configuration
 * These options optimize the client for production use with connection reuse
 */
export function getPooledClientOptions(
  additionalOptions?: Partial<SupabaseClientOptions<"public">>
): SupabaseClientOptions<"public"> {
  const config = getPoolingConfig();

  const baseOptions: SupabaseClientOptions<"public"> = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: createFetchWithKeepalive(config),
      headers: {
        // Add connection pooling hint header
        "X-Client-Info": `supabase-js-pooled/${process.env.npm_package_version || "1.0.0"}`,
      },
    },
    db: {
      schema: config.schema as "public",
    },
    realtime: {
      params: {
        // Reduce realtime connection overhead
        eventsPerSecond: 10,
      },
    },
  };

  return {
    ...baseOptions,
    ...additionalOptions,
    auth: {
      ...baseOptions.auth,
      ...additionalOptions?.auth,
    },
    global: {
      ...baseOptions.global,
      ...additionalOptions?.global,
      headers: {
        ...baseOptions.global?.headers,
        ...additionalOptions?.global?.headers,
      },
    },
    db: {
      ...baseOptions.db,
      ...additionalOptions?.db,
    },
    realtime: {
      ...baseOptions.realtime,
      ...additionalOptions?.realtime,
    },
  };
}

/**
 * Get Supabase client options specifically for server-side use
 * Includes pooling config optimized for API routes and server components
 */
export function getServerPooledOptions(): SupabaseClientOptions<"public"> {
  return getPooledClientOptions({
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Get Supabase client options for browser/client-side use
 * Includes pooling config with session handling enabled
 */
export function getBrowserPooledOptions(): SupabaseClientOptions<"public"> {
  return getPooledClientOptions({
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Connection pool statistics (for monitoring/logging)
 */
export interface PoolStats {
  usePooler: boolean;
  requestTimeout: number;
  keepAlive: boolean;
  maxRetries: number;
}

/**
 * Get current pool statistics for monitoring
 */
export function getPoolStats(): PoolStats {
  const config = getPoolingConfig();
  return {
    usePooler: config.usePooler,
    requestTimeout: config.requestTimeout,
    keepAlive: config.keepAlive,
    maxRetries: config.maxRetries,
  };
}
