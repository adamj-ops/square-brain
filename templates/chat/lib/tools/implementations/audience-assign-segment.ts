/**
 * Tool: audience.assign_segment
 *
 * Assigns a segment to a quiz response based on scoring rules.
 * Suggests CTAs tied to the segment and detected emotions.
 *
 * Pipeline 5: Audience & Quiz Segmentation
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Segment with rules
 */
interface SegmentWithRules {
  id: string;
  name: string;
  slug: string;
  archetype: string | null;
  primary_emotion: string | null;
  min_score: number | null;
  max_score: number | null;
  priority: number;
  pain_points: string[];
  goals: string[];
}

/**
 * CTA suggestion
 */
interface CTASuggestion {
  id: string;
  name: string;
  slug: string;
  headline: string;
  subheadline: string | null;
  button_text: string;
  button_url: string;
  cta_type: string;
  match_reason: string;
}

/**
 * Input args for audience.assign_segment
 */
export interface AudienceAssignSegmentArgs {
  /** Quiz response ID to assign segment to */
  response_id?: string;
  /** Or use session_id to find the latest response */
  session_id?: string;
  /** Override automatic segment selection */
  force_segment_id?: string;
  /** Number of CTAs to suggest */
  cta_limit?: number;
  /** CTA placement filter */
  cta_placement?: string;
}

/**
 * Output from audience.assign_segment
 */
export interface AudienceAssignSegmentResult {
  response_id: string;
  assigned_segment: {
    id: string;
    name: string;
    slug: string;
    archetype: string | null;
    primary_emotion: string | null;
  } | null;
  segment_confidence: number;
  segment_reasoning: string;
  suggested_ctas: CTASuggestion[];
  primary_cta: CTASuggestion | null;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): AudienceAssignSegmentArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  // Need either response_id or session_id
  if (!raw.response_id && !raw.session_id) {
    throw new Error("Either response_id or session_id is required");
  }

  return {
    response_id: raw.response_id as string | undefined,
    session_id: raw.session_id as string | undefined,
    force_segment_id: raw.force_segment_id as string | undefined,
    cta_limit: typeof raw.cta_limit === "number" ? raw.cta_limit : 3,
    cta_placement: raw.cta_placement as string | undefined,
  };
}

/**
 * Match segment based on score and rules
 */
function matchSegment(
  score: number,
  segments: SegmentWithRules[],
  emotionalProfile?: { primary?: string; secondary?: string | null }
): { segment: SegmentWithRules | null; confidence: number; reasoning: string } {
  // Sort by priority (highest first)
  const sortedSegments = [...segments].sort((a, b) => b.priority - a.priority);

  let bestMatch: SegmentWithRules | null = null;
  let bestConfidence = 0;
  const reasons: string[] = [];

  for (const segment of sortedSegments) {
    let matchScore = 0;
    let totalFactors = 0;
    const segmentReasons: string[] = [];

    // Check score range
    if (segment.min_score !== null && segment.max_score !== null) {
      totalFactors++;
      if (score >= segment.min_score && score <= segment.max_score) {
        matchScore += 1;
        segmentReasons.push(
          `Score ${score} is within range [${segment.min_score}-${segment.max_score}]`
        );
      }
    } else if (segment.min_score !== null) {
      totalFactors++;
      if (score >= segment.min_score) {
        matchScore += 1;
        segmentReasons.push(`Score ${score} is above minimum ${segment.min_score}`);
      }
    } else if (segment.max_score !== null) {
      totalFactors++;
      if (score <= segment.max_score) {
        matchScore += 1;
        segmentReasons.push(`Score ${score} is below maximum ${segment.max_score}`);
      }
    }

    // Check emotional match
    if (segment.primary_emotion && emotionalProfile?.primary) {
      totalFactors++;
      if (segment.primary_emotion.toLowerCase() === emotionalProfile.primary.toLowerCase()) {
        matchScore += 0.5; // Partial weight for emotion match
        segmentReasons.push(`Emotional match: ${emotionalProfile.primary}`);
      }
    }

    // Calculate confidence
    const confidence = totalFactors > 0 ? matchScore / totalFactors : 0;

    // Consider priority bonus
    const adjustedConfidence = confidence + segment.priority * 0.01;

    if (adjustedConfidence > bestConfidence) {
      bestConfidence = adjustedConfidence;
      bestMatch = segment;
      reasons.length = 0;
      reasons.push(...segmentReasons);
    }
  }

  // Cap confidence at 1.0
  const finalConfidence = Math.min(1, bestConfidence);

  return {
    segment: bestMatch,
    confidence: Math.round(finalConfidence * 100) / 100,
    reasoning: bestMatch
      ? `Assigned to "${bestMatch.name}": ${reasons.join("; ")}`
      : "No matching segment found based on scoring rules",
  };
}

