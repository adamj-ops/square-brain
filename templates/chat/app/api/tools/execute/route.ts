/**
 * POST /api/tools/execute
 *
 * Internal endpoint for tool execution.
 * Protected by X-Internal-Secret header.
 * NOT for browser/client use - server-to-server only.
 *
 * Phase 4: Tool Executor + Audit Logging
 */

import { NextRequest, NextResponse } from "next/server";
import { executeTool } from "@/lib/tools/executeTool";
import type { ToolContext } from "@/lib/tools/types";
import { createApiError, getErrorMessage } from "@/lib/api/errors";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Request body schema
 */
interface ExecuteToolRequest {
  toolName: string;
  args: unknown;
  context?: {
    org_id?: string;
    session_id?: string;
    user_id?: string;
    allowWrites?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Verify internal secret
    const secret = req.headers.get("X-Internal-Secret");
    if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
      return createApiError(
        "UNAUTHORIZED",
        "Invalid or missing X-Internal-Secret header",
        { header: "X-Internal-Secret" }
      );
    }

    // 2. Parse body
    let body: ExecuteToolRequest;
    try {
      body = await req.json();
    } catch {
      return createApiError(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "{ toolName, args, context? }" }
      );
    }

    // 3. Validate required fields
    if (!body.toolName || typeof body.toolName !== "string") {
      return createApiError(
        "VALIDATION_ERROR",
        "toolName is required and must be a string",
        { field: "toolName" }
      );
    }

    // 4. Build context with defaults
    const ctx: ToolContext = {
      org_id: body.context?.org_id || DEFAULT_ORG_ID || "",
      session_id: body.context?.session_id,
      user_id: body.context?.user_id,
      allowWrites: body.context?.allowWrites ?? false,
      metadata: body.context?.metadata,
    };

    if (!ctx.org_id) {
      return createApiError(
        "VALIDATION_ERROR",
        "org_id is required (either in context or via DEFAULT_ORG_ID env)",
        { field: "org_id" }
      );
    }

    // 5. Execute tool
    const result = await executeTool(body.toolName, body.args, ctx);

    // 6. Return result
    if (result.ok) {
      return NextResponse.json(
        {
          ok: true,
          tool: result.tool,
          data: result.response.data,
          explainability: result.response.explainability,
        },
        { status: 200 }
      );
    } else {
      // Map tool error codes to API error codes
      const errorCodeMap: Record<string, { code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_ERROR" | "INTERNAL_ERROR"; status: number }> = {
        TOOL_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
        WRITE_NOT_ALLOWED: { code: "FORBIDDEN", status: 403 },
        VALIDATION_ERROR: { code: "VALIDATION_ERROR", status: 400 },
        EXECUTION_ERROR: { code: "INTERNAL_ERROR", status: 500 },
      };

      const mapped = errorCodeMap[result.error.code] || { code: "INTERNAL_ERROR" as const, status: 500 };

      return NextResponse.json(
        {
          code: mapped.code,
          message: result.error.message,
          details: {
            ok: false,
            tool: result.tool,
            originalCode: result.error.code,
          },
        },
        { status: mapped.status }
      );
    }
  } catch (error) {
    console.error("[tools/execute] Unhandled error:", error);
    return createApiError(
      "INTERNAL_ERROR",
      "An unexpected error occurred during tool execution",
      { originalError: getErrorMessage(error) }
    );
  }
}
