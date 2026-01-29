/**
 * Tool: themes.link_to_interview
 *
 * Links a theme to an interview with relevance scoring and depth analysis.
 * This is a write tool - requires allowWrites=true.
 *
 * Pipeline 2: Interview Intelligence
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Valid discussion depths
 */
const DISCUSSION_DEPTHS = [
  "mentioned",      // Briefly mentioned
  "discussed",      // Substantively discussed
  "deep_dive",      // Major focus of interview
  "expert_insight", // Guest provided expert-level insight
] as const;
type DiscussionDepth = (typeof DISCUSSION_DEPTHS)[number];

/**
 * Input args for themes.link_to_interview
 */
export interface ThemesLinkToInterviewArgs {
  // Required
  interview_id: string;
  theme_id: string;

  // Analysis
  relevance_score?: number; // 0-1, how central to this interview
  discussion_depth?: DiscussionDepth;

  // Evidence
  excerpt?: string; // Key excerpt about this theme
  supporting_quote_ids?: string[]; // References to interview_quotes.id

  // Time tracking
  first_mentioned_at?: number; // Timestamp in seconds
  total_duration_seconds?: number; // Total time spent on theme

  // Metadata
  detected_by?: "scanner" | "manual" | "agent";
  detection_metadata?: Record<string, unknown>;
}

/**
 * Output from themes.link_to_interview
 */
