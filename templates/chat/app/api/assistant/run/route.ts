import { NextRequest } from "next/server";
import OpenAI from "openai";

export const runtime = "edge";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  messages: Message[];
}

export async function POST(req: NextRequest) {
  const { messages }: RequestBody = await req.json();

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const openai = new OpenAI({ apiKey });

  const systemPrompt = `You are Brain, a helpful AI assistant. Be concise and helpful.

At the end of your response, you MUST suggest 2-3 follow-up actions the user might want to take. These should be natural continuations of the conversation.`;

  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      let fullContent = "";
      let finalSent = false;

      /**
       * Send exactly one final event, then close.
       * This is idempotent - calling multiple times has no effect after the first.
       */
      function sendFinal(content: string, error?: string) {
        if (finalSent) return;
        finalSent = true;

        const nextActions = error
          ? ["Try again", "Rephrase your question"]
          : generateNextActions(content);

        const finalEvent = JSON.stringify({
          type: "final",
          payload: {
            agent: "Brain",
            content: error || content,
            next_actions: nextActions,
          },
        });
        controller.enqueue(encoder.encode(`data: ${finalEvent}\n\n`));
        controller.close();
      }

      try {
        const stream = await openai.chat.completions.create({
          model,
          messages: openaiMessages,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            const event = JSON.stringify({ type: "delta", content: delta });
            controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          }
        }

        // Stream complete - send final
        sendFinal(fullContent);
      } catch (err) {
        // On error, still send a final event so client knows stream ended
        const errorMessage =
          err instanceof Error ? err.message : "An error occurred";
        console.error("Stream error:", err);
        
        // If we have partial content, include it
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

function generateNextActions(content: string): string[] {
  const actions: string[] = [];
  const lowerContent = content.toLowerCase();

  if (
    lowerContent.includes("code") ||
    lowerContent.includes("function") ||
    lowerContent.includes("programming")
  ) {
    actions.push("Can you explain this code in more detail?");
    actions.push("Show me an example implementation");
  }

  if (
    lowerContent.includes("step") ||
    lowerContent.includes("process") ||
    lowerContent.includes("how to")
  ) {
    actions.push("What are common mistakes to avoid?");
    actions.push("Can you provide more examples?");
  }

  if (
    lowerContent.includes("error") ||
    lowerContent.includes("issue") ||
    lowerContent.includes("problem")
  ) {
    actions.push("How can I debug this further?");
    actions.push("What are alternative solutions?");
  }

  if (actions.length === 0) {
    actions.push("Tell me more about this topic");
    actions.push("Can you give me a practical example?");
    actions.push("What should I learn next?");
  }

  return actions.slice(0, 3);
}
