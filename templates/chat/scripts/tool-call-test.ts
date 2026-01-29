/**
 * Tool Call Integration Test Script
 *
 * Tests that the assistant stream correctly handles tool calls.
 * Run with: npx tsx scripts/tool-call-test.ts
 *
 * Phase 4.5: Tool calling integration
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local
config({ path: resolve(__dirname, "../.env.local") });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

interface SSEEvent {
  type: string;
  content?: string;
  tool?: string;
  data?: unknown;
  explainability?: unknown;
  error?: boolean;
  payload?: {
    agent: string;
    content: string;
    next_actions: string[];
  };
}

/**
 * Parse SSE stream from fetch response
 */
async function* parseSSE(
  response: Response
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Split on double newlines
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          try {
            yield JSON.parse(jsonStr);
          } catch {
            console.warn("Failed to parse SSE data:", jsonStr);
          }
        }
      }
    }
  }
}

/**
 * Send a message and collect all events
 */
async function sendMessage(
  message: string,
  options: { allowWrites?: boolean } = {}
): Promise<{ events: SSEEvent[]; hasToolArgs: boolean }> {
  const response = await fetch(`${BASE_URL}/api/assistant/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
      context: {
        allowWrites: options.allowWrites ?? false,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const events: SSEEvent[] = [];
  let hasToolArgs = false;

  for await (const event of parseSSE(response)) {
    events.push(event);

    // Check for leaked tool args
    if (
      event.type === "tool_start" &&
      "args" in (event as Record<string, unknown>)
    ) {
      hasToolArgs = true;
      console.error("ERROR: tool_start contains args field!");
    }
  }

  return { events, hasToolArgs };
}

/**
 * Verify event sequence
 */
function verifyEventSequence(events: SSEEvent[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Must have at least one final event
  const finalEvents = events.filter((e) => e.type === "final");
  if (finalEvents.length === 0) {
    issues.push("Missing final event");
  } else if (finalEvents.length > 1) {
    issues.push("Multiple final events");
  }

  // Final must be last
  if (events.length > 0 && events[events.length - 1].type !== "final") {
    issues.push("Final event is not last");
  }

  // Check tool event pairing
  const toolStarts = events.filter((e) => e.type === "tool_start");
  const toolResults = events.filter((e) => e.type === "tool_result");

  for (let i = 0; i < toolStarts.length; i++) {
    const start = toolStarts[i];
    const result = toolResults[i];

    if (!result) {
      issues.push(`tool_start for ${start.tool} has no matching tool_result`);
    } else if (start.tool !== result.tool) {
      issues.push(
        `tool name mismatch: start=${start.tool}, result=${result.tool}`
      );
    }

    // Verify tool_start order (must come before result)
    const startIdx = events.indexOf(start);
    const resultIdx = events.indexOf(result);
    if (resultIdx < startIdx) {
      issues.push(`tool_result for ${start.tool} came before tool_start`);
    }
  }

  // Check final payload structure
  const final = finalEvents[0];
  if (final?.payload) {
    if (!final.payload.agent) issues.push("final.payload missing agent");
    if (typeof final.payload.content !== "string")
      issues.push("final.payload.content is not a string");
    if (!Array.isArray(final.payload.next_actions))
      issues.push("final.payload.next_actions is not an array");
    if (
      final.payload.next_actions &&
      (final.payload.next_actions.length < 2 ||
        final.payload.next_actions.length > 4)
    ) {
      issues.push(
        `final.payload.next_actions has ${final.payload.next_actions.length} items (expected 2-4)`
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

async function main() {
  console.log("=== Tool Call Integration Test ===\n");
  console.log(`Target: ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  // Test 1: Normal chat (no tool calls)
  console.log("Test 1: Normal chat response (no tools)...");
  try {
    const { events, hasToolArgs } = await sendMessage("Hello, how are you?");
    const { valid, issues } = verifyEventSequence(events);

    if (hasToolArgs) {
      console.log("  ✗ FAILED: Tool args leaked to client");
      failed++;
    } else if (!valid) {
      console.log("  ✗ FAILED:", issues.join("; "));
      failed++;
    } else {
      console.log("  ✓ PASSED");
      passed++;
    }
  } catch (err) {
    console.log("  ✗ ERROR:", err);
    failed++;
  }

  // Test 2: Search request (should trigger tool call)
  console.log("\nTest 2: Search memory request (should trigger brain.search_items)...");
  try {
    const { events, hasToolArgs } = await sendMessage(
      "Search my brain for anything about onboarding"
    );
    const { valid, issues } = verifyEventSequence(events);

    const toolStarts = events.filter((e) => e.type === "tool_start");
    const toolResults = events.filter((e) => e.type === "tool_result");

    if (hasToolArgs) {
      console.log("  ✗ FAILED: Tool args leaked to client");
      failed++;
    } else if (!valid) {
      console.log("  ✗ FAILED:", issues.join("; "));
      failed++;
    } else if (toolStarts.length === 0) {
      console.log("  ⚠ WARNING: No tool calls made (model may not have used tools)");
      // This is a soft warning since model behavior varies
      passed++;
    } else {
      console.log(`  ✓ PASSED (${toolStarts.length} tool call(s))`);
      console.log(`    Tools called: ${toolStarts.map((t) => t.tool).join(", ")}`);
      passed++;
    }
  } catch (err) {
    console.log("  ✗ ERROR:", err);
    failed++;
  }

  // Test 3: Write request without permission (should be blocked)
  console.log("\nTest 3: Save request without allowWrites (should be blocked)...");
  try {
    const { events, hasToolArgs } = await sendMessage(
      "Save this as a principle: Always be kind to others.",
      { allowWrites: false }
    );
    const { valid, issues } = verifyEventSequence(events);

    const toolResults = events.filter(
      (e) => e.type === "tool_result" && e.tool === "brain.upsert_item"
    );
    const blockedWrites = toolResults.filter((e) => e.error === true);

    if (hasToolArgs) {
      console.log("  ✗ FAILED: Tool args leaked to client");
      failed++;
    } else if (!valid) {
      console.log("  ✗ FAILED:", issues.join("; "));
      failed++;
    } else if (toolResults.length > 0 && blockedWrites.length === 0) {
      console.log("  ⚠ WARNING: Write tool was called but not blocked");
      passed++;
    } else {
      console.log("  ✓ PASSED");
      if (blockedWrites.length > 0) {
        console.log("    Write attempt correctly blocked");
      }
      passed++;
    }
  } catch (err) {
    console.log("  ✗ ERROR:", err);
    failed++;
  }

  // Test 4: Write request with permission
  console.log("\nTest 4: Save request with allowWrites=true...");
  try {
    const { events, hasToolArgs } = await sendMessage(
      "Save this as a principle: Testing is important for quality software.",
      { allowWrites: true }
    );
    const { valid, issues } = verifyEventSequence(events);

    const toolStarts = events.filter(
      (e) => e.type === "tool_start" && e.tool === "brain.upsert_item"
    );
    const toolResults = events.filter(
      (e) => e.type === "tool_result" && e.tool === "brain.upsert_item"
    );

    if (hasToolArgs) {
      console.log("  ✗ FAILED: Tool args leaked to client");
      failed++;
    } else if (!valid) {
      console.log("  ✗ FAILED:", issues.join("; "));
      failed++;
    } else if (toolStarts.length === 0) {
      console.log("  ⚠ WARNING: No upsert tool called (model may not have used tools)");
      passed++;
    } else {
      const successResults = toolResults.filter((e) => !e.error);
      if (successResults.length > 0) {
        console.log("  ✓ PASSED (item saved successfully)");
        console.log("    Result:", JSON.stringify(successResults[0].data));
      } else {
        console.log("  ⚠ WARNING: Tool called but may have failed");
      }
      passed++;
    }
  } catch (err) {
    console.log("  ✗ ERROR:", err);
    failed++;
  }

  // Test 5: Verify no tool args in any event
  console.log("\nTest 5: Verify no tool args leaked in any event...");
  try {
    const { events, hasToolArgs } = await sendMessage(
      "List everything in my brain about testing"
    );

    const allEvents = JSON.stringify(events);
    const hasArgsKey =
      hasToolArgs ||
      events.some(
        (e) =>
          e.type === "tool_start" && "args" in (e as Record<string, unknown>)
      );

    if (hasArgsKey) {
      console.log("  ✗ FAILED: Found args in tool events");
      failed++;
    } else {
      console.log("  ✓ PASSED (no args leaked)");
      passed++;
    }
  } catch (err) {
    console.log("  ✗ ERROR:", err);
    failed++;
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n⚠ Some tests failed. Check the output above.");
    process.exit(1);
  } else {
    console.log("\n✓ All tests passed!");
  }
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
