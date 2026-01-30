/**
 * Error Logging Utility
 *
 * Logs errors to ai_tool_logs table with error_type classification.
 * Phase 1A: Error Handling & Resilience
 */

import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Error type classification for categorizing errors.
 * Used for filtering, monitoring, and debugging.
 */
export type ErrorType =
  | "VALIDATION_ERROR"      // Input validation failures (schema, type checks)
  | "DATABASE_ERROR"        // Supabase/PostgreSQL errors
  | "API_ERROR"             // External API call failures
  | "AUTH_ERROR"            // Authentication/authorization failures
  | "RATE_LIMIT_ERROR"      // Rate limiting triggered
  | "TIMEOUT_ERROR"         // Operation timeout
  | "NETWORK_ERROR"         // Network connectivity issues
  | "INTERNAL_ERROR"        // Unexpected internal errors
  | "TOOL_EXECUTION_ERROR"  // Tool-specific execution failures
  | "CONFIGURATION_ERROR"   // Missing or invalid configuration
  | "RESOURCE_NOT_FOUND"    // Requested resource doesn't exist
  | "PERMISSION_DENIED"     // User lacks required permissions
  | "CONFLICT_ERROR"        // Resource conflict (e.g., duplicate)
  | "UNKNOWN_ERROR";        // Unclassified errors

/**
 * Context for error logging.
 * Contains org/session/user info for audit trail.
 */
export interface ErrorLogContext {
  /** Organization ID (required for RLS compliance) */
  org_id: string;
  /** Session ID for tracing */
  session_id?: string;
  /** User ID for attribution */
  user_id?: string;
  /** Source of the error (e.g., API route, tool name, component) */
  source?: string;
  /** Additional metadata for debugging */
  metadata?: Record<string, unknown>;
}

/**
 * Error payload structure for logging.
 */
export interface ErrorPayload {
  /** Error type classification */
  error_type: ErrorType;
  /** HTTP status code if applicable */
  code?: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: unknown;
  /** Original error stack trace (for debugging, never exposed to client) */
  stack?: string;
}

/**
 * Result of error logging operation.
 */
export interface ErrorLogResult {
  /** Whether the error was successfully logged */
  logged: boolean;
  /** ID of the log entry if successful */
  id?: string;
  /** Error message if logging failed */
  loggingError?: string;
}

/**
 * Logs an error to the ai_tool_logs table with error_type classification.
 *
 * @param error - The error payload with classification
 * @param context - Context for the error (org, session, user)
 * @returns Result indicating if logging succeeded
 *
 * @example
 * ```typescript
 * await logError(
 *   {
 *     error_type: "DATABASE_ERROR",
 *     code: "PGRST116",
 *     message: "Row not found",
 *     details: { table: "guests", id: "123" }
 *   },
 *   { org_id: "org-abc", source: "guests.upsert_profile" }
 * );
 * ```
 */
