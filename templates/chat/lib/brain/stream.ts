import type { HubEvent, ChatMessage } from "./types";

export type { HubEvent };

/**
 * Parses an SSE stream from the server.
 * 
 * Handles:
 * - Chunk boundaries (data split across reads)
 * - Multiple events in a single chunk
 * - Empty lines between events
 * - Multi-line data fields (concatenated)
 */
export async function runAssistant(
  messages: ChatMessage[],
  onEvent: (event: HubEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch("/api/assistant/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to run assistant: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalReceived = false;

  /**
   * Process a complete SSE event block.
   * An event block may contain multiple "data:" lines which should be concatenated.
   */
  function processEventBlock(block: string): void {
    if (finalReceived) return; // Ignore anything after final

    const lines = block.split("\n");
    const dataLines: string[] = [];

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line || line.startsWith(":")) continue;

      // Collect data lines
      if (line.startsWith("data:")) {
        // Handle both "data: value" and "data:value"
        const value = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
        dataLines.push(value);
      }
      // Ignore other field types (event:, id:, retry:) for now
    }

    if (dataLines.length === 0) return;

    // Concatenate all data lines (SSE spec: join with newlines)
    const jsonStr = dataLines.join("\n");

    try {
      const event = JSON.parse(jsonStr) as HubEvent;
      
      if (event.type === "final") {
        finalReceived = true;
      }
      
      onEvent(event);
    } catch (e) {
      // Log but don't throw - malformed events shouldn't crash the stream
      console.warn("Failed to parse SSE event:", jsonStr, e);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Append new chunk to buffer
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      // Split and keep incomplete event in buffer
      const events = buffer.split("\n\n");
      
      // Last element is either empty or incomplete - keep in buffer
      buffer = events.pop() || "";

      // Process complete events
      for (const eventBlock of events) {
        if (eventBlock.trim()) {
          processEventBlock(eventBlock);
        }
      }
    }

    // Flush decoder (handle any remaining bytes)
    buffer += decoder.decode();

    // Process any remaining complete event in buffer
    if (buffer.trim()) {
      // One final split in case buffer has complete events
      const remaining = buffer.split("\n\n");
      for (const eventBlock of remaining) {
        if (eventBlock.trim()) {
          processEventBlock(eventBlock);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
