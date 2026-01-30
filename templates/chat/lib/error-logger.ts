/**
 * Error Logging Utility
 *
 * Writes errors to ai_tool_logs with error_type classification.
 * Provides centralized error logging for the entire application.
 *
 * Phase 1A.5: Error Handling & Resilience
 */

import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Error type classifications for structured error logging
 */
export type ErrorType =
  | "react_error_boundary"
  | "api_error"
  | "database_error"
  | "validation_error"
  | "authentication_error"
  | "authorization_error"
  | "external_service_error"
  | "tool_execution_error"
  | "network_error"
  | "timeout_error"
  | "rate_limit_error"
  | "unknown_error";

/**
 * Error severity levels
 */
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

/**
 * Error log entry structure
 */
export interface ErrorLogEntry {
  /** Classification of the error type */
  error_type: ErrorType;
  /** Error severity level */
  severity?: ErrorSeverity;
  /** Error name/class (e.g., "TypeError") */
  error_name?: string;
  /** Human-readable error message */
  error_message: string;
  /** Stack trace if available */
  error_stack?: string;
  /** Component stack for React errors */
  component_stack?: string;
  /** HTTP status code if applicable */
  status_code?: number;
  /** Request URL if applicable */
  url?: string;
  /** Request method if applicable */
  method?: string;
  /** Organization ID for multi-tenant context */
  org_id?: string;
  /** Session ID for request tracing */
  session_id?: string;
  /** User ID if authenticated */
  user_id?: string;
  /** Request ID for correlation */
  request_id?: string;
  /** Tool name if tool-related error */
  tool_name?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp?: string;
}

/**
 * Result of logging an error
 */
export interface LogErrorResult {
  success: boolean;
  log_id?: string;
  error?: string;
}

/**
 * Classify an error into an ErrorType based on its characteristics
 */
export function classifyError(error: unknown): ErrorType {
  if (!error) return "unknown_error";

  // Check for specific error types by message patterns
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const errorName = error instanceof Error ? error.name : "";

  // Network errors
  if (
    errorMessage.includes("network") ||
    errorMessage.includes("fetch") ||
    errorMessage.includes("econnrefused") ||
    errorMessage.includes("econnreset") ||
    errorName === "TypeError" && errorMessage.includes("failed to fetch")
  ) {
    return "network_error";
  }

  // Timeout errors
  if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("etimedout") ||
    errorMessage.includes("timed out") ||
    errorMessage.includes("aborted")
  ) {
    return "timeout_error";
  }

  // Rate limit errors
  if (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("too many requests") ||
    errorMessage.includes("429")
  ) {
    return "rate_limit_error";
  }

  // Database errors
  if (
    errorMessage.includes("postgres") ||
    errorMessage.includes("supabase") ||
    errorMessage.includes("database") ||
    errorMessage.includes("sql") ||
    errorMessage.includes("relation") ||
    errorMessage.includes("constraint") ||
    errorMessage.includes("duplicate key")
  ) {
    return "database_error";
  }

  // Validation errors
  if (
    errorMessage.includes("validation") ||
    errorMessage.includes("invalid") ||
    errorMessage.includes("required") ||
    errorMessage.includes("missing") ||
    errorName === "ValidationError" ||
    errorName === "ZodError"
  ) {
    return "validation_error";
  }

  // Authentication errors
  if (
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("unauthenticated") ||
    errorMessage.includes("login") ||
    errorMessage.includes("401") ||
    errorMessage.includes("auth")
  ) {
    return "authentication_error";
  }

  // Authorization errors
  if (
    errorMessage.includes("forbidden") ||
    errorMessage.includes("permission") ||
    errorMessage.includes("access denied") ||
    errorMessage.includes("403")
  ) {
    return "authorization_error";
  }

  // External service errors (OpenAI, etc.)
  if (
    errorMessage.includes("openai") ||
    errorMessage.includes("api") ||
    errorMessage.includes("external") ||
    errorMessage.includes("service unavailable")
  ) {
    return "external_service_error";
  }

  return "unknown_error";
}

/**
 * Determine severity based on error type and context
 */
