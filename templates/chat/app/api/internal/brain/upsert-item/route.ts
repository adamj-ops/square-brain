import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { validateBrainItemInput } from "@/lib/brain/items/validate";
import type { UpsertResult } from "@/lib/brain/items/types";
import { createApiError, getErrorMessage } from "@/lib/api/errors";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * POST /api/internal/brain/upsert-item
 * 
 * Creates or updates a brain item.
 * If canonical_key is provided, upserts by (org_id, canonical_key).
 * Otherwise, inserts a new row.
 * 
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify internal secret
    const secret = req.headers.get("X-Internal-Secret");
    if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
      return createApiError(
        "UNAUTHORIZED",
        "Invalid or missing X-Internal-Secret header",
        { header: "X-Internal-Secret" }
      );
    }

    if (!DEFAULT_ORG_ID) {
      return createApiError(
        "CONFIGURATION_ERROR",
        "DEFAULT_ORG_ID not configured",
        { field: "DEFAULT_ORG_ID" }
      );
    }

    // Parse body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return createApiError(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "{ type, title, content_md, ... }" }
      );
    }

    // Validate input
    const validation = validateBrainItemInput(body);
    if (!validation.valid || !validation.data) {
      return createApiError(
        "VALIDATION_ERROR",
        "Validation failed",
        { errors: validation.errors }
      );
    }

    const input = validation.data;
    const orgId = input.org_id || DEFAULT_ORG_ID;

    const supabase = getServiceSupabase();

    let result: UpsertResult;

    if (input.canonical_key) {
      // Upsert by canonical_key
      result = await upsertByCanonicalKey(supabase, orgId, input);
    } else {
      // Insert new row
      result = await insertNew(supabase, orgId, input);
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[brain/upsert-item] Error:", err);
    return createApiError(
      "INTERNAL_ERROR",
      "Failed to upsert brain item",
      { originalError: getErrorMessage(err) }
    );
  }
}

/**
 * Upsert by canonical_key - updates if exists, inserts if not
 */
async function upsertByCanonicalKey(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  input: NonNullable<ReturnType<typeof validateBrainItemInput>["data"]>
): Promise<UpsertResult> {
  // Check if exists
  const { data: existing, error: selectError } = await supabase
    .from("brain_items")
    .select("id, version")
    .eq("org_id", orgId)
    .eq("canonical_key", input.canonical_key!)
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
        type: input.type,
        title: input.title,
        content_md: input.content_md,
        tags: input.tags || [],
        confidence_score: input.confidence_score ?? 0.75,
        source: input.source || null,
        metadata: input.metadata || {},
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
    return insertNew(supabase, orgId, input);
  }
}

/**
 * Insert a new brain item
 */
async function insertNew(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  input: NonNullable<ReturnType<typeof validateBrainItemInput>["data"]>
): Promise<UpsertResult> {
  const { data, error } = await supabase
    .from("brain_items")
    .insert({
      org_id: orgId,
      type: input.type,
      title: input.title,
      content_md: input.content_md,
      tags: input.tags || [],
      confidence_score: input.confidence_score ?? 0.75,
      source: input.source || null,
      canonical_key: input.canonical_key || null,
      metadata: input.metadata || {},
    })
    .select("id, version")
    .single();

  if (error) {
    throw new Error(`Insert failed: ${error.message}`);
  }

  return { id: data.id, version: data.version };
}
