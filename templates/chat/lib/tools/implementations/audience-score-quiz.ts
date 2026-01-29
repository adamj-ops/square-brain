/**
 * Tool: audience.score_quiz
 *
 * Scores quiz responses with sliding interdependency scoring.
 * Calculates raw, weighted, normalized, and dimension scores.
 * Detects emotional profile from response patterns.
 *
 * Pipeline 5: Audience & Quiz Segmentation
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Scoring configuration version
 */
const SCORING_VERSION = "v1.0";

/**
 * Question config for scoring
 */
interface QuestionConfig {
  id: string;
  weight: number;
  dimension?: string;
  values: Record<string, number>;
  /** Interdependency rules: if another question has certain answer, adjust score */
  interdependencies?: Array<{
    question_id: string;
    trigger_answers: string[];
    modifier: number; // Multiplier applied (e.g., 1.2 = +20%)
  }>;
  /** Emotional signals from this answer */
  emotionSignals?: Record<string, string[]>;
}

/**
 * Default question configurations (can be overridden via args)
 * These are example quiz questions for health/wellness quiz
 */
const DEFAULT_QUESTION_CONFIG: Record<string, QuestionConfig> = {
  q_health_priority: {
    id: "q_health_priority",
    weight: 1.5,
    dimension: "motivation",
    values: {
      top_priority: 10,
      important: 7,
      somewhat: 4,
      not_priority: 1,
    },
    emotionSignals: {
      top_priority: ["determined", "motivated"],
      not_priority: ["skeptical", "resistant"],
    },
  },
  q_current_habits: {
    id: "q_current_habits",
    weight: 1.2,
    dimension: "readiness",
    values: {
      very_active: 10,
      moderately_active: 7,
      occasionally: 4,
      sedentary: 1,
    },
    interdependencies: [
      {
        question_id: "q_health_priority",
        trigger_answers: ["top_priority", "important"],
        modifier: 1.2, // Boost if motivation is high
      },
    ],
    emotionSignals: {
      very_active: ["confident", "accomplished"],
      sedentary: ["overwhelmed", "anxious"],
    },
  },
  q_knowledge_level: {
    id: "q_knowledge_level",
    weight: 1.0,
    dimension: "knowledge",
    values: {
      expert: 10,
      intermediate: 7,
      beginner: 4,
      novice: 1,
    },
    emotionSignals: {
      novice: ["curious", "uncertain"],
      expert: ["confident"],
    },
  },
  q_barriers: {
    id: "q_barriers",
    weight: 1.3,
    dimension: "barriers",
    values: {
      none: 10,
      time: 5,
      motivation: 4,
      knowledge: 6,
      resources: 5,
      multiple: 2,
    },
    interdependencies: [
      {
        question_id: "q_health_priority",
        trigger_answers: ["top_priority"],
        modifier: 1.3, // High priority can overcome barriers
      },
    ],
    emotionSignals: {
      none: ["confident", "ready"],
      motivation: ["frustrated", "stuck"],
      multiple: ["overwhelmed", "anxious"],
    },
  },
  q_support_preference: {
    id: "q_support_preference",
    weight: 0.8,
    dimension: "engagement",
    values: {
      community: 8,
      one_on_one: 9,
      self_guided: 6,
      hybrid: 10,
    },
    emotionSignals: {
      community: ["social", "belonging"],
      one_on_one: ["focused", "serious"],
      self_guided: ["independent", "self-reliant"],
    },
  },
};

/**
 * Dimension definitions for aggregating scores
 */
const DIMENSIONS = ["motivation", "readiness", "knowledge", "barriers", "engagement"];

/**
 * Emotion detection rules
 */
interface EmotionProfile {
  primary: string;
  secondary: string | null;
  confidence: number;
  all_detected: string[];
}

/**
 * Input args for audience.score_quiz
 */
export interface AudienceScoreQuizArgs {
  /** Quiz identifier */
  quiz_id: string;
  /** Quiz version (for tracking changes) */
  quiz_version?: string;
  /** Session ID for anonymous tracking */
  session_id: string;
  /** User ID if logged in */
  user_id?: string;
  /** Email if provided */
  email?: string;
  /** Answers object: { question_id: answer_value } */
  answers: Record<string, string | string[]>;
  /** Optional per-question metadata (time spent, etc.) */
  response_metadata?: Array<{
    question_id: string;
    answer: string | string[];
    time_spent_ms?: number;
  }>;
  /** Optional custom question configs (overrides defaults) */
  question_configs?: Record<string, QuestionConfig>;
  /** Source tracking */
  source?: string;
  source_url?: string;
  device_type?: "mobile" | "tablet" | "desktop";
}

/**
 * Output from audience.score_quiz
 */