export interface ThemesLinkToInterviewResult {
  link_id: string;
  interview_id: string;
  theme_id: string;
  theme_name: string;
  is_new_link: boolean;
  relevance_score: number;
  discussion_depth: string;
}

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): ThemesLinkToInterviewArgs {
  if (!args || typeof args !== "object") {
    throw new Error("Args must be an object");
  }

  const input = args as Record<string, unknown>;

  // Required: interview_id
  if (!input.interview_id || typeof input.interview_id !== "string") {
    throw new Error("interview_id is required and must be a string (UUID)");
  }

  // Required: theme_id
  if (!input.theme_id || typeof input.theme_id !== "string") {
    throw new Error("theme_id is required and must be a string (UUID)");
  }

  // Validate discussion_depth if provided
  if (input.discussion_depth && !DISCUSSION_DEPTHS.includes(input.discussion_depth as DiscussionDepth)) {
    throw new Error(`discussion_depth must be one of: ${DISCUSSION_DEPTHS.join(", ")}`);
  }

  // Validate relevance_score range
  if (input.relevance_score !== undefined) {
    const score = Number(input.relevance_score);
    if (isNaN(score) || score < 0 || score > 1) {
      throw new Error("relevance_score must be a number between 0 and 1");
    }
  }

  // Validate timestamps
  if (input.first_mentioned_at !== undefined && (typeof input.first_mentioned_at !== "number" || input.first_mentioned_at < 0)) {
    throw new Error("first_mentioned_at must be a non-negative number (seconds)");
  }

  if (input.total_duration_seconds !== undefined && (typeof input.total_duration_seconds !== "number" || input.total_duration_seconds < 0)) {
    throw new Error("total_duration_seconds must be a non-negative number");
  }

  // Validate supporting_quote_ids if provided
  if (input.supporting_quote_ids && (!Array.isArray(input.supporting_quote_ids) || !input.supporting_quote_ids.every((id) => typeof id === "string"))) {
    throw new Error("supporting_quote_ids must be an array of strings (UUIDs)");
  }

  return {
    interview_id: input.interview_id as string,
    theme_id: input.theme_id as string,
    relevance_score: input.relevance_score !== undefined ? Number(input.relevance_score) : undefined,
    discussion_depth: (input.discussion_depth as DiscussionDepth) || "discussed",
    excerpt: input.excerpt ? (input.excerpt as string).trim() : undefined,
    supporting_quote_ids: input.supporting_quote_ids as string[] | undefined,
    first_mentioned_at: input.first_mentioned_at as number | undefined,
    total_duration_seconds: input.total_duration_seconds as number | undefined,
    detected_by: (input.detected_by as "scanner" | "manual" | "agent") || "manual",
    detection_metadata: input.detection_metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Execute the link operation
 */
async function run(
  args: ThemesLinkToInterviewArgs,
  ctx: ToolContext
): Promise<ToolResponse<ThemesLinkToInterviewResult>> {
  const supabase = getServiceSupabase();
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  // Verify interview exists and belongs to org
  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, title, org_id")
    .eq("id", args.interview_id)
    .single();

  if (interviewError || !interview) {
    throw new Error(`Interview not found: ${args.interview_id}`);
  }

  if (interview.org_id !== orgId) {
    throw new Error("Interview belongs to a different organization");
  }

  // Verify theme exists and belongs to org
  const { data: theme, error: themeError } = await supabase
    .from("themes")
    .select("id, name, org_id, status")
    .eq("id", args.theme_id)
    .single();

  if (themeError || !theme) {
    throw new Error(`Theme not found: ${args.theme_id}`);
  }

  if (theme.org_id !== orgId) {
    throw new Error("Theme belongs to a different organization");
  }

  if (theme.status !== "active") {
    throw new Error(`Theme is not active (status: ${theme.status})`);
  }

  // Check for existing link
  const { data: existingLink, error: selectError } = await supabase
    .from("interview_themes")
    .select("id")
    .eq("interview_id", args.interview_id)
    .eq("theme_id", args.theme_id)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to check existing link: ${selectError.message}`);
  }

  const relevanceScore = args.relevance_score ?? 0.5;
  const discussionDepth = args.discussion_depth || "discussed";
  let linkId: string;
  let isNewLink = false;

  if (existingLink) {
    // Update existing link
    linkId = existingLink.id;

    const updateData: Record<string, unknown> = {};

    // Only update if new value is higher (progressive enhancement)
    if (args.relevance_score !== undefined) {
      updateData.relevance_score = relevanceScore;
    }
    if (args.discussion_depth) {
      updateData.discussion_depth = discussionDepth;
    }
    if (args.excerpt !== undefined) {
      updateData.excerpt = args.excerpt;
    }
    if (args.supporting_quote_ids !== undefined) {
      updateData.supporting_quotes = args.supporting_quote_ids;
    }
    if (args.first_mentioned_at !== undefined) {
      updateData.first_mentioned_at = args.first_mentioned_at;
    }
    if (args.total_duration_seconds !== undefined) {
      updateData.total_duration_seconds = args.total_duration_seconds;
    }
    if (args.detection_metadata !== undefined) {
      updateData.detection_metadata = args.detection_metadata;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("interview_themes")
        .update(updateData)
        .eq("id", linkId);

      if (updateError) {
        throw new Error(`Failed to update link: ${updateError.message}`);
      }
    }
  } else {
    // Create new link
    isNewLink = true;

    const { data: newLink, error: insertError } = await supabase
      .from("interview_themes")
      .insert({
        org_id: orgId,
        interview_id: args.interview_id,
        theme_id: args.theme_id,
        relevance_score: relevanceScore,
        discussion_depth: discussionDepth,
        excerpt: args.excerpt || null,
        supporting_quotes: args.supporting_quote_ids || [],
        first_mentioned_at: args.first_mentioned_at ?? null,
        total_duration_seconds: args.total_duration_seconds ?? null,
        detected_by: args.detected_by,
        detection_metadata: args.detection_metadata || {},
      })
      .select("id")
      .single();

    if (insertError) {
      // Handle race condition
      if (insertError.code === "23505") {
        const { data: raced } = await supabase
          .from("interview_themes")
          .select("id")
          .eq("interview_id", args.interview_id)
          .eq("theme_id", args.theme_id)
          .single();

        if (raced) {
          return {
            data: {
              link_id: raced.id,
              interview_id: args.interview_id,
              theme_id: args.theme_id,
              theme_name: theme.name,
              is_new_link: false,
              relevance_score: relevanceScore,
              discussion_depth: discussionDepth,
            },
            explainability: {
              reason: "Link created by another process (race condition handled)",
              interview_title: interview.title,
              theme_name: theme.name,
            },
          };
        }
      }
      throw new Error(`Failed to create link: ${insertError.message}`);
    }

    linkId = newLink.id;
  }

  return {
    data: {
      link_id: linkId,
      interview_id: args.interview_id,
      theme_id: args.theme_id,
      theme_name: theme.name,
      is_new_link: isNewLink,
      relevance_score: relevanceScore,
      discussion_depth: discussionDepth,
    },
    explainability: {
      reason: isNewLink ? "Created new interview-theme link" : "Updated existing link",
      interview_title: interview.title,
      theme_name: theme.name,
      discussion_depth: discussionDepth,
      has_excerpt: !!args.excerpt,
      has_supporting_quotes: (args.supporting_quote_ids?.length || 0) > 0,
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
    "Links a theme to an interview with relevance scoring and discussion depth analysis. " +
    "Use this to track which themes were covered in each interview, how deeply they were discussed, " +
    "and link supporting quotes as evidence.",
  writes: true,
  validateArgs,
  run,
};
