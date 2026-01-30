/**
 * Exponential Backoff Retry Logic for Supabase Operations
 *
 * Provides robust retry handling for transient failures such as:
 * - Network timeouts
 * - Rate limiting (429 errors)
 * - Connection pool exhaustion
 * - Temporary database unavailability
 *
 * Phase 1A.3: Error Handling & Resilience
 */

import { PostgrestError } from "@supabase/supabase-js";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Jitter factor as a percentage of delay (default: 0.25) */
  jitterFactor?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback for logging retry attempts */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffFactor: 2,
  jitter: true,
  jitterFactor: 0.25,
  isRetryable: isTransientError,
  onRetry: defaultOnRetry,
};

/**
 * HTTP status codes that indicate transient errors
 */
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Error messages that indicate transient network issues
 */
const RETRYABLE_ERROR_PATTERNS = [
  /network/i,
  /timeout/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /connection pool/i,
  /too many connections/i,
  /rate limit/i,
  /temporarily unavailable/i,
  /overloaded/i,
];

/**
 * Postgrest error codes that are retryable
 * See: https://postgrest.org/en/stable/references/errors.html
 */
const RETRYABLE_POSTGREST_CODES = new Set([
  "PGRST301", // Connection pool timeout
  "PGRST302", // Connection failed
  "40001", // Serialization failure
  "40P01", // Deadlock detected
  "57P01", // Admin shutdown
  "57P02", // Crash shutdown
  "57P03", // Cannot connect now
  "53300", // Too many connections
  "08000", // Connection exception
  "08003", // Connection does not exist
  "08006", // Connection failure
]);

/**
 * Determines if an error is transient and should be retried
 */
export function isTransientError(error: unknown): boolean {
  // Handle null/undefined
  if (!error) return false;

  // Handle PostgrestError
  if (isPostgrestError(error)) {
    // Check status code
    if (RETRYABLE_STATUS_CODES.has(error.code as unknown as number)) {
      return true;
    }
    // Check error code
    if (error.code && RETRYABLE_POSTGREST_CODES.has(error.code)) {
      return true;
    }
    // Check message patterns
    if (
      error.message &&
      RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message))
    ) {
      return true;
    }
    return false;
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    const errorMessage = error.message;
    const errorName = error.name;

    // Check for network-related error types
    if (
      ["AbortError", "TimeoutError", "NetworkError"].includes(errorName)
    ) {
      return true;
    }

    // Check message patterns
    if (RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
      return true;
    }

    // Check for fetch AbortError
    if (errorName === "AbortError") {
      return true;
    }
  }

  // Handle response-like objects (e.g., from fetch)
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: number }).status;
    if (RETRYABLE_STATUS_CODES.has(status)) {
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
    ("code" in error || "details" in error || "hint" in error)
  );
}

/**
 * Default retry logging callback
 */
function defaultOnRetry(
  error: unknown,
  attempt: number,
  delayMs: number
): void {
  const message =
    error instanceof Error
      ? error.message
      : isPostgrestError(error)
        ? error.message
        : String(error);

  console.warn(
    `[supabase-retry] Attempt ${attempt} failed: ${message}. Retrying in ${delayMs}ms...`
  );
}

/**
 * Calculates the delay for the next retry attempt using exponential backoff
 */
export function calculateDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  // Calculate base delay with exponential backoff
  let delay =
    config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1);

  // Apply maximum cap
  delay = Math.min(delay, config.maxDelayMs);

  // Apply jitter if enabled
  if (config.jitter) {
    const jitterAmount = delay * config.jitterFactor;
    const randomJitter = (Math.random() * 2 - 1) * jitterAmount;
    delay = Math.max(0, delay + randomJitter);
  }

  return Math.round(delay);
}

/**
 * Sleep for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Result of a retried operation
 */
export interface RetryResult<T> {
  /** The result of the operation if successful */
  data: T;
  /** Number of attempts made (1 = succeeded on first try) */
  attempts: number;
  /** Total time spent including retries (ms) */
  totalTimeMs: number;
}

