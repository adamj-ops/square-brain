/**
 * Server-Sent Event types for the assistant stream.
 * 
 * Contract:
 * - Server emits 0+ `delta` events with incremental content
 * - Server emits exactly 1 `final` event to close the stream
 * - Client MUST read all data from `final.payload.*`
 */

/** Incremental content chunk */
export interface DeltaEvent {
  type: "delta";
  content: string;
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
  /** Suggested follow-up actions (always non-empty) */
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
export type HubEvent = DeltaEvent | FinalEvent;

/** Message format for API requests */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
