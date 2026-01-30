/**
 * POST /api/assistant/run
 *
 * Streaming chat endpoint with tool-calling support.
 * Emits SSE events: delta, tool_start, tool_result, final
 *
 * Phase 5: Hardening + Observability
 */

import type { NextRequest } from "next/server";
import OpenAI from "openai";
import type {
  HubEvent,
  AssistantRunRequest,
  FinalPayload,
} from "@/lib/brain/types";
import type { ToolContext } from "@/lib/tools/types";
import { executeTool } from "@/lib/tools/executeTool";
import { getTool } from "@/lib/tools/registry";

export const runtime = "edge";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "";
const MAX_TOOL_CALLS = 5;

/**
 * Sensitive fields to strip from tool results before sending to client.
 * Add field names that should never be exposed in the UI.
 */
const SENSITIVE_FIELDS = new Set([
  "password",
  "secret",
  "token",
  "api_key",
  "apiKey",
  "private_key",
  "privateKey",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "authorization",
  "credential",
  "ssn",
  "social_security",
  "credit_card",
  "creditCard",
  "card_number",
  "cardNumber",
  "cvv",
  "pin",
]);

/**
 * Function tool call type - specific subset of OpenAI's union type.
 * We only create/handle function-type tool calls, not custom tool calls.
 */
interface FunctionToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * System prompt with Brain Operating Rules
 * Phase 5.2: Updated for internal docs preference
 */
const SYSTEM_PROMPT = `You are Brain, an intelligent assistant for LifeRX that helps users manage their knowledge base.

## Brain Operating Rules

1. **ALWAYS search before claiming something doesn't exist**
   - Use brain.semantic_search FIRST for any knowledge question - it finds information by meaning, not just keywords
   - Use brain.search_items as a backup for exact matches or filtering by type/tag
   - NEVER say "I don't have information about X" without searching first

2. **Search strategy**
   - brain.semantic_search: Use for questions, concepts, "how does X work", finding related info
   - brain.search_items: Use for exact titles, filtering by type (decision/sop/principle/playbook), or tag-based queries
   - When semantic search returns results, use them to ground your response

3. **For system behavior questions, prefer internal_docs**
   - Questions about how Brain works, confidence scoring, item types, search behavior, or tools should be answered from internal_docs (source_type = "internal_docs")
   - Internal docs have high confidence (0.9) and are authoritative
   - When citing internal docs, reference the document title
   - Examples: "how does confidence work?", "what item types exist?", "how does search work?"

4. **Only persist when explicitly requested**
   - Use brain.upsert_item ONLY when the user explicitly asks to save, store, persist, remember, or create an item
   - Never auto-save without user intent

5. **Response format**
   - Be concise and helpful
   - When citing retrieved information, mention the source title
   - If search results are empty, acknowledge it and suggest alternatives
   - Always provide actionable next steps

Remember: You have access to a persistent, searchable knowledge base with semantic understanding. Use it to provide accurate, grounded responses.`;

/**
 * OpenAI tool definitions for brain tools
 * Phase 5.1: Added semantic search
 */
const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "brain.semantic_search",
      description:
        "Search the brain knowledge base using semantic similarity (by meaning, not just keywords). " +
        "ALWAYS use this first before claiming information doesn't exist. " +
        "Returns relevant chunks of content ranked by relevance to your query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query (question or keywords)",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default 5, max 20)",
          },
          threshold: {
            type: "number",
            description: "Minimum similarity threshold 0-1 (default 0.65, lower = more results)",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "brain.search_items",
      description:
        "Search brain items by exact text match or filter by type/tag. " +
        "Use this for: finding items by exact title, filtering by type (decision/sop/principle/playbook), " +
        "or tag-based queries. For conceptual/meaning-based search, use brain.semantic_search instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for in titles and content (exact match)",
          },
          type: {
            type: "string",
            enum: ["decision", "sop", "principle", "playbook"],
            description: "Filter by item type",
          },
          tag: {
            type: "string",
            description: "Filter by tag (exact match)",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default 20, max 100)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "brain.upsert_item",
      description:
        "Create or update a brain item. Use ONLY when the user explicitly asks to save, store, persist, or remember something. " +
        "Types: decision (key choices), sop (standard procedures), principle (guiding beliefs), playbook (step-by-step guides).",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["decision", "sop", "principle", "playbook"],
            description: "The type of brain item",
          },
          title: {
            type: "string",
            description: "A clear, descriptive title (min 3 chars)",
          },
          content_md: {
            type: "string",
            description: "The full content in markdown format (min 20 chars)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for categorization (max 20)",
          },
          confidence_score: {
            type: "number",
            description: "Confidence level 0-1 (default 0.75)",
          },
          canonical_key: {
            type: "string",
            description:
              "Optional unique key for upsert. If provided and exists, updates the existing item.",
          },
        },
        required: ["type", "title", "content_md"],
        additionalProperties: false,
      },
    },
  },
];

