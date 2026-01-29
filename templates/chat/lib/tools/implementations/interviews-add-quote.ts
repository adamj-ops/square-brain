/**
 * Tool: interviews.add_quote
 *
 * Adds a notable quote from an interview for content repurposing.
 * This is a write tool - requires allowWrites=true.
 *
 * Pipeline 2: Interview Intelligence
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Valid quote types
 */
const QUOTE_TYPES = [
  "insight",
  "story",
  "tip",
  "opinion",
  "data",
  "question",
  "humor",
  "controversy",
  "soundbite",
  "other",
] as const;
type QuoteType = (typeof QUOTE_TYPES)[number];

/**
 * Valid speaker types
 */
const SPEAKER_TYPES = ["guest", "host", "other"] as const;
type SpeakerType = (typeof SPEAKER_TYPES)[number];

/**
 * Input args for interviews.add_quote
 */
export interface InterviewsAddQuoteArgs {
  // Required
  interview_id: string;
  quote_text: string;
  speaker: string;

  // Classification
  speaker_type?: SpeakerType;
  quote_type?: QuoteType;

  // Context
  context?: string;
  timestamp_start?: number; // seconds
  timestamp_end?: number; // seconds

  // Quality metrics
  impact_score?: number; // 0-1
  shareability_score?: number; // 0-1
  is_featured?: boolean;

  // Extraction metadata
  extracted_by?: "manual" | "ai" | "transcript";
  extraction_metadata?: Record<string, unknown>;
}

/**
 * Output from interviews.add_quote
 */
export interface InterviewsAddQuoteResult {
  quote_id: string;
  interview_id: string;
  interview_title: string;
  quote_preview: string;
}

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): InterviewsAddQuoteArgs {
  if (!args || typeof args !== "object") {
    throw new Error("Args must be an object");
  }

  const input = args as Record<string, unknown>;

  // Required: interview_id
  if (!input.interview_id || typeof input.interview_id !== "string") {
    throw new Error("interview_id is required and must be a string (UUID)");
  }

  // Required: quote_text
  if (!input.quote_text || typeof input.quote_text !== "string" || input.quote_text.trim().length === 0) {
    throw new Error("quote_text is required and must be a non-empty string");
  }

  // Required: speaker
  if (!input.speaker || typeof input.speaker !== "string" || input.speaker.trim().length === 0) {
    throw new Error("speaker is required and must be a non-empty string");
  }

  // Validate speaker_type if provided
  if (input.speaker_type && !SPEAKER_TYPES.includes(input.speaker_type as SpeakerType)) {
    throw new Error(`speaker_type must be one of: ${SPEAKER_TYPES.join(", ")}`);
  }

  // Validate quote_type if provided
  if (input.quote_type && !QUOTE_TYPES.includes(input.quote_type as QuoteType)) {
    throw new Error(`quote_type must be one of: ${QUOTE_TYPES.join(", ")}`);
  }

  // Validate scores range
  if (input.impact_score !== undefined) {
    const score = Number(input.impact_score);
    if (isNaN(score) || score < 0 || score > 1) {
      throw new Error("impact_score must be a number between 0 and 1");
    }
  }

  if (input.shareability_score !== undefined) {
    const score = Number(input.shareability_score);
    if (isNaN(score) || score < 0 || score > 1) {
      throw new Error("shareability_score must be a number between 0 and 1");
    }
  }

  // Validate timestamps
  if (input.timestamp_start !== undefined && (typeof input.timestamp_start !== "number" || input.timestamp_start < 0)) {
    throw new Error("timestamp_start must be a non-negative number (seconds)");
  }

  if (input.timestamp_end !== undefined && (typeof input.timestamp_end !== "number" || input.timestamp_end < 0)) {
    throw new Error("timestamp_end must be a non-negative number (seconds)");
  }

  return {
    interview_id: input.interview_id as string,
    quote_text: (input.quote_text as string).trim(),
    speaker: (input.speaker as string).trim(),
    speaker_type: (input.speaker_type as SpeakerType) || "guest",
    quote_type: (input.quote_type as QuoteType) || "insight",
    context: input.context ? (input.context as string).trim() : undefined,
    timestamp_start: input.timestamp_start as number | undefined,
    timestamp_end: input.timestamp_end as number | undefined,
    impact_score: input.impact_score !== undefined ? Number(input.impact_score) : undefined,
    shareability_score: input.shareability_score !== undefined ? Number(input.shareability_score) : undefined,
    is_featured: input.is_featured === true,
    extracted_by: (input.extracted_by as "manual" | "ai" | "transcript") || "manual",
    extraction_metadata: input.extraction_metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Execute the add quote operation
 */
async function run(
  args: InterviewsAddQuoteArgs,
  ctx: ToolContext
): Promise<ToolResponse<InterviewsAddQuoteResult>> {
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

  // Insert the quote
  const { data: quote, error: insertError } = await supabase
    .from("interview_quotes")
    .insert({
      org_id: orgId,
      interview_id: args.interview_id,
      quote_text: args.quote_text,
      speaker: args.speaker,
      speaker_type: args.speaker_type,
      quote_type: args.quote_type,
      context: args.context || null,
      timestamp_start: args.timestamp_start ?? null,
      timestamp_end: args.timestamp_end ?? null,
      impact_score: args.impact_score ?? 0.5,
      shareability_score: args.shareability_score ?? 0.5,
      is_featured: args.is_featured,
      extracted_by: args.extracted_by,
      extraction_metadata: args.extraction_metadata || {},
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Failed to add quote: ${insertError.message}`);
  }

  // Create preview (truncated quote)
  const quotePreview =
    args.quote_text.length > 100 ? args.quote_text.slice(0, 100) + "..." : args.quote_text;

  return {
    data: {
      quote_id: quote.id,
      interview_id: args.interview_id,
      interview_title: interview.title,
      quote_preview: quotePreview,
    },
    explainability: {
      reason: "Added quote to interview",
      interview_title: interview.title,
      speaker: args.speaker,
      speaker_type: args.speaker_type,
      quote_type: args.quote_type,
      impact_score: args.impact_score ?? 0.5,
      shareability_score: args.shareability_score ?? 0.5,
      is_featured: args.is_featured,
      has_timestamp: args.timestamp_start !== undefined,
    },
  };
}

/**
 * Tool definition for interviews.add_quote
 */
export const interviewsAddQuoteTool: ToolDefinition<
  InterviewsAddQuoteArgs,
  InterviewsAddQuoteResult
> = {
  name: "interviews.add_quote",
  description:
    "Adds a notable quote from an interview for content repurposing. " +
    "Quotes are classified by type (insight, story, tip, etc.) and scored for impact and shareability. " +
    "Use this to capture memorable moments, soundbites, and valuable insights from interviews.",
  writes: true,
  validateArgs,
  run,
};
