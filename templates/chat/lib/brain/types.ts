/**
 * Server-Sent Event types for the assistant stream.
 *
 * Contract:
 * - Server emits 0+ `delta` events with incremental content
 * - Server may emit `tool_start` followed by `tool_result` for tool calls
 * - Server emits exactly 1 `final` event to close the stream
 * - Client MUST read all data from `final.payload.*`
 *
 * Phase 4.5: Tool calling support added
 */

/** Incremental content chunk */
export interface DeltaEvent {
  type: "delta";
  content: string;
}

/**
 * Tool execution started event.
 * IMPORTANT: No args field - tool args are NEVER sent to client.
 */
export interface ToolStartEvent {
  type: "tool_start";
  tool: string;
}

/**
 * Tool execution result event.
 * Contains sanitized data and explainability (no raw args).
 */
export interface ToolResultEvent {
  type: "tool_result";
  tool: string;
  /** Sanitized result data (truncated for large payloads) */
  data?: unknown;
  /** Explainability metadata */
  explainability?: unknown;
  /** True if the tool call failed */
  error?: boolean;
}

/**
 * Final response payload - canonical structure.
 * All response data MUST be read from this payload.
 */
export interface FinalPayload {
  /** Agent that generated this response */
  agent: string;
  /** Complete response content */
  content: string;
  /** Suggested follow-up actions (always non-empty, 2-4 items) */
  next_actions: string[];
  /** Assumptions made during response generation (optional) */
  assumptions?: string[];
}

/** Terminal event signaling stream completion */
export interface FinalEvent {
  type: "final";
  payload: FinalPayload;
}

/** Union of all possible SSE events */
export type HubEvent =
  | DeltaEvent
  | ToolStartEvent
  | ToolResultEvent
  | FinalEvent;

/** Message format for API requests */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Request context for assistant run
 */
export interface AssistantRunContext {
  org_id?: string;
  session_id?: string;
  user_id?: string;
  allowWrites?: boolean;
}

/**
 * Request body for POST /api/assistant/run
 */
export interface AssistantRunRequest {
  messages: ChatMessage[];
  context?: AssistantRunContext;
}
