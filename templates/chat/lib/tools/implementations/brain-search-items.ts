/**
 * Tool: brain.search_items
 *
 * Searches brain items with optional filters.
 * This is a read-only tool - does not require allowWrites.
 *
 * Phase 4: Tool Executor + Audit Logging
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import { isValidBrainItemType } from "@/lib/brain/items/validate";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import type { BrainItemType, BrainItemSearchResult } from "@/lib/brain/items/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const EXCERPT_LENGTH = 200;

/**
 * Input args for brain.search_items
 */
export interface BrainSearchItemsArgs {
  query?: string;
  type?: BrainItemType;
  tag?: string;
  limit?: number;
}

/**
 * Output from brain.search_items
 */
export interface BrainSearchItemsResult {
  items: BrainItemSearchResult[];
}

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): BrainSearchItemsArgs {
  if (args === null || args === undefined) {
    return {}; // All params optional
  }

  if (typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;
  const result: BrainSearchItemsArgs = {};

  // query (optional string)
  if (raw.query !== undefined) {
    if (typeof raw.query !== "string") {
      throw new Error("query must be a string");
    }
    result.query = raw.query.trim() || undefined;
  }

  // type (optional, must be valid BrainItemType)
  if (raw.type !== undefined) {
    if (!isValidBrainItemType(raw.type)) {
      throw new Error("type must be one of: decision, sop, principle, playbook");
    }
    result.type = raw.type;
  }

  // tag (optional string)
  if (raw.tag !== undefined) {
    if (typeof raw.tag !== "string") {
      throw new Error("tag must be a string");
    }
    result.tag = raw.tag.trim().toLowerCase() || undefined;
  }

  // limit (optional number)
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) {
      throw new Error("limit must be a positive integer");
    }
    result.limit = Math.min(raw.limit, MAX_LIMIT);
  }

  return result;
}

/**
 * Execute the search operation
 */
async function run(
  args: BrainSearchItemsArgs,
  ctx: ToolContext
): Promise<ToolResponse<BrainSearchItemsResult>> {
  const supabase = getServiceSupabase();
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const limit = args.limit ?? DEFAULT_LIMIT;

  // Build query
  let dbQuery = supabase
    .from("brain_items")
    .select("id, type, title, content_md, tags, confidence_score, updated_at")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(limit);

  // Apply filters
  if (args.type) {
    dbQuery = dbQuery.eq("type", args.type);
  }

  if (args.tag) {
    dbQuery = dbQuery.contains("tags", [args.tag]);
  }

  if (args.query) {
    // Search title and content_md with ilike
    dbQuery = dbQuery.or(`title.ilike.%${args.query}%,content_md.ilike.%${args.query}%`);
  }

  const { data, error } = await dbQuery;

  if (error) {
    throw new Error(`Search failed: ${error.message}`);
  }

  // Transform results with excerpts
  const items: BrainItemSearchResult[] = (data || []).map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    excerpt: createExcerpt(item.content_md, args.query),
    tags: item.tags,
    confidence_score: item.confidence_score,
    updated_at: item.updated_at,
  }));

  return {
    data: { items },
    explainability: {
      search_params: {
        query: args.query ?? null,
        type: args.type ?? null,
        tag: args.tag ?? null,
        limit,
      },
      results_count: items.length,
    },
  };
}

/**
 * Create an excerpt from content, optionally highlighting around query match
 */
function createExcerpt(content: string, query?: string): string {
  if (!content) return "";

  // If query provided, try to find it and excerpt around it
  if (query) {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);

    if (matchIndex !== -1) {
      // Excerpt around the match
      const start = Math.max(0, matchIndex - 50);
      const end = Math.min(content.length, matchIndex + query.length + 150);
      let excerpt = content.slice(start, end);

      if (start > 0) excerpt = "..." + excerpt;
      if (end < content.length) excerpt = excerpt + "...";

      return excerpt;
    }
  }

  // Default: first N characters
  if (content.length <= EXCERPT_LENGTH) {
    return content;
  }

  return content.slice(0, EXCERPT_LENGTH) + "...";
}

/**
 * Tool definition for brain.search_items
 */
export const brainSearchItemsTool: ToolDefinition<
  BrainSearchItemsArgs,
  BrainSearchItemsResult
> = {
  name: "brain.search_items",
  description:
    "Searches brain items with optional filters. " +
    "Supports query text search (ilike on title/content), type filter, and tag filter.",
  writes: false,
  validateArgs,
  run,
};