export function determineSeverity(
  errorType: ErrorType,
  statusCode?: number
): ErrorSeverity {
  // Critical errors that need immediate attention
  if (
    errorType === "database_error" ||
    errorType === "authentication_error" ||
    statusCode === 500
  ) {
    return "critical";
  }

  // High severity errors
  if (
    errorType === "authorization_error" ||
    errorType === "external_service_error" ||
    statusCode === 503
  ) {
    return "high";
  }

  // Medium severity errors
  if (
    errorType === "network_error" ||
    errorType === "timeout_error" ||
    errorType === "tool_execution_error" ||
    errorType === "rate_limit_error"
  ) {
    return "medium";
  }

  // Low severity errors
  if (
    errorType === "validation_error" ||
    errorType === "react_error_boundary"
  ) {
    return "low";
  }

  return "medium";
}

/**
 * Log an error to the ai_tool_logs table
 *
 * @param entry - Error log entry with details
 * @returns Result indicating success or failure
 *
 * @example
 * ```ts
 * await logError({
 *   error_type: "api_error",
 *   error_message: "Failed to fetch user data",
 *   status_code: 500,
 *   url: "/api/users/123",
 *   org_id: "org_abc",
 * });
 * ```
 */
export async function logError(entry: ErrorLogEntry): Promise<LogErrorResult> {
  try {
    const supabase = getServiceSupabase();

    // Auto-determine severity if not provided
    const severity = entry.severity ?? determineSeverity(entry.error_type, entry.status_code);

    const { data, error } = await supabase
      .from("ai_tool_logs")
      .insert({
        org_id: entry.org_id || process.env.DEFAULT_ORG_ID || "default",
        session_id: entry.session_id || null,
        user_id: entry.user_id || null,
        tool_name: entry.tool_name || "__error_log__",
        status: "error",
        args: {}, // No args for error logs
        error: {
          error_type: entry.error_type,
          severity,
          name: entry.error_name,
          message: entry.error_message,
          stack: entry.error_stack,
          component_stack: entry.component_stack,
          status_code: entry.status_code,
          url: entry.url,
          method: entry.method,
          request_id: entry.request_id,
        },
        metadata: {
          ...entry.metadata,
          logged_at: entry.timestamp || new Date().toISOString(),
          source: "error_logger",
        },
      })
      .select("id")
      .single();

    if (error) {
      console.error("[error-logger] Failed to write to database:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true, log_id: data.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[error-logger] Exception while logging error:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Log an Error object with automatic classification
 *
 * @param error - Error object or unknown thrown value
 * @param context - Additional context for the error
 * @returns Result indicating success or failure
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   await logErrorObject(error, {
 *     url: "/api/operation",
 *     org_id: "org_abc",
 *   });
 * }
 * ```
 */
export async function logErrorObject(
  error: unknown,
  context: Partial<Omit<ErrorLogEntry, "error_type" | "error_message" | "error_name" | "error_stack">> = {}
): Promise<LogErrorResult> {
  const errorType = context.tool_name ? "tool_execution_error" : classifyError(error);

  let errorMessage: string;
  let errorName: string | undefined;
  let errorStack: string | undefined;

  if (error instanceof Error) {
    errorMessage = error.message;
    errorName = error.name;
    errorStack = error.stack;
  } else {
    errorMessage = String(error);
  }

  return logError({
    error_type: errorType,
    error_message: errorMessage,
    error_name: errorName,
    error_stack: errorStack,
    timestamp: new Date().toISOString(),
    ...context,
  });
}

/**
 * Create a logger instance with pre-configured context.
 * Useful for request-scoped logging.
 *
 * @param context - Default context for all logs from this instance
 * @returns Logger instance with log method
 *
 * @example
 * ```ts
 * const requestLogger = createErrorLogger({
 *   org_id: "org_abc",
 *   session_id: "sess_123",
 *   request_id: "req_456",
 * });
 *
 * await requestLogger.log(new Error("Something failed"), {
 *   url: "/api/action",
 * });
 * ```
 */
export function createErrorLogger(
  context: Partial<ErrorLogEntry>
) {
  return {
    async log(
      error: unknown,
      additionalContext: Partial<ErrorLogEntry> = {}
    ): Promise<LogErrorResult> {
      return logErrorObject(error, { ...context, ...additionalContext });
    },

    async logEntry(entry: Partial<ErrorLogEntry>): Promise<LogErrorResult> {
      return logError({
        error_type: "unknown_error",
        error_message: "Unknown error",
        ...context,
        ...entry,
      } as ErrorLogEntry);
    },
  };
}
