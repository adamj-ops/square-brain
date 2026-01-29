/**
 * Tool: brain.semantic_search
 *
 * Searches the brain knowledge base using semantic similarity (RAG).
 * Returns relevant chunks from indexed documents.
 *
 * Phase 5.1: RAG Semantic Search
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { search, type SemanticSearchResult } from "@/lib/rag/search";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const DEFAULT_THRESHOLD = 0.65;

/**
 * Input args for brain.semantic_search
 */
export interface BrainSemanticSearchArgs {
  /** The search query (natural language question or keywords) */
  query: string;
  /** Maximum number of results (default: 5, max: 20) */
  limit?: number;
  /** Minimum similarity threshold 0-1 (default: 0.65) */
  threshold?: number;
}

/**
 * A single search result (evidence-ready structure)
 */
export interface SearchResultItem {
  /** Chunk UUID for citations */
  chunk_id: string;
  /** Parent document UUID */
  doc_id: string;
  /** Document title */
  title: string;
  /** Relevant chunk content */
  content: string;
  /** Similarity score 0-1 */
  similarity: number;
  /** Source type (brain_item, upload, url, manual) */
  source_type: string;
  /** Source identifier (brain_item UUID, URL, filename) */
  source_id: string | null;
  /** Section title if available */
  section?: string;
}

/**
 * Output from brain.semantic_search
 */
export interface BrainSemanticSearchResult {
  /** Search results ordered by relevance */
  results: SearchResultItem[];
  /** Number of results found */
  count: number;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): BrainSemanticSearchArgs {
  if (args === null || args === undefined) {
    throw new Error("query is required");
  }

  if (typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  // query (required string)
  if (!raw.query || typeof raw.query !== "string") {
    throw new Error("query must be a non-empty string");
  }
  const query = raw.query.trim();
  if (query.length < 2) {
    throw new Error("query must be at least 2 characters");
  }

  const result: BrainSemanticSearchArgs = { query };

  // limit (optional number)
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) {
      throw new Error("limit must be a positive integer");
    }
    result.limit = Math.min(raw.limit, MAX_LIMIT);
  }

  // threshold (optional number)
  if (raw.threshold !== undefined) {
    if (typeof raw.threshold !== "number" || raw.threshold < 0 || raw.threshold > 1) {
      throw new Error("threshold must be a number between 0 and 1");
    }
    result.threshold = raw.threshold;
  }

  return result;
}

/**
 * Execute the semantic search
 */
async function run(
  args: BrainSemanticSearchArgs,
  ctx: ToolContext
): Promise<ToolResponse<BrainSemanticSearchResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const limit = args.limit ?? DEFAULT_LIMIT;
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  // Perform semantic search
  const searchResults = await search(args.query, orgId, {
    limit,
    threshold,
    hybrid: true, // Use hybrid search for better recall
  });

  // Transform results for the model (evidence-ready structure)
  const results: SearchResultItem[] = searchResults.map((r: SemanticSearchResult) => ({
    chunk_id: r.chunk_id,
    doc_id: r.doc_id,
    title: r.doc_title,
    content: r.content,
    similarity: Math.round(r.similarity * 100) / 100, // Round to 2 decimals
    source_type: r.doc_source_type,
    source_id: r.doc_source_id || null,
    section: r.metadata?.section_title as string | undefined,
  }));

  return {
    data: {
      results,
      count: results.length,
    },
    explainability: {
      search_query: args.query,
      threshold_used: threshold,
      limit_used: limit,
      results_count: results.length,
      top_similarity: results[0]?.similarity ?? 0,
      search_method: "hybrid",
    },
  };
}

/**
 * Tool definition for brain.semantic_search
 */
export const brainSemanticSearchTool: ToolDefinition<
  BrainSemanticSearchArgs,
  BrainSemanticSearchResult
> = {
  name: "brain.semantic_search",
  description:
    "Search the brain knowledge base using semantic similarity. " +
    "Use this to find relevant information by meaning, not just keyword matching. " +
    "Returns chunks of content ranked by relevance to your query. " +
    "ALWAYS use this before claiming information doesn't exist in the brain.",
  writes: false,
  validateArgs,
  run,
};
