/**
 * Tool: interviews.add_quote
 *
 * Adds a quote from an interview for later repurposing.
 * Pipeline 2: Interview Intelligence
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Valid quote types
 */
const QUOTE_TYPES = [
  "insight",
  "story",
  "advice",
  "controversial",
  "quotable",
  "technical",
  "general",
] as const;

type QuoteType = typeof QUOTE_TYPES[number];

/**
 * Input args for interviews.add_quote
 */
export interface InterviewsAddQuoteArgs {
  /** Interview ID to add quote to */
  interview_id: string;
  /** The quote text */
  quote_text: string;
  /** Who said it (guest name, host, etc.) */
  speaker?: string;
  /** Surrounding context */
  context?: string;
  /** Type of quote */
  quote_type?: QuoteType;
  /** Impact/memorability score (0-1) */
  impact_score?: number;
  /** Social media potential (0-1) */
  shareability_score?: number;
  /** Seconds from start of interview */
  timestamp_start?: number;
  /** Seconds (end) */
  timestamp_end?: number;
}

/**
 * Output from interviews.add_quote
 */
export interface InterviewsAddQuoteResult {
  quote_id: string;
  interview_id: string;
  quote_type: string;
  scores: {
    impact: number;
    shareability: number;
  };
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): InterviewsAddQuoteArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.interview_id || typeof raw.interview_id !== "string") {
    throw new Error("interview_id is required and must be a string");
  }

  if (!raw.quote_text || typeof raw.quote_text !== "string") {
    throw new Error("quote_text is required and must be a string");
  }

  if (raw.quote_text.length < 10) {
    throw new Error("quote_text must be at least 10 characters");
  }

  if (raw.quote_text.length > 2000) {
    throw new Error("quote_text must be at most 2000 characters");
  }

  const quoteType = (raw.quote_type as QuoteType) || "general";
  if (!QUOTE_TYPES.includes(quoteType)) {
    throw new Error(`quote_type must be one of: ${QUOTE_TYPES.join(", ")}`);
  }

  return {
    interview_id: raw.interview_id,
    quote_text: raw.quote_text,
    speaker: raw.speaker as string | undefined,
    context: raw.context as string | undefined,
    quote_type: quoteType,
    impact_score: raw.impact_score !== undefined ? Number(raw.impact_score) : 0.5,
    shareability_score: raw.shareability_score !== undefined ? Number(raw.shareability_score) : 0.5,
    timestamp_start: raw.timestamp_start !== undefined ? Number(raw.timestamp_start) : undefined,
    timestamp_end: raw.timestamp_end !== undefined ? Number(raw.timestamp_end) : undefined,
  };
}

/**
 * Execute the quote addition
 */
async function run(
  args: InterviewsAddQuoteArgs,
  ctx: ToolContext
): Promise<ToolResponse<InterviewsAddQuoteResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

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

  // Insert quote
  const { data: quote, error } = await supabase
    .from("interview_quotes")
    .insert({
      interview_id: args.interview_id,
      org_id: orgId,
      quote_text: args.quote_text,
      speaker: args.speaker,
      context: args.context,
      quote_type: args.quote_type || "general",
      impact_score: Math.max(0, Math.min(1, args.impact_score || 0.5)),
      shareability_score: Math.max(0, Math.min(1, args.shareability_score || 0.5)),
      timestamp_start: args.timestamp_start,
      timestamp_end: args.timestamp_end,
      extracted_by: "ai",
      extraction_confidence: 0.8,
    })
    .select("id")
    .single();

  if (error || !quote) {
    throw new Error(`Failed to add quote: ${error?.message}`);
  }

  return {
    data: {
      quote_id: quote.id,
      interview_id: args.interview_id,
      quote_type: args.quote_type || "general",
      scores: {
        impact: args.impact_score || 0.5,
        shareability: args.shareability_score || 0.5,
      },
    },
    explainability: {
      interview_title: interview.title,
      quote_length: args.quote_text.length,
      has_speaker: !!args.speaker,
      has_context: !!args.context,
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
    "Add a quote from an interview for later content repurposing. " +
    "Quotes can be insights, stories, advice, controversial statements, or quotable soundbites. " +
    "Include speaker, context, and quality scores for better organization.",
  writes: true,
  validateArgs,
  run,
};
