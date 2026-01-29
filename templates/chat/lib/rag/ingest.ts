/**
 * Document Ingestion Service
 *
 * Handles ingesting documents into the RAG system:
 * 1. Creates/updates ai_docs record
 * 2. Chunks the content
 * 3. Generates embeddings
 * 4. Stores chunks with embeddings
 *
 * Phase 5.1: RAG Semantic Search
 * Updated to match existing ai_docs/ai_chunks schema
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import { chunkMarkdown, type Chunk } from "./chunker";
import { getEmbedder } from "./embedder";
import crypto from "crypto";

export type SourceType =
  | "brain_item"
  | "upload"
  | "url"
  | "manual"
  | "internal_docs"
  | "firecrawl"
  | "website"
  | "apify";

export interface IngestDocumentInput {
  org_id: string;
  source_type: SourceType;
  source_id?: string;
  title: string;
  content_md: string;
  metadata?: Record<string, unknown>;
}

export interface IngestDocumentResult {
  doc_id: string;
  chunk_count: number;
  status: "created" | "updated" | "unchanged";
  /** Time taken in milliseconds */
  duration_ms: number;
}

/**
 * Ingest a document into the RAG system.
 *
 * - Deduplicates by content hash
 * - Updates existing doc if content changed
 * - Chunks and embeds the content
 *
 * Schema notes (existing tables):
 * - ai_docs: content (not content_md), processing_status (not status), org_id is UUID
 * - ai_chunks: source_id (not doc_id), id is bigint, org_id is UUID
 */
export async function ingestDocument(
  input: IngestDocumentInput
): Promise<IngestDocumentResult> {
  const startTime = Date.now();
  const supabase = getServiceSupabase();

  // Generate content hash for deduplication
  const contentHash = crypto
    .createHash("sha256")
    .update(input.content_md)
    .digest("hex");

  // Check if document already exists by source_type + title (since source_id is UUID)
  // For internal_docs, we use title as the unique key within source_type
  const { data: existingDoc } = await supabase
    .from("ai_docs")
    .select("id, content_hash")
    .eq("org_id", input.org_id)
    .eq("source_type", input.source_type)
    .eq("title", input.title)
    .single();

  // If exists and unchanged, skip
  if (existingDoc && existingDoc.content_hash === contentHash) {
    return {
      doc_id: existingDoc.id,
      chunk_count: 0,
      status: "unchanged",
      duration_ms: Date.now() - startTime,
    };
  }

  // If exists but changed, delete old chunks
  if (existingDoc) {
    await supabase.from("ai_chunks").delete().eq("source_id", existingDoc.id);
  }

  // Insert or update document (using existing schema column names)
  let docId: string;

  if (existingDoc) {
    // Update existing
    const { error: updateError } = await supabase
      .from("ai_docs")
      .update({
        content: input.content_md,
        content_hash: contentHash,
        processing_status: "processing",
        metadata: input.metadata || {},
      })
      .eq("id", existingDoc.id);

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`);
    }
    docId = existingDoc.id;
  } else {
    // Insert new
    const { data: doc, error: insertError } = await supabase
      .from("ai_docs")
      .insert({
        org_id: input.org_id,
        source_type: input.source_type,
        title: input.title,
        content: input.content_md,
        content_hash: contentHash,
        processing_status: "processing",
        metadata: {
          ...input.metadata,
          source_id: input.source_id, // Store original source_id in metadata
        },
      })
      .select("id")
      .single();

    if (insertError || !doc) {
      throw new Error(`Failed to insert document: ${insertError?.message}`);
    }
    docId = doc.id;
  }

  try {
    // Chunk the content
    const chunks = chunkMarkdown(input.content_md, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    if (chunks.length === 0) {
      // No chunks (empty content), mark as completed with 0 chunks
      await supabase
        .from("ai_docs")
        .update({ processing_status: "completed", chunk_count: 0 })
        .eq("id", docId);

      return {
        doc_id: docId,
        chunk_count: 0,
        status: existingDoc ? "updated" : "created",
        duration_ms: Date.now() - startTime,
      };
    }

    // Generate embeddings
    const embedder = getEmbedder();
    const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));

    // Insert chunks with embeddings (using existing schema: source_id instead of doc_id)
    const chunkRows = chunks.map((chunk, i) => ({
      source_id: docId,
      org_id: input.org_id,
      chunk_index: chunk.index,
      content: chunk.content,
      embedding: JSON.stringify(embeddings[i].embedding), // pgvector accepts JSON array
      metadata: {
        section_title: (chunk as Chunk & { sectionTitle?: string }).sectionTitle,
        start_char: chunk.startChar,
        end_char: chunk.endChar,
        token_count: chunk.tokenCount,
      },
    }));

    const { error: chunkError } = await supabase
      .from("ai_chunks")
      .insert(chunkRows);

    if (chunkError) {
      throw new Error(`Failed to insert chunks: ${chunkError.message}`);
    }

    // Mark document as completed
    await supabase
      .from("ai_docs")
      .update({ processing_status: "completed", chunk_count: chunks.length })
      .eq("id", docId);

    return {
      doc_id: docId,
      chunk_count: chunks.length,
      status: existingDoc ? "updated" : "created",
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    // Mark document as failed
    await supabase
      .from("ai_docs")
      .update({
        processing_status: "failed",
        metadata: {
          ...(input.metadata || {}),
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      .eq("id", docId);

    throw error;
  }
}

/**
 * Ingest multiple documents in batch.
 */
export async function ingestDocuments(
  inputs: IngestDocumentInput[]
): Promise<IngestDocumentResult[]> {
  const results: IngestDocumentResult[] = [];

  for (const input of inputs) {
    try {
      const result = await ingestDocument(input);
      results.push(result);
    } catch (error) {
      // Log error but continue with other documents
      console.error(`Failed to ingest document "${input.title}":`, error);
      results.push({
        doc_id: "",
        chunk_count: 0,
        status: "unchanged", // Indicates failure
        duration_ms: 0,
      });
    }
  }

  return results;
}

/**
 * Sync brain_items to the RAG system.
 * Ingests all active brain items for an org.
 */
export async function syncBrainItemsToRAG(
  org_id: string
): Promise<{ synced: number; errors: number }> {
  const supabase = getServiceSupabase();

  // Fetch all active brain items
  const { data: items, error } = await supabase
    .from("brain_items")
    .select("id, type, title, content_md, tags, metadata")
    .eq("org_id", org_id)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to fetch brain items: ${error.message}`);
  }

  let synced = 0;
  let errors = 0;

  for (const item of items || []) {
    try {
      await ingestDocument({
        org_id,
        source_type: "brain_item",
        source_id: item.id,
        title: item.title,
        content_md: item.content_md,
        metadata: {
          type: item.type,
          tags: item.tags,
          ...((item.metadata as Record<string, unknown>) || {}),
        },
      });
      synced++;
    } catch (err) {
      console.error(`Failed to sync brain item ${item.id}:`, err);
      errors++;
    }
  }

  return { synced, errors };
}
