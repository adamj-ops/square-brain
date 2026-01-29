/**
 * Tool Types
 *
 * Core type definitions for the tool execution layer.
 * Phase 4: Tool Executor + Audit Logging
 */

/**
 * Context passed to every tool execution.
 * Contains org/session/user info and permission flags.
 */
export interface ToolContext {
  org_id: string;
  session_id?: string;
  user_id?: string;
  /** If false, tools with writes=true will be rejected */
  allowWrites: boolean;
  /** Optional metadata for logging/debugging */
  metadata?: Record<string, unknown>;
}

/**
 * Response returned by tool execution.
 * Contains data and optional explainability info.
 */
export interface ToolResponse<T = unknown> {
  data: T;
  /** Explainability metadata for auditing */
  explainability?: Record<string, unknown>;
}

/**
 * Tool definition interface.
 * Each tool must implement this interface.
 */
export interface ToolDefinition<Args = unknown, Result = unknown> {
  /** Unique tool name (e.g., "brain.upsert_item") */
  name: string;
  /** Human-readable description */
  description: string;
  /** True if this tool performs writes/mutations */
  writes: boolean;
  /**
   * Validates and parses input args.
   * Should throw an error with descriptive message if invalid.
   */
  validateArgs: (args: unknown) => Args;
  /**
   * Executes the tool with validated args and context.
   * Returns data and optional explainability info.
   */
  run: (args: Args, ctx: ToolContext) => Promise<ToolResponse<Result>>;
}

/**
 * Tool execution result - success case
 */
export interface ToolExecutionSuccess<T = unknown> {
  ok: true;
  tool: string;
  response: ToolResponse<T>;
}

/**
 * Tool execution result - error case
 */
export interface ToolExecutionError {
  ok: false;
  tool: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Tool execution result union type
 */
export type ToolExecutionResult<T = unknown> =
  | ToolExecutionSuccess<T>
  | ToolExecutionError;
