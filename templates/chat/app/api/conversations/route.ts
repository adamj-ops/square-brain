import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/client";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID!;

/**
 * GET /api/conversations
 * List all conversations for the org
 */
export async function GET() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", DEFAULT_ORG_ID)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data });
}

/**
 * POST /api/conversations
 * Create a new conversation
 * Body: { title?: string }
 */
export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  let title = "New Conversation";
  try {
    const body = await req.json();
    if (body.title) title = body.title;
  } catch {
    // No body or invalid JSON is fine
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      org_id: DEFAULT_ORG_ID,
      title,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: data }, { status: 201 });
}
