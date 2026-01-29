/**
 * Tool Executor
 *
 * Central execution layer for all tools.
 * Handles validation, permission checks, and audit logging.
 *
 * Phase 4: Tool Executor + Audit Logging
 */

import { getTool } from "./registry";
import type { ToolContext, ToolExecutionResult, ToolResponse } from "./types";
import { logToolStart, logToolSuccess, logToolError } from "@/lib/audit/logToolEvent";

/**
 * Execute a tool by name with the given args and context.
 *
 * @param toolName - The registered tool name (e.g., "brain.upsert_item")
 * @param args - The raw input args (will be validated by the tool)
 * @param ctx - The execution context (org_id, allowWrites, etc.)
 * @returns Success with response data, or error with details
 */
export async function executeTool(
  toolName: string,
  args: unknown,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  // 1. Look up tool in registry
  const tool = getTool(toolName);
  if (!tool) {
    return {
      ok: false,
      tool: toolName,
      error: {
        code: "TOOL_NOT_FOUND",
        message: `Tool "${toolName}" is not registered`,
      },
    };
  }

  // 2. Check write permissions
  if (tool.writes && !ctx.allowWrites) {
    return {
      ok: false,
      tool: toolName,
      error: {
        code: "WRITE_NOT_ALLOWED",
        message: `Tool "${toolName}" requires write permission but allowWrites is false`,
      },
    };
  }

  // 3. Validate args
  let validatedArgs: unknown;
  try {
    validatedArgs = tool.validateArgs(args);
  } catch (err) {
    return {
      ok: false,
      tool: toolName,
      error: {
        code: "VALIDATION_ERROR",
        message: err instanceof Error ? err.message : "Validation failed",
        details: args,
      },
    };
  }

  // 4. Log start event
  const logEntry = await logToolStart(toolName, validatedArgs, ctx);

  // 5. Execute tool
  let response: ToolResponse;
  try {
    response = await tool.run(validatedArgs, ctx);
  } catch (err) {
    // Log error
    const errorPayload = {
      code: "EXECUTION_ERROR",
      message: err instanceof Error ? err.message : "Tool execution failed",
      details: err instanceof Error ? err.stack : undefined,
    };
    await logToolError(logEntry, errorPayload);

    return {
      ok: false,
      tool: toolName,
      error: errorPayload,
    };
  }

  // 6. Log success
  await logToolSuccess(logEntry, response);

  return {
    ok: true,
    tool: toolName,
    response,
  };
}