export interface AudienceScoreQuizResult {
  response_id: string;
  quiz_id: string;
  session_id: string;
  raw_score: number;
  weighted_score: number;
  normalized_score: number;
  dimension_scores: Record<string, number>;
  interdependency_scores: Record<string, number>;
  emotional_profile: EmotionProfile;
  scoring_version: string;
  questions_answered: number;
  max_possible_score: number;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): AudienceScoreQuizArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  // Required: quiz_id
  if (!raw.quiz_id || typeof raw.quiz_id !== "string") {
    throw new Error("quiz_id is required and must be a string");
  }

  // Required: session_id
  if (!raw.session_id || typeof raw.session_id !== "string") {
    throw new Error("session_id is required and must be a string");
  }

  // Required: answers
  if (!raw.answers || typeof raw.answers !== "object") {
    throw new Error("answers is required and must be an object");
  }

  const answers = raw.answers as Record<string, unknown>;
  if (Object.keys(answers).length === 0) {
    throw new Error("answers must contain at least one answer");
  }

  // Validate each answer is string or string[]
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== "string" && !Array.isArray(value)) {
      throw new Error(`Answer for ${key} must be a string or array of strings`);
    }
  }

  return {
    quiz_id: raw.quiz_id as string,
    quiz_version: raw.quiz_version as string | undefined,
    session_id: raw.session_id as string,
    user_id: raw.user_id as string | undefined,
    email: raw.email as string | undefined,
    answers: answers as Record<string, string | string[]>,
    response_metadata: raw.response_metadata as AudienceScoreQuizArgs["response_metadata"],
    question_configs: raw.question_configs as Record<string, QuestionConfig> | undefined,
    source: raw.source as string | undefined,
    source_url: raw.source_url as string | undefined,
    device_type: raw.device_type as AudienceScoreQuizArgs["device_type"],
  };
}

/**
 * Calculate score for a single answer with interdependency modifiers
 */
function calculateAnswerScore(
  questionId: string,
  answer: string | string[],
  config: QuestionConfig,
  allAnswers: Record<string, string | string[]>
): { raw: number; weighted: number; modifier: number } {
  // Handle multi-select: sum values for all selected answers
  const answerValues: number[] = [];
  const answerKeys = Array.isArray(answer) ? answer : [answer];
  
  for (const ans of answerKeys) {
    const value = config.values[ans];
    if (value !== undefined) {
      answerValues.push(value);
    }
  }

  // If no valid answers found, return 0
  if (answerValues.length === 0) {
    return { raw: 0, weighted: 0, modifier: 1 };
  }

  // Average for multi-select, single value otherwise
  const rawScore = answerValues.reduce((sum, v) => sum + v, 0) / answerValues.length;

  // Calculate interdependency modifier
  let modifier = 1;
  if (config.interdependencies) {
    for (const dep of config.interdependencies) {
      const otherAnswer = allAnswers[dep.question_id];
      if (otherAnswer) {
        const otherAnswerKeys = Array.isArray(otherAnswer) ? otherAnswer : [otherAnswer];
        if (otherAnswerKeys.some((a) => dep.trigger_answers.includes(a))) {
          modifier *= dep.modifier;
        }
      }
    }
  }

  const weightedScore = rawScore * config.weight * modifier;

  return { raw: rawScore, weighted: weightedScore, modifier };
}

/**
 * Detect emotional profile from answers
 */
function detectEmotions(
  answers: Record<string, string | string[]>,
  questionConfigs: Record<string, QuestionConfig>
): EmotionProfile {
  const emotionCounts: Record<string, number> = {};

  for (const [questionId, answer] of Object.entries(answers)) {
    const config = questionConfigs[questionId];
    if (!config?.emotionSignals) continue;

    const answerKeys = Array.isArray(answer) ? answer : [answer];
    for (const ans of answerKeys) {
      const signals = config.emotionSignals[ans];
      if (signals) {
        for (const emotion of signals) {
          emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
        }
      }
    }
  }

  // Sort by count
  const sorted = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1]);
  
  const totalSignals = sorted.reduce((sum, [, count]) => sum + count, 0);
  
  const primary = sorted[0]?.[0] || "neutral";
  const secondary = sorted[1]?.[0] || null;
  const confidence = totalSignals > 0 
    ? Math.min(1, (sorted[0]?.[1] || 0) / Math.max(1, Object.keys(answers).length))
    : 0.5;

  return {
    primary,
    secondary,
    confidence: Math.round(confidence * 100) / 100,
    all_detected: sorted.map(([emotion]) => emotion),
  };
}

/**
 * Execute the quiz scoring
 */
