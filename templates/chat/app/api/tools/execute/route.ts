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
  // 1. Verify internal secret
  const secret = req.headers.get("X-Internal-Secret");
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: ExecuteToolRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 3. Validate required fields
  if (!body.toolName || typeof body.toolName !== "string") {
    return NextResponse.json(
      { error: "toolName is required and must be a string" },
      { status: 400 }
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
    return NextResponse.json(
      { error: "org_id is required (either in context or via DEFAULT_ORG_ID env)" },
      { status: 400 }
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
    // Determine status code based on error code
    let status = 500;
    switch (result.error.code) {
      case "TOOL_NOT_FOUND":
        status = 404;
        break;
      case "WRITE_NOT_ALLOWED":
        status = 403;
        break;
      case "VALIDATION_ERROR":
        status = 400;
        break;
      case "EXECUTION_ERROR":
        status = 500;
        break;
    }

    return NextResponse.json(
      {
        ok: false,
        tool: result.tool,
        error: result.error,
      },
      { status }
    );
  }
}
