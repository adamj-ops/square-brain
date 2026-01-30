/**
 * Structured API Error Utilities
 *
 * Provides consistent error handling and response formatting across all API routes.
 * All API errors should include: code, message, and optionally details.
 */

import { NextResponse } from "next/server";

/**
 * Error codes for API responses
 */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "UPSTREAM_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "CONFIGURATION_ERROR";

/**
 * Structured API error response
 */
export interface ApiErrorResponse {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

/**
 * HTTP status codes for each error type
 */
const ERROR_STATUS_MAP: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  CONFIGURATION_ERROR: 500,
};

/**
 * Create a structured API error response
 */
export function createApiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const status = ERROR_STATUS_MAP[code];
  return NextResponse.json({ code, message, details }, { status });
}

/**
 * Create a structured API error response using plain Response (for edge runtime)
 */
export function createApiErrorResponse(
  code: ApiErrorCode,
  message: string,
  details?: unknown
): Response {
  const status = ERROR_STATUS_MAP[code];
  return new Response(
    JSON.stringify({ code, message, details }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Wrap an async route handler with try-catch and structured error responses
 * Works with NextResponse (standard Next.js routes)
 */
export function withErrorHandling<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
  context?: string
): (...args: T) => Promise<NextResponse> {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${context || "api"}] Unhandled error:`, error);

      return createApiError(
        "INTERNAL_ERROR",
        "An unexpected error occurred",
        { originalError: errorMessage }
      );
    }
  };
}

/**
 * Wrap an async route handler with try-catch and structured error responses
 * Works with plain Response (for edge runtime or streaming routes)
 */
export function withErrorHandlingResponse<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
  context?: string
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${context || "api"}] Unhandled error:`, error);

      return createApiErrorResponse(
        "INTERNAL_ERROR",
        "An unexpected error occurred",
        { originalError: errorMessage }
      );
    }
  };
}

/**
 * Helper to extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

/**
 * Helper to determine if an error is a validation error based on message
 */
export function isValidationError(message: string): boolean {
  const validationPatterns = [
    "must be",
    "invalid",
    "required",
    "missing",
    "cannot be",
    "should be",
    "is not",
    "are not",
  ];
  const lowerMessage = message.toLowerCase();
  return validationPatterns.some((pattern) => lowerMessage.includes(pattern));
}
