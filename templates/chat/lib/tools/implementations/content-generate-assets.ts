/**
 * Tool: content.generate_assets
 *
 * Generates content asset ideas from interviews and quotes.
 * Asset types: quote cards, carousel outlines, shortform scripts, audio bites.
 * Pipeline 3: Content Repurposing
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Valid asset types
 */
const ASSET_TYPES = [
  "quote_card",
  "carousel",
  "shortform_script",
  "audio_bite",
  "thread",
  "blog_outline",
  "newsletter",
  "linkedin_post",
  "youtube_short",
  "tiktok",
] as const;

type AssetType = typeof ASSET_TYPES[number];

/**
 * A single asset to generate
 */
interface AssetInput {
  /** Asset type */
  type: AssetType;
  /** Asset title */
  title: string;
  /** Structured content (varies by type) */
  content: Record<string, unknown>;
  /** Preview/summary text */
  preview_text?: string;
  /** Target platform */
  target_platform?: string;
  /** Quality score (0-1) */
  quality_score?: number;
  /** Relevance score (0-1) */
  relevance_score?: number;
  /** Tags */
  tags?: string[];
  /** Theme slugs */
  themes?: string[];
}

/**
 * Input args for content.generate_assets
 */
export interface ContentGenerateAssetsArgs {
  /** Interview ID (optional - for context) */
  interview_id?: string;
  /** Quote ID (optional - for quote-based assets) */
  quote_id?: string;
  /** Array of assets to generate */
  assets: AssetInput[];
}

/**
 * Generated asset result
 */
interface GeneratedAsset {
  asset_id: string;
  type: AssetType;
  title: string;
  slug: string;
  status: string;
}

/**
 * Output from content.generate_assets
 */
export interface ContentGenerateAssetsResult {
  assets_created: number;
  assets: GeneratedAsset[];
  interview_id?: string;
  quote_id?: string;
}

/**
 * Generate URL-safe slug from title and type
 */
function generateSlug(title: string, type: string): string {
  const base = `${type}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
  
  // Add timestamp for uniqueness
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): ContentGenerateAssetsArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.assets || !Array.isArray(raw.assets)) {
    throw new Error("assets must be an array");
  }

  if (raw.assets.length === 0) {
    throw new Error("assets array cannot be empty");
  }

  if (raw.assets.length > 10) {
    throw new Error("Maximum 10 assets per call");
  }

  // Validate each asset
  const assets: AssetInput[] = [];
  for (let i = 0; i < raw.assets.length; i++) {
    const a = raw.assets[i] as Record<string, unknown>;

    if (!a.type || !ASSET_TYPES.includes(a.type as AssetType)) {
      throw new Error(
        `assets[${i}].type must be one of: ${ASSET_TYPES.join(", ")}`
      );
    }

    if (!a.title || typeof a.title !== "string") {
      throw new Error(`assets[${i}].title is required`);
    }

    if (!a.content || typeof a.content !== "object") {
      throw new Error(`assets[${i}].content is required and must be an object`);
    }

    assets.push({
      type: a.type as AssetType,
      title: a.title,
      content: a.content as Record<string, unknown>,
      preview_text: a.preview_text as string | undefined,
      target_platform: a.target_platform as string | undefined,
      quality_score: a.quality_score !== undefined ? Number(a.quality_score) : 0.5,
      relevance_score: a.relevance_score !== undefined ? Number(a.relevance_score) : 0.5,
      tags: a.tags as string[] | undefined,
      themes: a.themes as string[] | undefined,
    });
  }

  return {
    interview_id: raw.interview_id as string | undefined,
    quote_id: raw.quote_id as string | undefined,
    assets,
  };
}

/**
 * Execute the asset generation
 */
async function run(
  args: ContentGenerateAssetsArgs,
  ctx: ToolContext
): Promise<ToolResponse<ContentGenerateAssetsResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();
  const generatedAssets: GeneratedAsset[] = [];

  // Verify interview if provided
  if (args.interview_id) {
    const { data: interview } = await supabase
      .from("interviews")
      .select("id")
      .eq("id", args.interview_id)
      .eq("org_id", orgId)
      .single();

    if (!interview) {
      throw new Error(`Interview not found: ${args.interview_id}`);
    }
  }

  // Verify quote if provided
  if (args.quote_id) {
    const { data: quote } = await supabase
      .from("interview_quotes")
      .select("id")
      .eq("id", args.quote_id)
      .eq("org_id", orgId)
      .single();

    if (!quote) {
      throw new Error(`Quote not found: ${args.quote_id}`);
    }
  }

  // Create assets
  for (const asset of args.assets) {
    const slug = generateSlug(asset.title, asset.type);

    const { data: created, error } = await supabase
      .from("content_assets")
      .insert({
        org_id: orgId,
        interview_id: args.interview_id,
        quote_id: args.quote_id,
        title: asset.title,
        slug,
        asset_type: asset.type,
        content: asset.content,
        preview_text: asset.preview_text,
        status: "draft",
        quality_score: Math.max(0, Math.min(1, asset.quality_score || 0.5)),
        relevance_score: Math.max(0, Math.min(1, asset.relevance_score || 0.5)),
        target_platform: asset.target_platform,
        tags: asset.tags || [],
        themes: asset.themes || [],
        generated_by: "ai",
      })
      .select("id, status")
      .single();

    if (error || !created) {
      console.error(`Failed to create asset "${asset.title}":`, error?.message);
      continue;
    }

    generatedAssets.push({
      asset_id: created.id,
      type: asset.type,
      title: asset.title,
      slug,
      status: created.status,
    });
  }

  return {
    data: {
      assets_created: generatedAssets.length,
      assets: generatedAssets,
      interview_id: args.interview_id,
      quote_id: args.quote_id,
    },
    explainability: {
      requested_count: args.assets.length,
      created_count: generatedAssets.length,
      asset_types: args.assets.map((a) => a.type),
      has_interview_context: !!args.interview_id,
      has_quote_context: !!args.quote_id,
    },
  };
}

/**
 * Tool definition for content.generate_assets
 */
export const contentGenerateAssetsTool: ToolDefinition<
  ContentGenerateAssetsArgs,
  ContentGenerateAssetsResult
> = {
  name: "content.generate_assets",
  description:
    "Generate content assets from interviews and quotes for repurposing. " +
    "Asset types include: quote cards, carousel outlines, shortform scripts, audio bites, " +
    "threads, blog outlines, newsletter segments, and platform-specific posts. " +
    "Each asset has structured content based on its type.",
  writes: true,
  validateArgs,
  run,
};
