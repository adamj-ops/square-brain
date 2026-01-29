import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/client";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/conversations/[id]/messages
 * List all messages for a conversation
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data });
}

/**
 * POST /api/conversations/[id]/messages
 * Add a message to a conversation
 * Body: { role: "user" | "assistant", content: string, next_actions?: string[], assumptions?: string[] }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.role || !body.content) {
    return NextResponse.json({ error: "role and content are required" }, { status: 400 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: data }, { status: 201 });
}
