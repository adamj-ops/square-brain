/**
 * Tool: themes.upsert_theme
 *
 * Creates or updates a theme in the knowledge system.
 * This is a write tool - requires allowWrites=true.
 *
 * Pipeline 2: Interview Intelligence
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Valid theme categories
 */
const THEME_CATEGORIES = [
  "product",
  "culture",
  "process",
  "strategy",
  "technical",
  "customer",
  "growth",
  "operations",
  "other",
] as const;
type ThemeCategory = (typeof THEME_CATEGORIES)[number];

/**
 * Input args for themes.upsert_theme
 */
export interface ThemesUpsertThemeArgs {
  // Required
  name: string;

  // Optional identification
  slug?: string; // Auto-generated from name if not provided

  // Content
  description?: string;
  category?: ThemeCategory;

  // Metrics (optional override)
  confidence_score?: number; // 0-1

  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Output from themes.upsert_theme
 */
export interface ThemesUpsertThemeResult {
  theme_id: string;
  slug: string;
  is_new: boolean;
  mention_count: number;
  evidence_count: number;
}

/**
 * Generate URL-safe slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);
}

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): ThemesUpsertThemeArgs {
  if (!args || typeof args !== "object") {
    throw new Error("Args must be an object");
  }

  const input = args as Record<string, unknown>;

  // Required: name
  if (!input.name || typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("name is required and must be a non-empty string");
  }

  // Validate category if provided
  if (input.category && !THEME_CATEGORIES.includes(input.category as ThemeCategory)) {
    throw new Error(`category must be one of: ${THEME_CATEGORIES.join(", ")}`);
  }

  // Validate confidence_score range
  if (input.confidence_score !== undefined) {
    const score = Number(input.confidence_score);
    if (isNaN(score) || score < 0 || score > 1) {
      throw new Error("confidence_score must be a number between 0 and 1");
    }
  }

  return {
    name: (input.name as string).trim(),
    slug: input.slug ? (input.slug as string).trim() : undefined,
    description: input.description ? (input.description as string).trim() : undefined,
    category: input.category as ThemeCategory | undefined,
    confidence_score: input.confidence_score !== undefined ? Number(input.confidence_score) : undefined,
    metadata: input.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Execute the upsert operation
 */
async function run(
  args: ThemesUpsertThemeArgs,
  ctx: ToolContext
): Promise<ToolResponse<ThemesUpsertThemeResult>> {
  const supabase = getServiceSupabase();
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const slug = args.slug || generateSlug(args.name);
  let themeId: string;
  let isNew = false;
  let mentionCount = 0;
  let evidenceCount = 0;

  // Check for existing theme
  const { data: existing, error: selectError } = await supabase
    .from("themes")
    .select("id, mention_count, evidence_count")
    .eq("org_id", orgId)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to check existing theme: ${selectError.message}`);
  }

  if (existing) {
    // Update existing theme
    themeId = existing.id;
    mentionCount = existing.mention_count + 1;
    evidenceCount = existing.evidence_count;

    const updateData: Record<string, unknown> = {
      name: args.name,
      last_seen_at: new Date().toISOString(),
      mention_count: mentionCount,
    };

    // Only update fields that are provided
    if (args.description !== undefined) updateData.description = args.description;
    if (args.category !== undefined) updateData.category = args.category;
    if (args.confidence_score !== undefined) updateData.confidence_score = args.confidence_score;
    if (args.metadata !== undefined) {
      // Merge metadata
      updateData.metadata = args.metadata;
    }

    const { error: updateError } = await supabase
      .from("themes")
      .update(updateData)
      .eq("id", themeId);

    if (updateError) {
      throw new Error(`Failed to update theme: ${updateError.message}`);
    }
  } else {
    // Insert new theme
    isNew = true;
    mentionCount = 1;

    const { data: newTheme, error: insertError } = await supabase
      .from("themes")
      .insert({
        org_id: orgId,
        name: args.name,
        slug,
        description: args.description || null,
        category: args.category || "other",
        confidence_score: args.confidence_score ?? 0.5,
        mention_count: 1,
        evidence_count: 0,
        status: "active",
        metadata: args.metadata || {},
      })
      .select("id")
      .single();

    if (insertError) {
      // Handle race condition (duplicate slug)
      if (insertError.code === "23505") {
        const { data: raced } = await supabase
          .from("themes")
          .select("id, mention_count, evidence_count")
          .eq("org_id", orgId)
          .eq("slug", slug)
          .single();

        if (raced) {
          return {
            data: {
              theme_id: raced.id,
              slug,
              is_new: false,
              mention_count: raced.mention_count,
              evidence_count: raced.evidence_count,
            },
            explainability: {
              reason: "Theme created by another process (race condition handled)",
              slug,
              org_id: orgId,
            },
          };
        }
      }
      throw new Error(`Failed to create theme: ${insertError.message}`);
    }

    themeId = newTheme.id;
  }

  return {
    data: {
      theme_id: themeId,
      slug,
      is_new: isNew,
      mention_count: mentionCount,
      evidence_count: evidenceCount,
    },
    explainability: {
      reason: isNew ? "Created new theme" : "Updated existing theme",
      slug,
      org_id: orgId,
      category: args.category || "other",
      description_provided: !!args.description,
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
    "Creates or updates a theme in the knowledge system. " +
    "Themes represent recurring patterns, topics, or areas of expertise extracted from content. " +
    "If a theme with the same slug exists, it will be updated; otherwise a new theme is created.",
  writes: true,
  validateArgs,
  run,
};
