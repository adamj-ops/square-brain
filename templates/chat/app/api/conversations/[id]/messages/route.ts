import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/client";
import { createApiError, getErrorMessage } from "@/lib/api/errors";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/conversations/[id]/messages
 * List all messages for a conversation
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      return createApiError(
        "INTERNAL_ERROR",
        "Failed to fetch messages",
        { dbError: error.message, conversationId: id }
      );
    }

    return NextResponse.json({ messages: data });
  } catch (error) {
    console.error("[messages] GET error:", error);
    return createApiError(
      "INTERNAL_ERROR",
      "An unexpected error occurred while fetching messages",
      { originalError: getErrorMessage(error) }
    );
  }
}

/**
 * POST /api/conversations/[id]/messages
 * Add a message to a conversation
 * Body: { role: "user" | "assistant", content: string, next_actions?: string[], assumptions?: string[] }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    let body: {
      role: "user" | "assistant";
      content: string;
      next_actions?: string[];
      assumptions?: string[];
    };
    try {
      body = await req.json();
    } catch {
      return createApiError(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "{ role, content, next_actions?, assumptions? }" }
      );
    }

    if (!body.role || !body.content) {
      return createApiError(
        "VALIDATION_ERROR",
        "role and content are required",
        { missing: [!body.role && "role", !body.content && "content"].filter(Boolean) }
      );
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: id,
        role: body.role,
        content: body.content,
        next_actions: body.next_actions ?? null,
        assumptions: body.assumptions ?? null,
      })
      .select()
      .single();

    if (error) {
      return createApiError(
        "INTERNAL_ERROR",
        "Failed to create message",
        { dbError: error.message, conversationId: id }
      );
    }

    return NextResponse.json({ message: data }, { status: 201 });
  } catch (error) {
    console.error("[messages] POST error:", error);
    return createApiError(
      "INTERNAL_ERROR",
      "An unexpected error occurred while creating message",
      { originalError: getErrorMessage(error) }
    );
  }
}
