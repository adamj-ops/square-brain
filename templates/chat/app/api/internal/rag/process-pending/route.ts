/**
 * POST /api/internal/rag/process-pending
 *
 * Processes pending ai_docs - chunks content and generates embeddings.
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 *
 * Phase 6.1: Knowledge Ingestion Loops
 */

import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { chunkMarkdown, type Chunk } from "@/lib/rag/chunker";
import { getEmbedder } from "@/lib/rag/embedder";
import { createApiErrorResponse, getErrorMessage } from "@/lib/api/errors";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const BATCH_SIZE = 5; // Process 5 docs at a time

/**
 * Verify the internal API secret.
 */
function verifySecret(req: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.warn("[rag/process-pending] INTERNAL_SHARED_SECRET not configured");
    return false;
  }

  const secret = req.headers.get("X-Internal-Secret");
  return secret === INTERNAL_SECRET;
}

export async function POST(req: NextRequest) {
  try {
    // Verify internal secret
    if (!verifySecret(req)) {
      return createApiErrorResponse(
        "UNAUTHORIZED",
        "Invalid or missing X-Internal-Secret header",
        { header: "X-Internal-Secret" }
      );
    }

    let body: {
      limit?: number;
      source_type?: string;
    };

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const limit = body.limit || BATCH_SIZE;
    const sourceTypeFilter = body.source_type;

    const supabase = getServiceSupabase();

    // Fetch pending docs
    let query = supabase
      .from("ai_docs")
      .select("id, org_id, title, content, source_type")
      .eq("processing_status", "pending")
      .limit(limit);

    if (sourceTypeFilter) {
      query = query.eq("source_type", sourceTypeFilter);
    }

    const { data: pendingDocs, error: fetchError } = await query;

    if (fetchError) {
      return createApiErrorResponse(
        "INTERNAL_ERROR",
        "Failed to fetch pending docs",
        { dbError: fetchError.message }
      );
    }

    if (!pendingDocs || pendingDocs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending documents to process",
          processed: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[rag/process-pending] Processing ${pendingDocs.length} docs`);

    const results: Array<{
      doc_id: string;
      title: string;
      chunk_count: number;
      status: "completed" | "failed";
      error?: string;
    }> = [];

    const embedder = getEmbedder();

    for (const doc of pendingDocs) {
      try {
        // Mark as processing
        await supabase
          .from("ai_docs")
          .update({ processing_status: "processing" })
          .eq("id", doc.id);

        // Chunk the content
        const chunks = chunkMarkdown(doc.content || "", {
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        if (chunks.length === 0) {
          // No chunks, mark as completed
          await supabase
            .from("ai_docs")
            .update({ processing_status: "completed", chunk_count: 0 })
            .eq("id", doc.id);

          results.push({
            doc_id: doc.id,
            title: doc.title,
            chunk_count: 0,
            status: "completed",
          });
          continue;
        }

        // Generate embeddings
        const embeddings = await embedder.embedBatch(
          chunks.map((c) => c.content)
        );

        // Insert chunks
        const chunkRows = chunks.map((chunk, i) => ({
          source_id: doc.id,
          org_id: doc.org_id,
          chunk_index: chunk.index,
          content: chunk.content,
          embedding: JSON.stringify(embeddings[i].embedding),
          metadata: {
            section_title: (chunk as Chunk & { sectionTitle?: string })
              .sectionTitle,
            start_char: chunk.startChar,
            end_char: chunk.endChar,
            token_count: chunk.tokenCount,
            source_type: doc.source_type,
          },
        }));

        const { error: chunkError } = await supabase
          .from("ai_chunks")
          .insert(chunkRows);

        if (chunkError) {
          throw new Error(`Failed to insert chunks: ${chunkError.message}`);
        }

        // Mark as completed
        await supabase
          .from("ai_docs")
          .update({ processing_status: "completed", chunk_count: chunks.length })
          .eq("id", doc.id);

        results.push({
          doc_id: doc.id,
          title: doc.title,
          chunk_count: chunks.length,
          status: "completed",
        });

        console.log(
          `[rag/process-pending] Processed "${doc.title}" - ${chunks.length} chunks`
        );
      } catch (docError) {
        console.error(
          `[rag/process-pending] Failed to process "${doc.title}":`,
          docError
        );

        // Mark as failed
        await supabase
          .from("ai_docs")
          .update({
            processing_status: "failed",
            metadata: {
              error: getErrorMessage(docError),
            },
          })
          .eq("id", doc.id);

        results.push({
          doc_id: doc.id,
          title: doc.title,
          chunk_count: 0,
          status: "failed",
          error: getErrorMessage(docError),
        });
      }
    }

    const processed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const totalChunks = results.reduce((sum, r) => sum + r.chunk_count, 0);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        failed,
        total_chunks: totalChunks,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[rag/process-pending] Error:", error);
    return createApiErrorResponse(
      "INTERNAL_ERROR",
      "Processing failed",
      { originalError: getErrorMessage(error) }
    );
  }
}

/**
 * GET handler - check pending count
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("ai_docs")
      .select("processing_status")
      .in("processing_status", ["pending", "processing", "failed"]);

    if (error) {
      return createApiErrorResponse(
        "INTERNAL_ERROR",
        "Failed to fetch pending counts",
        { dbError: error.message }
      );
    }

    const counts = {
      pending: data?.filter((d) => d.processing_status === "pending").length || 0,
      processing:
        data?.filter((d) => d.processing_status === "processing").length || 0,
      failed: data?.filter((d) => d.processing_status === "failed").length || 0,
    };

    return new Response(
      JSON.stringify({
        status: "ok",
        counts,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[rag/process-pending] GET error:", error);
    return createApiErrorResponse(
      "INTERNAL_ERROR",
      "Failed to get pending counts",
      { originalError: getErrorMessage(error) }
    );
  }
}
