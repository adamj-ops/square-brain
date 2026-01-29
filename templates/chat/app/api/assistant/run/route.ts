/**
 * POST /api/assistant/run
 *
 * Streaming chat endpoint with tool-calling support.
 * Emits SSE events: delta, tool_start, tool_result, final
 *
 * Phase 4.5: Tool calling integration
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
 */
const SYSTEM_PROMPT = `You are Brain, an intelligent assistant for LifeRX that helps users manage their knowledge base.

## Brain Operating Rules

1. **Prefer tools when they increase correctness**
   - Use brain.search_items BEFORE claiming something is already stored
   - Use brain.search_items to find relevant context before answering knowledge questions

2. **Only persist when explicitly requested**
   - Use brain.upsert_item ONLY when the user explicitly asks to save, store, persist, remember, or create an item
   - Never auto-save without user intent

3. **Tool usage**
   - When searching, be specific with your query terms
   - When saving, choose the appropriate type (decision, sop, principle, playbook)
   - Provide clear, descriptive titles and comprehensive content

4. **Response format**
   - Be concise and helpful
   - If tool results are empty, acknowledge it clearly
   - Always provide actionable next steps at the end of your response

Remember: You have access to a persistent knowledge base. Use it to provide accurate, grounded responses.`;

/**
 * OpenAI tool definitions for brain tools
 */
const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "brain.search_items",
      description:
        "Search the brain knowledge base for stored items (decisions, SOPs, principles, playbooks). " +
        "Use this to find existing knowledge before answering questions or to verify if something is already stored.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for in titles and content",
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
  // Parse request
  let body: AssistantRunRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, context } = body;

  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "messages array is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build tool context
  const toolCtx: ToolContext = {
    org_id: context?.org_id || DEFAULT_ORG_ID,
    session_id: context?.session_id || crypto.randomUUID(),
    user_id: context?.user_id,
    allowWrites: context?.allowWrites ?? false,
    metadata: { source: "assistant-run" },
  };

  if (!toolCtx.org_id) {
    return new Response(
      JSON.stringify({ error: "org_id required (set DEFAULT_ORG_ID or pass in context)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

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

      /**
       * Send an SSE event to the client
       */
      function sendEvent(event: HubEvent) {
        if (finalSent && event.type !== "final") return;
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      /**
       * Send exactly one final event, then close.
       */
      function sendFinal(content: string, error?: string) {
        if (finalSent) return;
        finalSent = true;

        const payload: FinalPayload = {
          agent: "Brain",
          content: error || content,
          next_actions: error
            ? ["Try again", "Rephrase your question"]
            : generateNextActions(content, messages),
        };

        sendEvent({ type: "final", payload });
        controller.close();
      }

      /**
       * Sanitize tool result for client (truncate large data)
       * Bug 1 fix: Always returns consistent types - arrays stay arrays.
       */
      function sanitizeForClient(data: unknown): unknown {
        if (data === null || data === undefined) return null;

        if (typeof data === "string") {
          return data.length > 500 ? data.slice(0, 500) + "...[truncated]" : data;
        }

        if (Array.isArray(data)) {
          // Always return an array, just truncated - consistent type
          const maxItems = 10;
          return data.slice(0, maxItems).map((item) => sanitizeForClient(item));
        }

        if (typeof data === "object") {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            if (typeof value === "string" && value.length > 300) {
              result[key] = value.slice(0, 300) + "...[truncated]";
            } else if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
              result[key] = sanitizeForClient(value);
            } else {
              result[key] = value;
            }
          }
          return result;
        }

        return data;
      }

      /**
       * Execute a tool call and return the result for the model
       */
      async function handleToolCall(
        toolCall: FunctionToolCall
      ): Promise<{ toolMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam; clientData: unknown; explainability: unknown; isError: boolean }> {
        const toolName = toolCall.function.name;
        let args: unknown;

        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          return {
            toolMessage: {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: "Invalid tool arguments JSON" }),
            },
            clientData: null,
            explainability: { error: "Invalid arguments" },
            isError: true,
          };
        }

        // Check write permission
        const tool = getTool(toolName);
        if (tool?.writes && !toolCtx.allowWrites) {
          return {
            toolMessage: {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: "Writes are disabled for this request. The user must enable writes to save items.",
              }),
            },
            clientData: null,
            explainability: { blocked: "writes_disabled" },
            isError: true,
          };
        }

        // Execute tool
        const result = await executeTool(toolName, args, toolCtx);

        if (result.ok) {
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
          return {
            toolMessage: {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: result.error.message }),
            },
            clientData: { error: result.error.message },
            explainability: { error_code: result.error.code },
            isError: true,
          };
        }
      }

      try {
        // Tool-calling loop
        let continueLoop = true;

        while (continueLoop && toolCallCount < MAX_TOOL_CALLS) {
          if (abortController.signal.aborted) {
            controller.close();
            return;
          }

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
            // Add assistant message with ONLY valid tool calls
            openaiMessages.push({
              role: "assistant",
              content: currentContent || null,
              tool_calls: validToolCalls,
            });

            // Execute each valid tool call
            for (const toolCall of validToolCalls) {
              toolCallCount++;

              // Emit tool_start (NO args!)
              sendEvent({ type: "tool_start", tool: toolCall.function.name });

              // Execute tool
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

        // Check if we hit the tool call limit
        if (toolCallCount >= MAX_TOOL_CALLS && !finalSent) {
          fullContent +=
            "\n\n*Note: Maximum tool calls reached for this request.*";
        }

        // Send final
        sendFinal(fullContent);
      } catch (err) {
        // Handle abort
        if (abortController.signal.aborted) {
          controller.close();
          return;
        }

        const errorMessage = err instanceof Error ? err.message : "An error occurred";
        console.error("Assistant stream error:", err);

        if (fullContent) {
          sendFinal(fullContent + "\n\n[Stream interrupted]");
        } else {
          sendFinal("", `Error: ${errorMessage}`);
        }
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
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
