import type { HubEvent, ChatMessage } from "./types";

export type { HubEvent };

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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on SSE boundary
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // Handle data: prefix
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr) as HubEvent;
            onEvent(event);
          } catch {
            // Skip malformed JSON
            console.warn("Failed to parse SSE event:", jsonStr);
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const jsonStr = trimmed.slice(6);
        try {
          const event = JSON.parse(jsonStr) as HubEvent;
          onEvent(event);
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
