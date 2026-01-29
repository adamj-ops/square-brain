/**
 * Tool: themes.upsert_theme
 *
 * Creates or updates a theme for categorizing content.
 * Pipeline 2: Interview Intelligence
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Generate URL-safe slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Input args for themes.upsert_theme
 */
export interface ThemesUpsertThemeArgs {
  /** Theme name */
  name: string;
  /** Optional custom slug (auto-generated if not provided) */
  slug?: string;
  /** Theme description */
  description?: string;
  /** Category (e.g., "product", "culture", "process", "strategy") */
  category?: string;
  /** Confidence score (0-1) */
  confidence_score?: number;
}

/**
 * Output from themes.upsert_theme
 */
export interface ThemesUpsertThemeResult {
  theme_id: string;
  name: string;
  slug: string;
  status: "created" | "updated";
  mention_count: number;
  evidence_count: number;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): ThemesUpsertThemeArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("name is required and must be a string");
  }

  if (raw.name.length < 2) {
    throw new Error("name must be at least 2 characters");
  }

  return {
    name: raw.name,
    slug: raw.slug as string | undefined,
    description: raw.description as string | undefined,
    category: raw.category as string | undefined,
    confidence_score: raw.confidence_score !== undefined ? Number(raw.confidence_score) : undefined,
  };
}

/**
 * Execute the theme upsert
 */
async function run(
  args: ThemesUpsertThemeArgs,
  ctx: ToolContext
): Promise<ToolResponse<ThemesUpsertThemeResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();
  const slug = args.slug || generateSlug(args.name);

  // Try to find existing theme
  const { data: existing } = await supabase
    .from("themes")
    .select("id, mention_count, evidence_count")
    .eq("org_id", orgId)
    .eq("slug", slug)
    .single();

  let themeId: string;
  let isNew = false;
  let mentionCount = 0;
  let evidenceCount = 0;

  if (existing) {
    // Update existing theme
    const { error: updateError } = await supabase
      .from("themes")
      .update({
        name: args.name,
        description: args.description || undefined,
        category: args.category || undefined,
        confidence_score: args.confidence_score !== undefined 
          ? Math.max(0, Math.min(1, args.confidence_score)) 
          : undefined,
        mention_count: existing.mention_count + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update theme: ${updateError.message}`);
    }

    themeId = existing.id;
    mentionCount = existing.mention_count + 1;
    evidenceCount = existing.evidence_count;
  } else {
    // Create new theme
    const { data: newTheme, error: insertError } = await supabase
      .from("themes")
      .insert({
        org_id: orgId,
        name: args.name,
        slug,
        description: args.description,
        category: args.category,
        confidence_score: args.confidence_score !== undefined 
          ? Math.max(0, Math.min(1, args.confidence_score)) 
          : 0.5,
        mention_count: 1,
        evidence_count: 0,
        status: "active",
      })
      .select("id")
      .single();

    if (insertError || !newTheme) {
      throw new Error(`Failed to create theme: ${insertError?.message}`);
    }

    themeId = newTheme.id;
    isNew = true;
    mentionCount = 1;
  }

  return {
    data: {
      theme_id: themeId,
      name: args.name,
      slug,
      status: isNew ? "created" : "updated",
      mention_count: mentionCount,
      evidence_count: evidenceCount,
    },
    explainability: {
      operation: isNew ? "created_new_theme" : "updated_existing_theme",
      category: args.category || "uncategorized",
      has_description: !!args.description,
    },
  };
}

/**
 * Tool definition for themes.upsert_theme
 */
export const themesUpsertThemeTool: ToolDefinition<
  ThemesUpsertThemeArgs,
  ThemesUpsertThemeResult
> = {
  name: "themes.upsert_theme",
  description:
    "Create or update a theme for categorizing content across interviews. " +
    "Themes help identify recurring topics, expertise areas, and patterns. " +
    "Categories can be: product, culture, process, strategy, or custom.",
  writes: true,
  validateArgs,
  run,
};
