/**
 * Tool Audit Logger
 *
 * Logs tool execution events to ai_tool_logs table.
 * Phase 4: Tool Executor + Audit Logging
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ToolContext, ToolResponse } from "@/lib/tools/types";

/**
 * Log entry ID returned by logStart
 */
export interface LogEntry {
  id: string;
  startedAt: number;
}

/**
 * Log a tool execution start event.
 * Returns the log entry ID for subsequent updates.
 */
export async function logToolStart(
  toolName: string,
  args: unknown,
  ctx: ToolContext
): Promise<LogEntry> {
  const supabase = getServiceSupabase();
  const startedAt = Date.now();

  const { data, error } = await supabase
    .from("ai_tool_logs")
    .insert({
      org_id: ctx.org_id,
      session_id: ctx.session_id || null,
      user_id: ctx.user_id || null,
      tool_name: toolName,
      status: "started",
      args: args ?? {},
      metadata: ctx.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) {
    // Log but don't fail the tool execution
    console.error("[audit] Failed to log tool start:", error.message);
    // Return a fake ID so execution can continue
    return { id: "log-failed", startedAt };
  }

  return { id: data.id, startedAt };
}

/**
 * Log a tool execution success event.
 * Updates the existing log entry with result and duration.
 */
export async function logToolSuccess(
  logEntry: LogEntry,
  response: ToolResponse
): Promise<void> {
  if (logEntry.id === "log-failed") {
    return; // Skip if initial log failed
  }

  const supabase = getServiceSupabase();
  const finishedAt = Date.now();
  const durationMs = finishedAt - logEntry.startedAt;

  const { error } = await supabase
    .from("ai_tool_logs")
    .update({
      status: "success",
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: durationMs,
      result: sanitizeResult(response.data),
      explainability: response.explainability ?? {},
    })
    .eq("id", logEntry.id);

  if (error) {
    console.error("[audit] Failed to log tool success:", error.message);
  }
}

/**
 * Log a tool execution error event.
 * Updates the existing log entry with error details.
 */
export async function logToolError(
  logEntry: LogEntry,
  errorPayload: { code: string; message: string; details?: unknown }
): Promise<void> {
  if (logEntry.id === "log-failed") {
    return; // Skip if initial log failed
  }

  const supabase = getServiceSupabase();
  const finishedAt = Date.now();
  const durationMs = finishedAt - logEntry.startedAt;

  const { error } = await supabase
    .from("ai_tool_logs")
    .update({
      status: "error",
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: durationMs,
      error: errorPayload,
    })
    .eq("id", logEntry.id);

  if (error) {
    console.error("[audit] Failed to log tool error:", error.message);
  }
}

/**
 * Sanitize result for storage.
 * Truncates large strings, removes sensitive fields, etc.
 */
function sanitizeResult(data: unknown): unknown {
  if (data === null || data === undefined) {
    return {};
  }

  if (typeof data !== "object") {
    return { value: data };
  }

  // For arrays, limit size
  if (Array.isArray(data)) {
    const MAX_ARRAY_SIZE = 50;
    const truncated = data.slice(0, MAX_ARRAY_SIZE);
    return {
      items: truncated,
      truncated: data.length > MAX_ARRAY_SIZE,
      total: data.length,
    };
  }

  // For objects, shallow copy and truncate large strings
  const result: Record<string, unknown> = {};
  const MAX_STRING_LENGTH = 1000;

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      result[key] = value.slice(0, MAX_STRING_LENGTH) + "...[truncated]";
    } else {
      result[key] = value;
    }
  }

  return result;
}
