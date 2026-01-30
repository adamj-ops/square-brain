import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { isValidBrainItemType } from "@/lib/brain/items/validate";
import type { BrainItemSearchResult } from "@/lib/brain/items/types";
import { createApiError, getErrorMessage } from "@/lib/api/errors";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const EXCERPT_LENGTH = 200;

/**
 * GET /api/internal/brain/search
 * 
 * Search/list brain items with optional filters.
 * 
 * Query params:
 * - query: text search over title/content_md (ilike)
 * - type: filter by type (decision|sop|principle|playbook)
 * - tag: filter by tag (exact match in array)
 * - limit: max results (default 20, max 100)
 * - offset: pagination offset (default 0)
 * 
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
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

    const { searchParams } = new URL(req.url);
    
    // Parse query params
    const query = searchParams.get("query")?.trim() || undefined;
    const type = searchParams.get("type") || undefined;
    const tag = searchParams.get("tag")?.trim().toLowerCase() || undefined;
    const limitStr = searchParams.get("limit");
    const offsetStr = searchParams.get("offset");

    // Validate type if provided
    if (type && !isValidBrainItemType(type)) {
      return createApiError(
        "VALIDATION_ERROR",
        "Invalid type. Must be one of: decision, sop, principle, playbook",
        { field: "type", value: type, allowed: ["decision", "sop", "principle", "playbook"] }
      );
    }

    // Parse limit/offset
    let limit = DEFAULT_LIMIT;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, MAX_LIMIT);
      }
    }

    let offset = 0;
    if (offsetStr) {
      const parsed = parseInt(offsetStr, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        offset = parsed;
      }
    }

    const supabase = getServiceSupabase();

    // Build query
    let dbQuery = supabase
      .from("brain_items")
      .select("id, type, title, content_md, tags, confidence_score, updated_at")
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (type) {
      dbQuery = dbQuery.eq("type", type);
    }

    if (tag) {
      dbQuery = dbQuery.contains("tags", [tag]);
    }

    if (query) {
      // Search title and content_md with ilike
      // Supabase doesn't support OR in a clean way with the query builder,
      // so we use the or filter
      dbQuery = dbQuery.or(`title.ilike.%${query}%,content_md.ilike.%${query}%`);
    }

    const { data, error } = await dbQuery;

    if (error) {
      return createApiError(
        "INTERNAL_ERROR",
        "Search failed",
        { dbError: error.message }
      );
    }

    // Transform results with excerpts
    const items: BrainItemSearchResult[] = (data || []).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      excerpt: createExcerpt(item.content_md, query),
      tags: item.tags,
      confidence_score: item.confidence_score,
      updated_at: item.updated_at,
    }));

    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    console.error("[brain/search] Error:", err);
    return createApiError(
      "INTERNAL_ERROR",
      "An unexpected error occurred during search",
      { originalError: getErrorMessage(err) }
    );
  }
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