export async function logError(
  error: ErrorPayload,
  context: ErrorLogContext
): Promise<ErrorLogResult> {
  try {
    const supabase = getServiceSupabase();
    const now = new Date();

    // Build the error object for storage
    const errorData = {
      error_type: error.error_type,
      code: error.code ?? mapErrorTypeToCode(error.error_type),
      message: error.message,
      details: error.details ?? {},
      ...(error.stack ? { stack: error.stack } : {}),
    };

    // Insert into ai_tool_logs with status="error"
    const { data, error: insertError } = await supabase
      .from("ai_tool_logs")
      .insert({
        org_id: context.org_id,
        session_id: context.session_id ?? null,
        user_id: context.user_id ?? null,
        tool_name: context.source ?? "error_logger",
        status: "error",
        started_at: now.toISOString(),
        finished_at: now.toISOString(),
        duration_ms: 0,
        args: {},
        result: {},
        error: errorData,
        metadata: {
          ...context.metadata,
          logged_via: "logError",
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[error-logger] Failed to log error:", insertError.message);
      return {
        logged: false,
        loggingError: insertError.message,
      };
    }

    return {
      logged: true,
      id: data.id,
    };
  } catch (err) {
    // Catch any unexpected errors during logging
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[error-logger] Unexpected error during logging:", errorMessage);
    return {
      logged: false,
      loggingError: errorMessage,
    };
  }
}

/**
 * Helper to log an error from an Error object with automatic classification.
 *
 * @param err - The caught error object
 * @param context - Context for the error
 * @param errorType - Optional explicit error type (auto-detected if not provided)
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (err) {
 *   await logErrorFromException(err, { org_id: "org-abc", source: "api/guests" });
 * }
 * ```
 */
export async function logErrorFromException(
  err: unknown,
  context: ErrorLogContext,
  errorType?: ErrorType
): Promise<ErrorLogResult> {
  const error = normalizeError(err);
  const classifiedType = errorType ?? classifyError(err);

  return logError(
    {
      error_type: classifiedType,
      message: error.message,
      details: error.details,
      stack: error.stack,
    },
    context
  );
}

/**
 * Normalize an unknown error to a structured format.
 */
function normalizeError(err: unknown): {
  message: string;
  details?: unknown;
  stack?: string;
} {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
      details: "cause" in err ? err.cause : undefined,
    };
  }

  if (typeof err === "string") {
    return { message: err };
  }

  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    return {
      message: String(obj.message ?? "Unknown error"),
      details: obj,
    };
  }

  return { message: "Unknown error" };
}

/**
 * Automatically classify an error based on its properties.
 */
function classifyError(err: unknown): ErrorType {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    const name = err.name.toLowerCase();

    // Supabase/PostgreSQL errors
    if (
      message.includes("supabase") ||
      message.includes("postgres") ||
      message.includes("pgrst") ||
      message.includes("relation")
    ) {
      return "DATABASE_ERROR";
    }

    // Network errors
    if (
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    ) {
      return "NETWORK_ERROR";
    }

    // Timeout errors
    if (message.includes("timeout") || message.includes("timed out")) {
      return "TIMEOUT_ERROR";
    }

    // Auth errors
    if (
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("authentication") ||
      message.includes("jwt")
    ) {
      return "AUTH_ERROR";
    }

    // Rate limit errors
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("429")
    ) {
      return "RATE_LIMIT_ERROR";
    }

    // Validation errors
    if (
      name.includes("validation") ||
      name.includes("zod") ||
      message.includes("invalid") ||
      message.includes("required")
    ) {
      return "VALIDATION_ERROR";
    }

    // Not found errors
    if (message.includes("not found") || message.includes("does not exist")) {
      return "RESOURCE_NOT_FOUND";
    }

    // Type errors are often internal
    if (name === "typeerror" || name === "referenceerror") {
      return "INTERNAL_ERROR";
    }
  }

  return "UNKNOWN_ERROR";
}

/**
 * Map error type to a default HTTP-like code.
 */
function mapErrorTypeToCode(errorType: ErrorType): string {
  const codeMap: Record<ErrorType, string> = {
    VALIDATION_ERROR: "400",
    DATABASE_ERROR: "500",
    API_ERROR: "502",
    AUTH_ERROR: "401",
    RATE_LIMIT_ERROR: "429",
    TIMEOUT_ERROR: "504",
    NETWORK_ERROR: "503",
    INTERNAL_ERROR: "500",
    TOOL_EXECUTION_ERROR: "500",
    CONFIGURATION_ERROR: "500",
    RESOURCE_NOT_FOUND: "404",
    PERMISSION_DENIED: "403",
    CONFLICT_ERROR: "409",
    UNKNOWN_ERROR: "500",
  };
  return codeMap[errorType];
}

/**
 * Create a typed error with error_type for consistent error handling.
 */
export class TypedError extends Error {
  public readonly error_type: ErrorType;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(
    error_type: ErrorType,
    message: string,
    options?: { code?: string; details?: unknown; cause?: Error }
  ) {
    super(message, { cause: options?.cause });
    this.name = "TypedError";
    this.error_type = error_type;
    this.code = options?.code;
    this.details = options?.details;
  }
}

/**
 * Type guard to check if an error is a TypedError.
 */
export function isTypedError(err: unknown): err is TypedError {
  return err instanceof TypedError;
}
