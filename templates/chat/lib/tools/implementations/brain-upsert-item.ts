/**
 * Tool: brain.upsert_item
 *
 * Creates or updates a brain item.
 * This is a write tool - requires allowWrites=true.
 *
 * Phase 4: Tool Executor + Audit Logging
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import { validateBrainItemInput } from "@/lib/brain/items/validate";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import type { UpsertResult, BrainItemType } from "@/lib/brain/items/types";

/**
 * Input args for brain.upsert_item
 */
export interface BrainUpsertItemArgs {
  type: BrainItemType;
  title: string;
  content_md: string;
  tags?: string[];
  confidence_score?: number;
  canonical_key?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Output from brain.upsert_item
 */
export interface BrainUpsertItemResult {
  id: string;
  version: number;
}

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): BrainUpsertItemArgs {
  const validation = validateBrainItemInput(args);

  if (!validation.valid || !validation.data) {
    const messages = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new Error(`Validation failed: ${messages}`);
  }

  // Return the validated/sanitized data
  return {
    type: validation.data.type,
    title: validation.data.title,
    content_md: validation.data.content_md,
    tags: validation.data.tags,
    confidence_score: validation.data.confidence_score,
    canonical_key: validation.data.canonical_key,
    metadata: validation.data.metadata,
  };
}

/**
 * Execute the upsert operation
 */
async function run(
  args: BrainUpsertItemArgs,
  ctx: ToolContext
): Promise<ToolResponse<BrainUpsertItemResult>> {
  const supabase = getServiceSupabase();
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  let result: UpsertResult;

  if (args.canonical_key) {
    // Upsert by canonical_key
    result = await upsertByCanonicalKey(supabase, orgId, args);
  } else {
    // Insert new row
    result = await insertNew(supabase, orgId, args);
  }

  return {
    data: result,
    explainability: {
      reason: "Brain item persisted for future recall and context",
      confidence_score: args.confidence_score ?? 0.75,
      tags: args.tags ?? [],
      type: args.type,
      canonical_key: args.canonical_key ?? null,
      is_update: result.version > 1,
    },
  };
}

/**
 * Upsert by canonical_key - updates if exists, inserts if not
 */
async function upsertByCanonicalKey(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  args: BrainUpsertItemArgs
): Promise<UpsertResult> {
  // Check if exists
  const { data: existing, error: selectError } = await supabase
    .from("brain_items")
    .select("id, version")
    .eq("org_id", orgId)
    .eq("canonical_key", args.canonical_key!)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Select failed: ${selectError.message}`);
  }

  if (existing) {
    // Update existing
    const newVersion = existing.version + 1;
    const { error: updateError } = await supabase
      .from("brain_items")
      .update({
        type: args.type,
        title: args.title,
        content_md: args.content_md,
        tags: args.tags || [],
        confidence_score: args.confidence_score ?? 0.75,
        metadata: args.metadata || {},
        version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Update failed: ${updateError.message}`);
    }

    return { id: existing.id, version: newVersion };
  } else {
    // Insert new with canonical_key
    return insertNew(supabase, orgId, args);
  }
}

/**
 * Insert a new brain item
 */
async function insertNew(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  args: BrainUpsertItemArgs
): Promise<UpsertResult> {
  const { data, error } = await supabase
    .from("brain_items")
    .insert({
      org_id: orgId,
      type: args.type,
      title: args.title,
      content_md: args.content_md,
      tags: args.tags || [],
      confidence_score: args.confidence_score ?? 0.75,
      canonical_key: args.canonical_key || null,
      metadata: args.metadata || {},
    })
    .select("id, version")
    .single();

  if (error) {
    throw new Error(`Insert failed: ${error.message}`);
  }

  return { id: data.id, version: data.version };
}

/**
 * Tool definition for brain.upsert_item
 */
export const brainUpsertItemTool: ToolDefinition<
  BrainUpsertItemArgs,
  BrainUpsertItemResult
> = {
  name: "brain.upsert_item",
  description:
    "Creates or updates a brain item (decision, SOP, principle, playbook). " +
    "If canonical_key is provided, upserts by (org_id, canonical_key). " +
    "Otherwise, inserts a new row.",
  writes: true,
  validateArgs,
  run,
};
