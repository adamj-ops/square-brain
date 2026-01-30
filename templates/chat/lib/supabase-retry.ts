/**
 * Supabase Retry Logic with Exponential Backoff
 *
 * Provides robust retry functionality for Supabase client operations.
 * Implements exponential backoff with jitter to handle transient failures.
 *
 * Phase 1A.3: Error Handling & Resilience
 */

import { SupabaseClient, PostgrestError } from "@supabase/supabase-js";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs: number;
  /** Whether to add random jitter to delays (default: true) */
  useJitter: boolean;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  useJitter: true,
  backoffMultiplier: 2,
};

/**
 * Error types that are considered retryable
 */
const RETRYABLE_ERROR_CODES = new Set([
  // PostgreSQL connection errors
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection

  // Network/timeout related
  "57014", // query_canceled (often timeout)
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now

  // Lock/deadlock (retry might succeed)
  "40001", // serialization_failure
  "40P01", // deadlock_detected

  // Too many connections
  "53300", // too_many_connections
]);

/**
 * HTTP status codes that indicate retryable errors
 */
const RETRYABLE_HTTP_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Check if an error message contains retryable patterns
 */
function hasRetryableMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("connection") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("temporarily") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many") ||
    lowerMessage.includes("unavailable") ||
    lowerMessage.includes("network") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("econnreset") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("fetch") ||
    lowerMessage.includes("abort")
  );
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Check for PostgrestError
  if (isPostgrestError(error)) {
    // Check PostgreSQL error code
    if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
      return true;
    }

    // Check for common retryable messages
    if (hasRetryableMessage(error.message || "")) {
      return true;
    }
  }

  // Check for fetch/network errors
  if (error instanceof Error) {
    if (hasRetryableMessage(error.message)) {
      return true;
    }
  }

  // Check for plain objects with message property
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && hasRetryableMessage(message)) {
      return true;
    }
  }

  // Check for HTTP response errors
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: number }).status;
    if (RETRYABLE_HTTP_CODES.has(status)) {
      return true;
    }
  }

  return false;
}

/**
 * Type guard for PostgrestError
 */
export function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as PostgrestError).message === "string"
  );
}

/**
 * Calculate delay for next retry attempt with exponential backoff
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff: baseDelay * (multiplier ^ attempt)
  let delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);

  // Cap at maximum delay
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter (±25% randomization) to prevent thundering herd
  if (config.useJitter) {
    const jitterRange = delay * 0.25;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    delay = delay + jitter;
  }

  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: PostgrestError | Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Execute a Supabase operation with retry logic and exponential backoff.
 *
 * @param operation - Async function that returns { data, error }
 * @param config - Optional retry configuration
 * @returns RetryResult with success status and data/error
 *
 * @example
 * ```ts
 * const result = await withRetry(async () => {
 *   return supabase.from('users').select('*').single();
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<{ data: T | null; error: PostgrestError | null }>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: PostgrestError | Error | undefined;
  let attempts = 0;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    attempts = attempt + 1;

    try {
      const result = await operation();

      if (!result.error) {
        // Success!
        return {
          success: true,
          data: result.data ?? undefined,
          attempts,
          totalDelayMs,
        };
      }

      // Got an error - check if retryable
      lastError = result.error;

      if (!isRetryableError(result.error)) {
        // Non-retryable error - fail immediately
        console.warn(`[supabase-retry] Non-retryable error on attempt ${attempts}:`, {
          code: result.error.code,
          message: result.error.message,
        });
        break;
      }

      // Retryable error - check if we have retries left
      if (attempt < fullConfig.maxRetries) {
        const delay = calculateRetryDelay(attempt, fullConfig);
        totalDelayMs += delay;

        console.warn(`[supabase-retry] Retryable error on attempt ${attempts}, waiting ${delay}ms:`, {
          code: result.error.code,
          message: result.error.message,
          nextAttempt: attempt + 2,
          maxAttempts: fullConfig.maxRetries + 1,
        });

        await sleep(delay);
      }
    } catch (err) {
      // Operation threw an exception
      lastError = err instanceof Error ? err : new Error(String(err));

      if (!isRetryableError(err)) {
        console.warn(`[supabase-retry] Non-retryable exception on attempt ${attempts}:`, lastError.message);
        break;
      }

      if (attempt < fullConfig.maxRetries) {
        const delay = calculateRetryDelay(attempt, fullConfig);
        totalDelayMs += delay;

        console.warn(`[supabase-retry] Retryable exception on attempt ${attempts}, waiting ${delay}ms:`, lastError.message);

        await sleep(delay);
      }
    }
  }

  // All retries exhausted or non-retryable error
  console.error(`[supabase-retry] Operation failed after ${attempts} attempts, total delay: ${totalDelayMs}ms`, {
    error: lastError?.message,
  });

  return {
    success: false,
    error: lastError,
    attempts,
    totalDelayMs,
  };
}

/**
 * Create a retry-enabled Supabase query builder wrapper.
 * Wraps common Supabase query operations with automatic retry.
 *
 * @param supabase - Supabase client instance
 * @param config - Optional retry configuration
 * @returns Object with retry-wrapped query methods
 *
 * @example
 * ```ts
 * const retryClient = createRetryClient(supabase);
 *
 * // Single row query with retry
 * const { data, error } = await retryClient.single(
 *   supabase.from('users').select('*').eq('id', userId)
 * );
 *
 * // Multiple rows query with retry
 * const { data, error } = await retryClient.many(
 *   supabase.from('items').select('*').limit(10)
 * );
 * ```
 */
