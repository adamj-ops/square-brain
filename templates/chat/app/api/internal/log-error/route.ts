/**
 * POST /api/internal/log-error
 *
 * Endpoint for logging client-side errors (e.g., from error boundaries).
 * Writes to ai_tool_logs with error_type classification.
 *
 * Phase 1A.5: Error Handling & Resilience
 */

import { NextRequest, NextResponse } from "next/server";
import { logError, ErrorType, ErrorLogEntry } from "@/lib/error-logger";

/**
 * Request body schema for logging errors
 */
interface LogErrorRequest {
  error_type?: ErrorType;
  error_name?: string;
  error_message: string;
  error_stack?: string;
  component_stack?: string;
  url?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body: LogErrorRequest = await req.json();

    // Validate required field
    if (!body.error_message) {
      return NextResponse.json(
        { success: false, error: "error_message is required" },
        { status: 400 }
      );
    }

    // Extract request ID from headers if present
    const requestId = req.headers.get("X-Request-ID") || undefined;

    // Build log entry
    const logEntry: ErrorLogEntry = {
      error_type: body.error_type || "react_error_boundary",
      error_name: body.error_name,
      error_message: body.error_message,
      error_stack: body.error_stack,
      component_stack: body.component_stack,
      url: body.url,
      request_id: requestId,
      timestamp: body.timestamp || new Date().toISOString(),
      metadata: {
        ...body.metadata,
        source: "client",
        user_agent: req.headers.get("User-Agent") || undefined,
      },
    };

    // Log to database
    const result = await logError(logEntry);

    if (result.success) {
      return NextResponse.json({
        success: true,
        log_id: result.log_id,
      });
    }

    // Logging failed but return 200 to not disrupt client
    console.warn("[log-error] Failed to log error:", result.error);
    return NextResponse.json({
      success: false,
      error: "Failed to log error",
    });
  } catch (err) {
    // Don't fail the request even if logging fails
    console.error("[log-error] Exception:", err instanceof Error ? err.message : err);
    return NextResponse.json({
      success: false,
      error: "Internal error",
    });
  }
}
