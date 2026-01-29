/**
 * Tool: themes.link_to_interview
 *
 * Links a theme to an interview, indicating the interview covers that theme.
 * Pipeline 2: Interview Intelligence
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Input args for themes.link_to_interview
 */
export interface ThemesLinkToInterviewArgs {
  /** Theme ID to link */
  theme_id: string;
  /** Interview ID to link to */
  interview_id: string;
  /** Relevance score (0-1) */
  relevance_score?: number;
  /** Is this a primary theme of the interview? */
  is_primary?: boolean;
}

/**
 * Output from themes.link_to_interview
 */
export interface ThemesLinkToInterviewResult {
  link_id: string;
  theme_id: string;
  interview_id: string;
  theme_name: string;
  interview_title: string;
  is_primary: boolean;
  relevance_score: number;
  status: "created" | "updated";
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): ThemesLinkToInterviewArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.theme_id || typeof raw.theme_id !== "string") {
    throw new Error("theme_id is required and must be a string");
  }

  if (!raw.interview_id || typeof raw.interview_id !== "string") {
    throw new Error("interview_id is required and must be a string");
  }

  return {
    theme_id: raw.theme_id,
    interview_id: raw.interview_id,
    relevance_score: raw.relevance_score !== undefined ? Number(raw.relevance_score) : 0.5,
    is_primary: raw.is_primary === true,
  };
}

/**
 * Execute the link creation
 */
async function run(
  args: ThemesLinkToInterviewArgs,
  ctx: ToolContext
): Promise<ToolResponse<ThemesLinkToInterviewResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

  // Verify theme exists
  const { data: theme } = await supabase
    .from("themes")
    .select("id, name")
    .eq("id", args.theme_id)
    .eq("org_id", orgId)
    .single();

  if (!theme) {
    throw new Error(`Theme not found: ${args.theme_id}`);
  }

  // Verify interview exists
  const { data: interview } = await supabase
    .from("interviews")
    .select("id, title")
    .eq("id", args.interview_id)
    .eq("org_id", orgId)
    .single();

  if (!interview) {
    throw new Error(`Interview not found: ${args.interview_id}`);
  }

  // Check if link exists
  const { data: existing } = await supabase
    .from("interview_themes")
    .select("id")
    .eq("interview_id", args.interview_id)
    .eq("theme_id", args.theme_id)
    .single();

  const relevanceScore = Math.max(0, Math.min(1, args.relevance_score || 0.5));
  let linkId: string;
  let isNew = false;

  if (existing) {
    // Update existing link
    const { error: updateError } = await supabase
      .from("interview_themes")
      .update({
        relevance_score: relevanceScore,
        is_primary: args.is_primary || false,
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update link: ${updateError.message}`);
    }

    linkId = existing.id;
  } else {
    // Create new link
    const { data: newLink, error: insertError } = await supabase
      .from("interview_themes")
      .insert({
        interview_id: args.interview_id,
        theme_id: args.theme_id,
        org_id: orgId,
        relevance_score: relevanceScore,
        is_primary: args.is_primary || false,
        detected_by: "ai",
      })
      .select("id")
      .single();

    if (insertError || !newLink) {
      throw new Error(`Failed to create link: ${insertError?.message}`);
    }

    linkId = newLink.id;
    isNew = true;

    // Update theme evidence count (ignore if RPC doesn't exist)
    try {
      await supabase.rpc("link_content_to_theme", {
        p_org_id: orgId,
        p_theme_id: args.theme_id,
        p_content_type: "interview",
        p_content_id: args.interview_id,
        p_relevance_score: relevanceScore,
        p_detected_by: "ai",
      });
    } catch {
      // Ignore if RPC doesn't exist (just for content_themes table)
    }
  }

  return {
    data: {
      link_id: linkId,
      theme_id: args.theme_id,
      interview_id: args.interview_id,
      theme_name: theme.name,
      interview_title: interview.title,
      is_primary: args.is_primary || false,
      relevance_score: relevanceScore,
      status: isNew ? "created" : "updated",
    },
    explainability: {
      operation: isNew ? "created_new_link" : "updated_existing_link",
      theme_name: theme.name,
      interview_title: interview.title,
    },
  };
}

/**
 * Tool definition for themes.link_to_interview
 */
export const themesLinkToInterviewTool: ToolDefinition<
  ThemesLinkToInterviewArgs,
  ThemesLinkToInterviewResult
> = {
  name: "themes.link_to_interview",
  description:
    "Link a theme to an interview to indicate the interview discusses that theme. " +
    "Use is_primary=true for the main themes of an interview. " +
    "Relevance score indicates how central the theme is to the interview content.",
  writes: true,
  validateArgs,
  run,
};
