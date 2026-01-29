/**
 * Semantic Search Service
 *
 * Searches the RAG system using vector similarity.
 * Phase 5.1: RAG Semantic Search
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import { embedText } from "./embedder";

export interface SemanticSearchResult {
  chunk_id: string;
  doc_id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
  doc_title: string;
  doc_source_type: string;
  doc_source_id: string;
}

export interface HybridSearchResult extends SemanticSearchResult {
  keyword_match: boolean;
}

export interface SearchOptions {
  /** Minimum similarity threshold (0-1, default: 0.7) */
  threshold?: number;
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Use hybrid search (vector + keyword) */
  hybrid?: boolean;
}

/**
 * Semantic search using vector similarity.
 */
export async function semanticSearch(
  query: string,
  org_id: string,
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const threshold = options.threshold ?? 0.7;
  const limit = options.limit ?? 10;

  // Generate embedding for query
  const queryEmbedding = await embedText(query);

  const supabase = getServiceSupabase();

  // Call the semantic_search RPC
  const { data, error } = await supabase.rpc("semantic_search", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_org_id: org_id,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) {
    throw new Error(`Semantic search failed: ${error.message}`);
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    chunk_id: row.chunk_id as string,
    doc_id: row.doc_id as string,
    content: row.content as string,
    similarity: row.similarity as number,
    metadata: (row.metadata as Record<string, unknown>) || {},
    doc_title: row.doc_title as string,
    doc_source_type: row.doc_source_type as string,
    doc_source_id: row.doc_source_id as string,
  }));
}

/**
 * Hybrid search combining vector similarity and keyword matching.
 */
export async function hybridSearch(
  query: string,
  org_id: string,
  options: SearchOptions = {}
): Promise<HybridSearchResult[]> {
  const threshold = options.threshold ?? 0.5; // Lower threshold for hybrid
  const limit = options.limit ?? 10;

  // Generate embedding for query
  const queryEmbedding = await embedText(query);

  const supabase = getServiceSupabase();

  // Call the hybrid_search RPC
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: JSON.stringify(queryEmbedding),
    query_text: query,
    match_org_id: org_id,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) {
    throw new Error(`Hybrid search failed: ${error.message}`);
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    chunk_id: row.chunk_id as string,
    doc_id: row.doc_id as string,
    content: row.content as string,
    similarity: row.similarity as number,
    keyword_match: row.keyword_match as boolean,
    metadata: (row.metadata as Record<string, unknown>) || {},
    doc_title: row.doc_title as string,
    doc_source_type: row.doc_source_type as string,
    doc_source_id: row.doc_source_id as string,
  }));
}

/**
 * Search with automatic fallback.
 * Uses hybrid search, falls back to pure semantic if no results.
 */
export async function search(
  query: string,
  org_id: string,
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  // Try hybrid search first
  const hybridResults = await hybridSearch(query, org_id, options);

  if (hybridResults.length > 0) {
    // Strip the keyword_match field for consistent return type
    return hybridResults.map(({ keyword_match: _keyword_match, ...rest }) => rest);
  }

  // Fallback to semantic with lower threshold
  return semanticSearch(query, org_id, {
    ...options,
    threshold: (options.threshold ?? 0.7) - 0.2, // Lower threshold for fallback
  });
}