/**
 * Execute segment assignment
 */
async function run(
  args: AudienceAssignSegmentArgs,
  ctx: ToolContext
): Promise<ToolResponse<AudienceAssignSegmentResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

  // Find the quiz response
  let responseQuery = supabase
    .from("quiz_responses")
    .select(
      "id, quiz_id, session_id, normalized_score, dimension_scores, detected_emotions, status"
    )
    .eq("org_id", orgId);

  if (args.response_id) {
    responseQuery = responseQuery.eq("id", args.response_id);
  } else if (args.session_id) {
    responseQuery = responseQuery
      .eq("session_id", args.session_id)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  const { data: responses, error: responseError } = await responseQuery;

  if (responseError) {
    throw new Error(`Failed to find quiz response: ${responseError.message}`);
  }

  if (!responses || responses.length === 0) {
    throw new Error(
      args.response_id
        ? `Quiz response not found: ${args.response_id}`
        : `No quiz response found for session: ${args.session_id}`
    );
  }

  const quizResponse = responses[0];

  // Get score
  const score = quizResponse.normalized_score ?? 0;
  const emotionalProfile = quizResponse.detected_emotions as {
    primary?: string;
    secondary?: string | null;
  } | null;

  let assignedSegment: SegmentWithRules | null = null;
  let confidence = 0;
  let reasoning = "";

  // If force_segment_id is provided, use that
  if (args.force_segment_id) {
    const { data: forcedSegment, error: forceError } = await supabase
      .from("audience_segments")
      .select(
        "id, name, slug, archetype, primary_emotion, min_score, max_score, priority, pain_points, goals"
      )
      .eq("id", args.force_segment_id)
      .eq("org_id", orgId)
      .single();

    if (forceError || !forcedSegment) {
      throw new Error(`Forced segment not found: ${args.force_segment_id}`);
    }

    assignedSegment = forcedSegment as SegmentWithRules;
    confidence = 1.0;
    reasoning = `Manually assigned to "${assignedSegment.name}"`;
  } else {
    // Get active segments
    const { data: segments, error: segmentsError } = await supabase
      .from("audience_segments")
      .select(
        "id, name, slug, archetype, primary_emotion, min_score, max_score, priority, pain_points, goals"
      )
      .eq("org_id", orgId)
      .eq("status", "active")
      .order("priority", { ascending: false });

    if (segmentsError) {
      throw new Error(`Failed to fetch segments: ${segmentsError.message}`);
    }

    // Match segment
    const match = matchSegment(
      score,
      (segments || []) as SegmentWithRules[],
      emotionalProfile || undefined
    );

    assignedSegment = match.segment;
    confidence = match.confidence;
    reasoning = match.reasoning;
  }

  // Get CTAs for the segment and emotion
  const primaryEmotion = emotionalProfile?.primary || null;

  let ctaQuery = supabase
    .from("ctas")
    .select(
      "id, name, slug, headline, subheadline, button_text, button_url, cta_type, target_emotions, placement"
    )
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("priority", { ascending: false })
    .limit(args.cta_limit || 3);

  // Filter by segment (or no segment = generic CTAs)
  if (assignedSegment) {
    ctaQuery = ctaQuery.or(`segment_id.eq.${assignedSegment.id},segment_id.is.null`);
  } else {
    ctaQuery = ctaQuery.is("segment_id", null);
  }

  // Filter by placement if specified
  if (args.cta_placement) {
    ctaQuery = ctaQuery.contains("placement", [args.cta_placement]);
  }

  const { data: ctas, error: ctaError } = await ctaQuery;

  if (ctaError) {
    console.error(`Failed to fetch CTAs: ${ctaError.message}`);
  }

  // Score and sort CTAs by relevance
  const scoredCTAs: CTASuggestion[] = (ctas || []).map((cta) => {
    const reasons: string[] = [];

    // Check emotional match
    const targetEmotions = (cta.target_emotions || []) as string[];
    if (primaryEmotion && targetEmotions.includes(primaryEmotion)) {
      reasons.push(`Matches emotion: ${primaryEmotion}`);
    }

    // Check segment match
    if (assignedSegment) {
      reasons.push(`Fits segment: ${assignedSegment.name}`);
    }

    if (reasons.length === 0) {
      reasons.push("General recommendation");
    }

    return {
      id: cta.id,
      name: cta.name,
      slug: cta.slug,
      headline: cta.headline,
      subheadline: cta.subheadline,
      button_text: cta.button_text,
      button_url: cta.button_url,
      cta_type: cta.cta_type,
      match_reason: reasons.join("; "),
    };
  });

  // Sort by relevance (emotion match first)
  scoredCTAs.sort((a, b) => {
    const aHasEmotion = a.match_reason.includes("emotion") ? 1 : 0;
    const bHasEmotion = b.match_reason.includes("emotion") ? 1 : 0;
    return bHasEmotion - aHasEmotion;
  });

  const primaryCTA = scoredCTAs[0] || null;

  // Update the quiz response with segment assignment
  const { error: updateError } = await supabase
    .from("quiz_responses")
    .update({
      segment_id: assignedSegment?.id || null,
      segment_assigned_at: new Date().toISOString(),
      segment_confidence: confidence,
      segment_reasoning: reasoning,
      primary_cta_id: primaryCTA?.id || null,
      suggested_ctas: scoredCTAs.map((c) => c.id),
      status: "segmented",
    })
    .eq("id", quizResponse.id);

  if (updateError) {
    throw new Error(`Failed to update quiz response: ${updateError.message}`);
  }

  return {
    data: {
      response_id: quizResponse.id,
      assigned_segment: assignedSegment
        ? {
            id: assignedSegment.id,
            name: assignedSegment.name,
            slug: assignedSegment.slug,
            archetype: assignedSegment.archetype,
            primary_emotion: assignedSegment.primary_emotion,
          }
        : null,
      segment_confidence: confidence,
      segment_reasoning: reasoning,
      suggested_ctas: scoredCTAs,
      primary_cta: primaryCTA,
    },
    explainability: {
      reason: assignedSegment
        ? `Assigned to segment "${assignedSegment.name}" with ${Math.round(confidence * 100)}% confidence. ` +
          `${scoredCTAs.length} CTAs suggested.`
        : `No segment assigned. ${scoredCTAs.length} generic CTAs suggested.`,
      org_id: orgId,
      quiz_score: score,
      detected_emotion: primaryEmotion,
      segment_match_type: args.force_segment_id ? "forced" : "automatic",
      ctas_count: scoredCTAs.length,
    },
  };
}

/**
 * Tool definition for audience.assign_segment
 */
export const audienceAssignSegmentTool: ToolDefinition<
  AudienceAssignSegmentArgs,
  AudienceAssignSegmentResult
> = {
  name: "audience.assign_segment",
  description:
    "Assign an audience segment to a quiz response based on scoring rules. " +
    "Evaluates score ranges and emotional matches to find the best segment. " +
    "Suggests relevant CTAs tied to the segment and detected emotions. " +
    "Updates the quiz response with segment assignment and CTA suggestions.",
  writes: true,
  validateArgs,
  run,
};