export async function POST(req: NextRequest) {
  // Generate session_id for request tracing (used throughout this request)
  const sessionId = crypto.randomUUID();
  const requestStartTime = Date.now();

  // Structured logging helper
  const log = (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      level,
      message,
      elapsed_ms: Date.now() - requestStartTime,
      ...meta,
    };
    if (level === "error") {
      console.error(JSON.stringify(logEntry));
    } else if (level === "warn") {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  };

  /**
   * Create a structured error response for early validation failures
   */
  const createErrorResponse = (
    code: string,
    message: string,
    details?: unknown,
    status = 400
  ) => {
    return new Response(
      JSON.stringify({ code, message, details }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    log("info", "Request started", { path: "/api/assistant/run" });

    // Parse request
    let body: AssistantRunRequest;
    try {
      body = await req.json();
    } catch {
      log("warn", "Invalid JSON body");
      return createErrorResponse(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "{ messages, context? }" }
      );
    }

    const { messages, context } = body;

    if (!messages || !Array.isArray(messages)) {
      log("warn", "Missing messages array");
      return createErrorResponse(
        "VALIDATION_ERROR",
        "messages array is required",
        { field: "messages" }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o";

    if (!apiKey) {
      log("error", "OPENAI_API_KEY not configured");
      return createErrorResponse(
        "CONFIGURATION_ERROR",
        "OPENAI_API_KEY not configured",
        { field: "OPENAI_API_KEY" },
        500
      );
    }

    // Build tool context with session_id for tracing
    const toolCtx: ToolContext = {
      org_id: context?.org_id || DEFAULT_ORG_ID,
      session_id: sessionId, // Always use our generated session_id for consistency
      user_id: context?.user_id,
      allowWrites: context?.allowWrites ?? false,
      metadata: {
        source: "assistant-run",
        request_session_id: sessionId,
        client_session_id: context?.session_id, // Preserve client's session_id if provided
      },
    };

    if (!toolCtx.org_id) {
      log("warn", "Missing org_id");
      return createErrorResponse(
        "VALIDATION_ERROR",
        "org_id required (set DEFAULT_ORG_ID or pass in context)",
        { field: "org_id" }
      );
    }

  log("info", "Request validated", {
    org_id: toolCtx.org_id,
    message_count: messages.length,
    allow_writes: toolCtx.allowWrites,
  });

  const openai = new OpenAI({ apiKey });
  const encoder = new TextEncoder();

  // Build initial messages
  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // AbortController for client disconnect
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  const readableStream = new ReadableStream({
    async start(controller) {
      let fullContent = "";
      let finalSent = false;
      let toolCallCount = 0;
      let eventId = 0; // SSE event ID for robustness under load
      const sentEventIds = new Set<string>(); // Dedup tracker

      /**
       * Send an SSE event to the client with deduplication.
       * Each event gets a unique ID to prevent duplicates under load.
       */
      function sendEvent(event: HubEvent) {
        if (finalSent && event.type !== "final") return;

        // Generate unique event key for dedup
        const eventKey = `${event.type}-${eventId}`;
        if (sentEventIds.has(eventKey)) {
          log("warn", "Duplicate event prevented", { event_type: event.type, event_id: eventId });
          return;
        }
        sentEventIds.add(eventKey);

        const currentEventId = eventId++;
        const data = JSON.stringify(event);
        // Include event ID in SSE format for client-side dedup if needed
        controller.enqueue(encoder.encode(`id: ${currentEventId}\ndata: ${data}\n\n`));
      }

      /**
       * Send exactly one final event, then close.
       * Invariant: Exactly 1 final event per request, no matter what.
       */
      function sendFinal(content: string, error?: string) {
        if (finalSent) {
          log("warn", "Attempted duplicate final event", { had_error: !!error });
          return;
        }
        finalSent = true;

        const payload: FinalPayload = {
          agent: "Brain",
          content: error || content,
          next_actions: error
            ? ["Try again", "Rephrase your question"]
            : generateNextActions(content, messages),
        };

        log("info", "Sending final event", {
          content_length: payload.content.length,
          had_error: !!error,
          tool_calls_made: toolCallCount,
          total_events: eventId,
        });

        sendEvent({ type: "final", payload });
        controller.close();
      }

      /**
       * Check if a field name is sensitive and should be stripped.
       */
      function isSensitiveField(key: string): boolean {
        const lowerKey = key.toLowerCase();
        return SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(lowerKey) ||
          lowerKey.includes("password") ||
          lowerKey.includes("secret") ||
          lowerKey.includes("token") ||
          lowerKey.includes("credential");
      }

      /**
       * Sanitize tool result for client:
       * - Truncate huge strings/arrays
       * - Strip sensitive fields
       * - Consistent types (arrays stay arrays)
       */
      function sanitizeForClient(data: unknown, depth = 0): unknown {
        // Prevent infinite recursion
        if (depth > 10) return "[max depth exceeded]";

        if (data === null || data === undefined) return null;

        if (typeof data === "string") {
          return data.length > 500 ? data.slice(0, 500) + "...[truncated]" : data;
        }

        if (Array.isArray(data)) {
          // Always return an array, just truncated - consistent type
          const maxItems = 10;
          const truncated = data.slice(0, maxItems).map((item) => sanitizeForClient(item, depth + 1));
          if (data.length > maxItems) {
            log("info", "Array truncated for client", { original_length: data.length, truncated_to: maxItems });
          }
          return truncated;
        }

        if (typeof data === "object") {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            // Strip sensitive fields entirely
            if (isSensitiveField(key)) {
              result[key] = "[REDACTED]";
              continue;
            }

            if (typeof value === "string" && value.length > 300) {
              result[key] = value.slice(0, 300) + "...[truncated]";
            } else if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
              result[key] = sanitizeForClient(value, depth + 1);
            } else {
              result[key] = value;
            }
          }
          return result;
        }

        return data;
      }

      /**
       * Execute a tool call and return the result for the model.
       * Errors are handled gracefully - they become tool results that the model
       * can reason about, rather than crashing the entire request.
       */
      async function handleToolCall(
        toolCall: FunctionToolCall
      ): Promise<{ toolMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam; clientData: unknown; explainability: unknown; isError: boolean }> {
        const toolName = toolCall.function.name;
        const toolStartTime = Date.now();
        let args: unknown;

        log("info", "Tool call started", {
          tool: toolName,
          tool_call_id: toolCall.id,
          call_number: toolCallCount,
        });

        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (parseErr) {
          log("warn", "Tool arguments parse failed", {
            tool: toolName,
            tool_call_id: toolCall.id,
            error: parseErr instanceof Error ? parseErr.message : "Unknown parse error",
          });
          // Return graceful error - model can recover
          return {
            toolMessage: {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: "Invalid tool arguments JSON. Please check the argument format and try again.",
              }),
            },
            clientData: { error: "Invalid tool arguments" },
            explainability: { error: "parse_error", recoverable: true },
            isError: true,
          };
        }

        // Check write permission
        const tool = getTool(toolName);
        if (tool?.writes && !toolCtx.allowWrites) {
          log("info", "Tool blocked - writes disabled", {
            tool: toolName,
            tool_call_id: toolCall.id,
          });
          // Graceful error - model can explain to user
          return {
            toolMessage: {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: "Writes are disabled for this session. Please ask the user to enable writes if they want to save or modify data.",
                suggestion: "Inform the user that write operations require explicit permission.",
              }),
            },
            clientData: { error: "Writes disabled" },
            explainability: { blocked: "writes_disabled", recoverable: true },
            isError: true,
          };
        }

        // Execute tool with error boundary
        try {
          const result = await executeTool(toolName, args, toolCtx);
          const toolDuration = Date.now() - toolStartTime;

          if (result.ok) {
            log("info", "Tool call succeeded", {
              tool: toolName,
              tool_call_id: toolCall.id,
              duration_ms: toolDuration,
              result_type: Array.isArray(result.response.data) ? "array" : typeof result.response.data,
            });
            return {
              toolMessage: {
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.response.data),
              },
              clientData: sanitizeForClient(result.response.data),
              explainability: result.response.explainability,
              isError: false,
            };
          } else {
            log("warn", "Tool call returned error", {
              tool: toolName,
              tool_call_id: toolCall.id,
              duration_ms: toolDuration,
              error_code: result.error.code,
              error_message: result.error.message,
            });
            // Graceful error - return as tool result, not exception
            return {
              toolMessage: {
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  success: false,
                  error: result.error.message,
                  code: result.error.code,
                }),
              },
              clientData: { error: result.error.message },
              explainability: { error_code: result.error.code, recoverable: true },
              isError: true,
            };
          }
        } catch (toolErr) {
          // Unexpected tool execution error - still handle gracefully
          const toolDuration = Date.now() - toolStartTime;
          const errorMessage = toolErr instanceof Error ? toolErr.message : "Unknown tool error";

          log("error", "Tool call threw exception", {
            tool: toolName,
            tool_call_id: toolCall.id,
            duration_ms: toolDuration,
            error: errorMessage,
          });

          // Return graceful error so model can continue
          return {
            toolMessage: {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: `Tool execution failed: ${errorMessage}`,
                suggestion: "You may try a different approach or inform the user of the issue.",
              }),
            },
            clientData: { error: "Tool execution failed" },
            explainability: { error: "execution_error", recoverable: true },
            isError: true,
          };
        }
      }

      try {
        // Tool-calling loop with loop breaker
        let continueLoop = true;
        let loopIteration = 0;
        const maxLoopIterations = MAX_TOOL_CALLS + 2; // Safety margin

        while (continueLoop && toolCallCount < MAX_TOOL_CALLS && loopIteration < maxLoopIterations) {
          loopIteration++;

          if (abortController.signal.aborted) {
            log("info", "Request aborted by client");
            controller.close();
            return;
          }

          log("info", "Starting LLM call", {
            iteration: loopIteration,
            tool_calls_so_far: toolCallCount,
            message_count: openaiMessages.length,
          });

          // Make API call with streaming
          const stream = await openai.chat.completions.create(
            {
              model,
              messages: openaiMessages,
              tools: OPENAI_TOOLS,
              stream: true,
            },
            { signal: abortController.signal }
          );

          // Accumulate the response
          let currentContent = "";
          const toolCalls: FunctionToolCall[] = [];
          const toolCallArgBuffers: Map<number, string> = new Map();

          for await (const chunk of stream) {
            if (abortController.signal.aborted) {
              log("info", "Request aborted during stream");
              controller.close();
              return;
            }

            const choice = chunk.choices[0];
            if (!choice) continue;

            // Handle content deltas
            const contentDelta = choice.delta?.content;
            if (contentDelta) {
              currentContent += contentDelta;
              fullContent += contentDelta;
              sendEvent({ type: "delta", content: contentDelta });
            }

            // Handle tool call deltas
            const toolCallDeltas = choice.delta?.tool_calls;
            if (toolCallDeltas) {
              for (const tcDelta of toolCallDeltas) {
                const idx = tcDelta.index;

                // Initialize tool call if new
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: tcDelta.id || "",
                    type: "function",
                    function: {
                      name: tcDelta.function?.name || "",
                      arguments: "",
                    },
                  };
                  toolCallArgBuffers.set(idx, "");
                }

                // Update tool call ID if provided
                if (tcDelta.id) {
                  toolCalls[idx].id = tcDelta.id;
                }

                // Update function name if provided
                if (tcDelta.function?.name) {
                  toolCalls[idx].function.name = tcDelta.function.name;
                }

                // Accumulate arguments
                if (tcDelta.function?.arguments) {
                  const currentArgs = toolCallArgBuffers.get(idx) || "";
                  toolCallArgBuffers.set(idx, currentArgs + tcDelta.function.arguments);
                }
              }
            }

            // Check if done
            if (choice.finish_reason === "stop") {
              continueLoop = false;
              break;
            }

            if (choice.finish_reason === "tool_calls") {
              // Finalize tool call arguments
              for (const [idx, args] of toolCallArgBuffers) {
                if (toolCalls[idx]) {
                  toolCalls[idx].function.arguments = args;
                }
              }
              break;
            }
          }

          // Process tool calls if any
          // Bug 2 fix: Filter invalid tool calls BEFORE adding to messages
          const validToolCalls = toolCalls.filter(
            (tc) => tc.id && tc.function?.name
          );

          if (validToolCalls.length > 0) {
            log("info", "Processing tool calls", {
              count: validToolCalls.length,
              tools: validToolCalls.map((tc) => tc.function.name),
            });

            // Add assistant message with ONLY valid tool calls
            openaiMessages.push({
              role: "assistant",
              content: currentContent || null,
              tool_calls: validToolCalls,
            });

            // Execute each valid tool call
            for (const toolCall of validToolCalls) {
              toolCallCount++;

              // Check if we've hit the limit mid-batch
              if (toolCallCount > MAX_TOOL_CALLS) {
                log("warn", "Tool call limit reached mid-batch", {
                  limit: MAX_TOOL_CALLS,
                  skipped_tool: toolCall.function.name,
                });
                // Still need to add a result for OpenAI message format compliance
                openaiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    success: false,
                    error: "Tool call limit reached. Please continue without additional tool calls.",
                  }),
                });
                continue;
              }

              // Emit tool_start (NO args!)
              sendEvent({ type: "tool_start", tool: toolCall.function.name });

              // Execute tool (errors handled gracefully inside handleToolCall)
              const { toolMessage, clientData, explainability, isError } =
                await handleToolCall(toolCall);

              // Emit tool_result (sanitized data only)
              sendEvent({
                type: "tool_result",
                tool: toolCall.function.name,
                data: clientData,
                explainability,
                error: isError || undefined,
              });

              // Add tool result to messages for next iteration
              openaiMessages.push(toolMessage);
            }
          } else {
            // No tool calls, we're done
            continueLoop = false;
          }
        }

        // Loop breaker triggered
        if (loopIteration >= maxLoopIterations) {
          log("error", "Loop breaker triggered", {
            iterations: loopIteration,
            max: maxLoopIterations,
            tool_calls: toolCallCount,
          });
          fullContent += "\n\n*Note: Request processing limit reached.*";
        }

        // Check if we hit the tool call limit
        if (toolCallCount >= MAX_TOOL_CALLS && !finalSent) {
          log("info", "Tool call limit reached", { limit: MAX_TOOL_CALLS });
          fullContent +=
            "\n\n*Note: Maximum tool calls reached for this request.*";
        }

        // INVARIANT: Exactly 1 final event
        sendFinal(fullContent);
      } catch (err) {
        // Handle abort
        if (abortController.signal.aborted) {
          log("info", "Request completed via abort");
          controller.close();
          return;
        }

        const errorMessage = err instanceof Error ? err.message : "An error occurred";
        log("error", "Stream error", {
          error: errorMessage,
          stack: err instanceof Error ? err.stack : undefined,
          had_content: fullContent.length > 0,
        });

        // INVARIANT: Still send exactly 1 final, even on error
        if (fullContent) {
          sendFinal(fullContent + "\n\n[Stream interrupted]");
        } else {
          sendFinal("", `I encountered an error while processing your request. Please try again.`);
        }
      }
    },
  });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Session-Id": sessionId, // Request tracing
      },
    });
  } catch (error) {
    // Outer catch for unexpected errors during setup
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[assistant/run] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        details: { originalError: errorMessage },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Generate next actions based on content and conversation
 */
function generateNextActions(
  content: string,
  messages: { role: string; content: string }[]
): string[] {
  const actions: string[] = [];
  const lowerContent = content.toLowerCase();
  const lastUserMessage = messages
    .filter((m) => m.role === "user")
    .pop()?.content.toLowerCase() || "";

  // Check for search-related responses
  if (
    lowerContent.includes("found") ||
    lowerContent.includes("search") ||
    lowerContent.includes("result")
  ) {
    actions.push("Search for something else");
    actions.push("Save this information to my brain");
  }

  // Check for save/persist responses
  if (
    lowerContent.includes("saved") ||
    lowerContent.includes("stored") ||
    lowerContent.includes("created")
  ) {
    actions.push("View saved items");
    actions.push("Save another item");
  }

  // Check for no results
  if (
    lowerContent.includes("no results") ||
    lowerContent.includes("nothing found") ||
    lowerContent.includes("couldn't find")
  ) {
    actions.push("Try a different search term");
    actions.push("Save this as new information");
  }

  // Check user intent from last message
  if (lastUserMessage.includes("save") || lastUserMessage.includes("store")) {
    actions.push("Confirm the item was saved correctly");
    actions.push("Add more details to this item");
  }

  if (lastUserMessage.includes("search") || lastUserMessage.includes("find")) {
    actions.push("Refine the search");
    actions.push("Search in a different category");
  }

  // Default actions
  if (actions.length === 0) {
    actions.push("Search my brain for related topics");
    actions.push("Save this as a new item");
    actions.push("Ask a follow-up question");
  }

  // Always include a general action
  if (!actions.some((a) => a.toLowerCase().includes("question"))) {
    actions.push("Ask me anything else");
  }

  // Return 2-4 unique actions
  const unique = [...new Set(actions)];
  return unique.slice(0, 4);
}