async function run(
  args: AudienceScoreQuizArgs,
  ctx: ToolContext
): Promise<ToolResponse<AudienceScoreQuizResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

  // Merge default configs with any custom configs
  const questionConfigs = {
    ...DEFAULT_QUESTION_CONFIG,
    ...args.question_configs,
  };

  // Calculate scores
  let rawTotal = 0;
  let weightedTotal = 0;
  let maxPossibleScore = 0;
  const dimensionScores: Record<string, { total: number; count: number }> = {};
  const interdependencyScores: Record<string, number> = {};

  // Initialize dimensions
  for (const dim of DIMENSIONS) {
    dimensionScores[dim] = { total: 0, count: 0 };
  }

  // Score each answer
  for (const [questionId, answer] of Object.entries(args.answers)) {
    const config = questionConfigs[questionId];
    
    if (!config) {
      // Unknown question - skip but log
      continue;
    }

    const { raw, weighted, modifier } = calculateAnswerScore(
      questionId,
      answer,
      config,
      args.answers
    );

    rawTotal += raw;
    weightedTotal += weighted;

    // Track interdependency effects
    if (modifier !== 1) {
      interdependencyScores[questionId] = modifier;
    }

    // Add to dimension score
    if (config.dimension && dimensionScores[config.dimension]) {
      dimensionScores[config.dimension].total += weighted;
      dimensionScores[config.dimension].count += 1;
    }

    // Calculate max possible for this question
    const maxValue = Math.max(...Object.values(config.values));
    maxPossibleScore += maxValue * config.weight;
  }

  // Normalize score to 0-100
  const normalizedScore = maxPossibleScore > 0
    ? Math.round((weightedTotal / maxPossibleScore) * 100)
    : 0;

  // Finalize dimension scores (average)
  const finalDimensionScores: Record<string, number> = {};
  for (const [dim, { total, count }] of Object.entries(dimensionScores)) {
    finalDimensionScores[dim] = count > 0 
      ? Math.round((total / count) * 10) / 10 
      : 0;
  }

  // Detect emotional profile
  const emotionalProfile = detectEmotions(args.answers, questionConfigs);

  // Prepare responses array for storage
  const responsesArray = args.response_metadata || 
    Object.entries(args.answers).map(([question_id, answer]) => ({
      question_id,
      answer,
    }));

  // Calculate time spent if available
  const timeSpentSeconds = args.response_metadata
    ? Math.round(
        args.response_metadata.reduce((sum, r) => sum + (r.time_spent_ms || 0), 0) / 1000
      )
    : null;

  // Store the quiz response
  const { data: response, error } = await supabase
    .from("quiz_responses")
    .insert({
      org_id: orgId,
      quiz_id: args.quiz_id,
      quiz_version: args.quiz_version || "1.0",
      session_id: args.session_id,
      user_id: args.user_id || null,
      email: args.email || null,
      answers: args.answers,
      responses: responsesArray,
      raw_score: Math.round(rawTotal * 100) / 100,
      weighted_score: Math.round(weightedTotal * 100) / 100,
      normalized_score: normalizedScore,
      interdependency_scores: interdependencyScores,
      dimension_scores: finalDimensionScores,
      detected_emotions: emotionalProfile,
      status: "scored",
      completed_at: new Date().toISOString(),
      time_spent_seconds: timeSpentSeconds,
      source: args.source || null,
      source_url: args.source_url || null,
      device_type: args.device_type || null,
      metadata: {
        scoring_version: SCORING_VERSION,
        questions_answered: Object.keys(args.answers).length,
        max_possible_score: Math.round(maxPossibleScore * 100) / 100,
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to store quiz response: ${error.message}`);
  }

  return {
    data: {
      response_id: response.id,
      quiz_id: args.quiz_id,
      session_id: args.session_id,
      raw_score: Math.round(rawTotal * 100) / 100,
      weighted_score: Math.round(weightedTotal * 100) / 100,
      normalized_score: normalizedScore,
      dimension_scores: finalDimensionScores,
      interdependency_scores: interdependencyScores,
      emotional_profile: emotionalProfile,
      scoring_version: SCORING_VERSION,
      questions_answered: Object.keys(args.answers).length,
      max_possible_score: Math.round(maxPossibleScore * 100) / 100,
    },
    explainability: {
      reason: `Quiz scored with ${Object.keys(args.answers).length} answers. ` +
        `Normalized score: ${normalizedScore}/100. ` +
        `Primary emotion detected: ${emotionalProfile.primary}.`,
      org_id: orgId,
      dimensions_calculated: Object.keys(finalDimensionScores).filter(
        (k) => finalDimensionScores[k] > 0
      ),
      interdependencies_applied: Object.keys(interdependencyScores).length,
      emotion_confidence: emotionalProfile.confidence,
    },
  };
}

/**
 * Tool definition for audience.score_quiz
 */
export const audienceScoreQuizTool: ToolDefinition<
  AudienceScoreQuizArgs,
  AudienceScoreQuizResult
> = {
  name: "audience.score_quiz",
  description:
    "Score quiz responses with sliding interdependency scoring. " +
    "Calculates raw, weighted, and normalized scores (0-100). " +
    "Applies interdependency modifiers based on answer combinations. " +
    "Detects emotional profile from response patterns. " +
    "Stores the scored response and returns all calculated metrics.",
  writes: true,
  validateArgs,
  run,
};
