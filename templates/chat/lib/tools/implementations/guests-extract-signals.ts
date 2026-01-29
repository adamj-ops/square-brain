/**
 * Tool: guests.extract_signals
 *
 * Extracts and stores signals/evidence about a guest.
 * Signals are used for scoring and ranking guests.
 * Pipeline 1: Guest Intelligence
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Valid signal types
 */
const SIGNAL_TYPES = [
  "expertise",      // Demonstrated expertise
  "achievement",    // Notable accomplishment
  "media_mention",  // Press/media coverage
  "social_proof",   // Followers, engagement
  "content",        // Published content (books, articles)
  "speaking",       // Speaking engagements
  "endorsement",    // Recommendations
  "controversy",    // Potentially negative signal
  "availability",   // Scheduling/availability signal
  "engagement",     // Response/engagement with outreach
  "other",
] as const;

type SignalType = typeof SIGNAL_TYPES[number];

/**
 * A single signal to extract
 */
interface SignalInput {
  /** Signal type */
  type: SignalType;
  /** Brief description */
  title: string;
  /** Detailed description */
  description?: string;
  /** Link to evidence */
  evidence_url?: string;
  /** Quoted text as evidence */
  evidence_text?: string;
  /** Weight (-1 to 1, negative for red flags) */
  weight?: number;
  /** Confidence in the signal (0-1) */
  confidence?: number;
  /** Source where signal was found */
  source?: string;
  /** When signal occurred */
  signal_date?: string;
}

/**
 * Input args for guests.extract_signals
 */
export interface GuestExtractSignalsArgs {
  /** Guest ID to add signals to */
  guest_id: string;
  /** Array of signals to extract */
  signals: SignalInput[];
}

/**
 * Output from guests.extract_signals
 */
export interface GuestExtractSignalsResult {
  guest_id: string;
  signals_added: number;
  signal_ids: string[];
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): GuestExtractSignalsArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.guest_id || typeof raw.guest_id !== "string") {
    throw new Error("guest_id is required and must be a string");
  }

  if (!raw.signals || !Array.isArray(raw.signals)) {
    throw new Error("signals must be an array");
  }

  if (raw.signals.length === 0) {
    throw new Error("signals array cannot be empty");
  }

  if (raw.signals.length > 20) {
    throw new Error("Maximum 20 signals per call");
  }

  // Validate each signal
  const signals: SignalInput[] = [];
  for (let i = 0; i < raw.signals.length; i++) {
    const s = raw.signals[i] as Record<string, unknown>;
    
    if (!s.type || !SIGNAL_TYPES.includes(s.type as SignalType)) {
      throw new Error(
        `signals[${i}].type must be one of: ${SIGNAL_TYPES.join(", ")}`
      );
    }

    if (!s.title || typeof s.title !== "string") {
      throw new Error(`signals[${i}].title is required`);
    }

    signals.push({
      type: s.type as SignalType,
      title: s.title,
      description: s.description as string | undefined,
      evidence_url: s.evidence_url as string | undefined,
      evidence_text: s.evidence_text as string | undefined,
      weight: s.weight !== undefined ? Number(s.weight) : 0.5,
      confidence: s.confidence !== undefined ? Number(s.confidence) : 0.5,
      source: s.source as string | undefined,
      signal_date: s.signal_date as string | undefined,
    });
  }

  return {
    guest_id: raw.guest_id,
    signals,
  };
}

/**
 * Execute the signal extraction
 */
async function run(
  args: GuestExtractSignalsArgs,
  ctx: ToolContext
): Promise<ToolResponse<GuestExtractSignalsResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

  // Verify guest exists
  const { data: guest } = await supabase
    .from("guests")
    .select("id, name")
    .eq("id", args.guest_id)
    .eq("org_id", orgId)
    .single();

  if (!guest) {
    throw new Error(`Guest not found: ${args.guest_id}`);
  }

  // Insert signals
  const signalRows = args.signals.map((s) => ({
    guest_id: args.guest_id,
    org_id: orgId,
    signal_type: s.type,
    title: s.title,
    description: s.description,
    evidence_url: s.evidence_url,
    evidence_text: s.evidence_text,
    weight: Math.max(-1, Math.min(1, s.weight || 0.5)),
    confidence: Math.max(0, Math.min(1, s.confidence || 0.5)),
    source: s.source,
    signal_date: s.signal_date ? new Date(s.signal_date).toISOString().split("T")[0] : null,
    extracted_by: "ai",
    metadata: {},
  }));

  const { data: inserted, error } = await supabase
    .from("guest_signals")
    .insert(signalRows)
    .select("id");

  if (error) {
    throw new Error(`Failed to insert signals: ${error.message}`);
  }

  const signalIds = (inserted || []).map((s) => s.id);

  return {
    data: {
      guest_id: args.guest_id,
      signals_added: signalIds.length,
      signal_ids: signalIds,
    },
    explainability: {
      guest_name: guest.name,
      signal_types: args.signals.map((s) => s.type),
      positive_signals: args.signals.filter((s) => (s.weight || 0.5) > 0).length,
      negative_signals: args.signals.filter((s) => (s.weight || 0.5) < 0).length,
    },
  };
}

/**
 * Tool definition for guests.extract_signals
 */
export const guestsExtractSignalsTool: ToolDefinition<
  GuestExtractSignalsArgs,
  GuestExtractSignalsResult
> = {
  name: "guests.extract_signals",
  description:
    "Extract and store signals/evidence about a guest for scoring. " +
    "Signals include expertise, achievements, media mentions, social proof, " +
    "content, speaking engagements, and more. Each signal has a weight (-1 to 1) " +
    "and confidence (0-1). Negative weights indicate red flags or concerns.",
  writes: true,
  validateArgs,
  run,
};
