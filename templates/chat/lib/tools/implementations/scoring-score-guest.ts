/**
 * Tool: scoring.score_guest
 *
 * Calculates a comprehensive score for a guest based on their signals.
 * Provides explainable scoring with component breakdowns.
 * Pipeline 1: Guest Intelligence
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Scoring rules version
 */
const SCORING_VERSION = "v1.0";

/**
 * Default weights for scoring components
 */
const DEFAULT_WEIGHTS = {
  expertise: 0.30,
  reach: 0.20,
  relevance: 0.25,
  availability: 0.10,
  content_potential: 0.15,
};

/**
 * Input args for scoring.score_guest
 */
export interface ScoringScoreGuestArgs {
  /** Guest ID to score */
  guest_id: string;
  /** Optional custom weights (must sum to 1) */
  weights?: {
    expertise?: number;
    reach?: number;
    relevance?: number;
    availability?: number;
    content_potential?: number;
  };
}

/**
 * Output from scoring.score_guest
 */
export interface ScoringScoreGuestResult {
  guest_id: string;
  guest_name: string;
  total_score: number;
  grade: string;
  components: {
    expertise: number;
    reach: number;
    relevance: number;
    availability: number;
    content_potential: number;
  };
  explanation: string;
  top_factors: string[];
  concerns: string[];
  scoring_version: string;
}

/**
 * Calculate letter grade from score
 */
function getGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  if (score >= 55) return "C";
  if (score >= 50) return "C-";
  if (score >= 45) return "D+";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): ScoringScoreGuestArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.guest_id || typeof raw.guest_id !== "string") {
    throw new Error("guest_id is required and must be a string");
  }

  const result: ScoringScoreGuestArgs = { guest_id: raw.guest_id };

  if (raw.weights && typeof raw.weights === "object") {
    const w = raw.weights as Record<string, unknown>;
    result.weights = {
      expertise: w.expertise as number | undefined,
      reach: w.reach as number | undefined,
      relevance: w.relevance as number | undefined,
      availability: w.availability as number | undefined,
      content_potential: w.content_potential as number | undefined,
    };
  }

  return result;
}

/**
 * Execute the scoring
 */