export function createRetryClient(
  supabase: SupabaseClient,
  config: Partial<RetryConfig> = {}
) {
  return {
    /**
     * Execute a query expecting a single row with retry
     */
    async single<T>(
      query: PromiseLike<{ data: T | null; error: PostgrestError | null }>
    ): Promise<{ data: T | null; error: PostgrestError | Error | null }> {
      const result = await withRetry<T>(async () => await query, config);

      if (result.success) {
        return { data: result.data ?? null, error: null };
      }

      return {
        data: null,
        error: result.error ?? new Error("Unknown error"),
      };
    },

    /**
     * Execute a query expecting multiple rows with retry
     */
    async many<T>(
      query: PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
    ): Promise<{ data: T[] | null; error: PostgrestError | Error | null }> {
      const result = await withRetry<T[]>(async () => await query, config);

      if (result.success) {
        return { data: result.data ?? [], error: null };
      }

      return {
        data: null,
        error: result.error ?? new Error("Unknown error"),
      };
    },

    /**
     * Execute a mutation (insert/update/delete) with retry
     */
    async mutate<T>(
      query: PromiseLike<{ data: T | null; error: PostgrestError | null }>
    ): Promise<{ data: T | null; error: PostgrestError | Error | null }> {
      const result = await withRetry<T>(async () => await query, config);

      if (result.success) {
        return { data: result.data ?? null, error: null };
      }

      return {
        data: null,
        error: result.error ?? new Error("Unknown error"),
      };
    },
  };
}

/**
 * Simple retry wrapper for any async operation.
 * Unlike withRetry, this works with any promise, not just Supabase queries.
 *
 * @param fn - Async function to retry
 * @param config - Optional retry configuration
 * @returns The result of the function if successful
 * @throws The last error if all retries fail
 *
 * @example
 * ```ts
 * const data = await retry(async () => {
 *   const response = await fetch('/api/data');
 *   if (!response.ok) throw new Error('Failed');
 *   return response.json();
 * });
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (!isRetryableError(err)) {
        throw lastError;
      }

      if (attempt < fullConfig.maxRetries) {
        const delay = calculateRetryDelay(attempt, fullConfig);
        console.warn(`[retry] Attempt ${attempt + 1} failed, waiting ${delay}ms:`, lastError.message);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("Retry failed");
}
