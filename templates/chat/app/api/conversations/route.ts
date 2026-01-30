import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/client";
import { createApiError, getErrorMessage } from "@/lib/api/errors";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID!;

/**
 * GET /api/conversations
 * List all conversations for the org
 */
export async function GET() {
  try {
    if (!DEFAULT_ORG_ID) {
      return createApiError(
        "CONFIGURATION_ERROR",
        "DEFAULT_ORG_ID not configured",
        { field: "DEFAULT_ORG_ID" }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("org_id", DEFAULT_ORG_ID)
      .order("created_at", { ascending: false });

    if (error) {
      return createApiError(
        "INTERNAL_ERROR",
        "Failed to fetch conversations",
        { dbError: error.message }
      );
    }

    return NextResponse.json({ conversations: data });
  } catch (error) {
    console.error("[conversations] GET error:", error);
    return createApiError(
      "INTERNAL_ERROR",
      "An unexpected error occurred while fetching conversations",
      { originalError: getErrorMessage(error) }
    );
  }
}

/**
 * POST /api/conversations
 * Create a new conversation
 * Body: { title?: string }
 */
export async function POST(req: NextRequest) {
  try {
    if (!DEFAULT_ORG_ID) {
      return createApiError(
        "CONFIGURATION_ERROR",
        "DEFAULT_ORG_ID not configured",
        { field: "DEFAULT_ORG_ID" }
      );
    }

    const supabase = createServerClient();

    let title = "New Conversation";
    try {
      const body = await req.json();
      if (body.title) title = body.title;
    } catch {
      // No body or invalid JSON is fine - use default title
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
      return createApiError(
        "INTERNAL_ERROR",
        "Failed to create conversation",
        { dbError: error.message }
      );
    }

    return NextResponse.json({ conversation: data }, { status: 201 });
  } catch (error) {
    console.error("[conversations] POST error:", error);
    return createApiError(
      "INTERNAL_ERROR",
      "An unexpected error occurred while creating conversation",
      { originalError: getErrorMessage(error) }
    );
  }
}