async function run(
  args: ScoringScoreGuestArgs,
  ctx: ToolContext
): Promise<ToolResponse<ScoringScoreGuestResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

  // Verify guest exists and get name
  const { data: guest } = await supabase
    .from("guests")
    .select("id, name, status")
    .eq("id", args.guest_id)
    .eq("org_id", orgId)
    .single();

  if (!guest) {
    throw new Error(`Guest not found: ${args.guest_id}`);
  }

  // Get all signals for the guest
  const { data: signals } = await supabase
    .from("guest_signals")
    .select("signal_type, title, weight, confidence")
    .eq("guest_id", args.guest_id);

  // Calculate component scores
  const signalList = signals || [];
  
  const componentScores = {
    expertise: 0,
    reach: 0,
    relevance: 0,
    availability: 50, // Default to neutral availability
    content_potential: 0,
  };

  const expertiseSignals = signalList.filter((s) => s.signal_type === "expertise");
  const reachSignals = signalList.filter((s) => 
    ["social_proof", "media_mention"].includes(s.signal_type)
  );
  const relevanceSignals = signalList.filter((s) => 
    ["content", "speaking", "endorsement"].includes(s.signal_type)
  );
  const availabilitySignals = signalList.filter((s) => 
    s.signal_type === "availability"
  );
  const contentSignals = signalList.filter((s) => 
    ["content", "achievement"].includes(s.signal_type)
  );

  // Calculate weighted averages (scale to 0-100)
  if (expertiseSignals.length > 0) {
    componentScores.expertise = Math.min(100, Math.max(0,
      (expertiseSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / 
       expertiseSignals.length) * 100
    ));
  }

  if (reachSignals.length > 0) {
    componentScores.reach = Math.min(100, Math.max(0,
      (reachSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / 
       reachSignals.length) * 100
    ));
  }

  if (relevanceSignals.length > 0) {
    componentScores.relevance = Math.min(100, Math.max(0,
      (relevanceSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / 
       relevanceSignals.length) * 100
    ));
  }

  if (availabilitySignals.length > 0) {
    componentScores.availability = Math.min(100, Math.max(0,
      (availabilitySignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / 
       availabilitySignals.length) * 100
    ));
  }

  if (contentSignals.length > 0) {
    componentScores.content_potential = Math.min(100, Math.max(0,
      (contentSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / 
       contentSignals.length) * 100
    ));
  }

  // Apply weights
  const weights = { ...DEFAULT_WEIGHTS, ...args.weights };
  
  const totalScore = 
    componentScores.expertise * weights.expertise +
    componentScores.reach * weights.reach +
    componentScores.relevance * weights.relevance +
    componentScores.availability * weights.availability +
    componentScores.content_potential * weights.content_potential;

  // Get top factors (positive signals)
  const topFactors = signalList
    .filter((s) => s.weight > 0)
    .sort((a, b) => (b.weight * b.confidence) - (a.weight * a.confidence))
    .slice(0, 3)
    .map((s) => s.title);

  // Get concerns (negative signals)
  const concerns = signalList
    .filter((s) => s.weight < 0)
    .sort((a, b) => (a.weight * a.confidence) - (b.weight * b.confidence))
    .slice(0, 3)
    .map((s) => s.title);

  // Generate explanation
  const explanation = `${guest.name} scored ${totalScore.toFixed(1)}/100 (Grade: ${getGrade(totalScore)}). ` +
    `Components: Expertise ${componentScores.expertise.toFixed(0)}, ` +
    `Reach ${componentScores.reach.toFixed(0)}, ` +
    `Relevance ${componentScores.relevance.toFixed(0)}, ` +
    `Availability ${componentScores.availability.toFixed(0)}, ` +
    `Content ${componentScores.content_potential.toFixed(0)}. ` +
    `Based on ${signalList.length} signals.`;

  // Store the score
  await supabase
    .from("guest_scores")
    .upsert(
      {
        guest_id: args.guest_id,
        org_id: orgId,
        total_score: totalScore,
        expertise_score: componentScores.expertise,
        reach_score: componentScores.reach,
        relevance_score: componentScores.relevance,
        availability_score: componentScores.availability,
        content_potential_score: componentScores.content_potential,
        scoring_version: SCORING_VERSION,
        scoring_rules: weights,
        explanation,
        top_factors: topFactors,
        concerns,
        valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "guest_id,scoring_version" }
    );

  return {
    data: {
      guest_id: args.guest_id,
      guest_name: guest.name,
      total_score: Math.round(totalScore * 10) / 10,
      grade: getGrade(totalScore),
      components: {
        expertise: Math.round(componentScores.expertise),
        reach: Math.round(componentScores.reach),
        relevance: Math.round(componentScores.relevance),
        availability: Math.round(componentScores.availability),
        content_potential: Math.round(componentScores.content_potential),
      },
      explanation,
      top_factors: topFactors,
      concerns,
      scoring_version: SCORING_VERSION,
    },
    explainability: {
      weights_used: weights,
      signals_count: signalList.length,
      signal_breakdown: {
        expertise: expertiseSignals.length,
        reach: reachSignals.length,
        relevance: relevanceSignals.length,
        availability: availabilitySignals.length,
        content: contentSignals.length,
      },
    },
  };
}

/**
 * Tool definition for scoring.score_guest
 */
export const scoringScoreGuestTool: ToolDefinition<
  ScoringScoreGuestArgs,
  ScoringScoreGuestResult
> = {
  name: "scoring.score_guest",
  description:
    "Calculate a comprehensive score for a guest based on their signals. " +
    "Returns total score (0-100), letter grade, component scores, " +
    "top contributing factors, and concerns. Scoring is explainable and versioned.",
  writes: true,
  validateArgs,
  run,
};