/**
 * Error thrown when all retry attempts are exhausted
 */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;
  readonly totalTimeMs: number;

  constructor(
    attempts: number,
    lastError: unknown,
    totalTimeMs: number
  ) {
    const message =
      lastError instanceof Error
        ? lastError.message
        : String(lastError);

    super(
      `All ${attempts} retry attempts exhausted. Last error: ${message}`
    );

    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
    this.totalTimeMs = totalTimeMs;
  }
}

/**
 * Wraps an async operation with exponential backoff retry logic
 *
 * @param operation - The async function to execute with retries
 * @param config - Optional retry configuration
 * @returns The result of the operation wrapped with retry metadata
 *
 * @example
 * ```ts
 * const result = await withRetry(async () => {
 *   const { data, error } = await supabase
 *     .from('users')
 *     .select('*')
 *     .eq('id', userId);
 *
 *   if (error) throw error;
 *   return data;
 * });
 *
 * console.log(`Succeeded after ${result.attempts} attempt(s)`);
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config?: RetryConfig
): Promise<RetryResult<T>> {
  const mergedConfig: Required<RetryConfig> = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= mergedConfig.maxRetries + 1; attempt++) {
    try {
      const data = await operation();
      return {
        data,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error;

      // Check if we've exhausted retries
      if (attempt > mergedConfig.maxRetries) {
        throw new RetryExhaustedError(
          attempt,
          lastError,
          Date.now() - startTime
        );
      }

      // Check if error is retryable
      if (!mergedConfig.isRetryable(error)) {
        throw error;
      }

      // Calculate delay and wait
      const delayMs = calculateDelay(attempt, mergedConfig);
      mergedConfig.onRetry(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new RetryExhaustedError(
    mergedConfig.maxRetries + 1,
    lastError,
    Date.now() - startTime
  );
}

/**
 * Convenience wrapper that handles Supabase query results with { data, error } pattern
 *
 * @example
 * ```ts
 * const users = await withSupabaseRetry(() =>
 *   supabase.from('users').select('*').eq('id', userId)
 * );
 * // users is the data directly, error handling done internally
 * ```
 */
export async function withSupabaseRetry<T>(
  operation: () => Promise<{ data: T | null; error: PostgrestError | null }>,
  config?: RetryConfig
): Promise<T> {
  const result = await withRetry(async () => {
    const { data, error } = await operation();

    if (error) {
      throw error;
    }

    return data as T;
  }, config);

  return result.data;
}

/**
 * Creates a retry wrapper with pre-configured settings
 *
 * @example
 * ```ts
 * const aggressiveRetry = createRetryWrapper({
 *   maxRetries: 5,
 *   initialDelayMs: 50,
 *   maxDelayMs: 5000,
 * });
 *
 * const data = await aggressiveRetry(() =>
 *   supabase.from('critical_table').select('*')
 * );
 * ```
 */
export function createRetryWrapper(baseConfig: RetryConfig) {
  return async function <T>(
    operation: () => Promise<{ data: T | null; error: PostgrestError | null }>,
    additionalConfig?: RetryConfig
  ): Promise<T> {
    return withSupabaseRetry(operation, {
      ...baseConfig,
      ...additionalConfig,
    });
  };
}

/**
 * Pre-configured retry wrapper for critical operations
 * Uses more aggressive retry settings
 */
export const withCriticalRetry = createRetryWrapper({
  maxRetries: 5,
  initialDelayMs: 200,
  maxDelayMs: 15000,
  backoffFactor: 2,
});

/**
 * Pre-configured retry wrapper for fast operations
 * Uses fewer retries with shorter delays
 */
export const withFastRetry = createRetryWrapper({
  maxRetries: 2,
  initialDelayMs: 50,
  maxDelayMs: 500,
  backoffFactor: 2,
});
