/**
 * POST /api/internal/rag/ingest
 *
 * Internal endpoint for document ingestion.
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 *
 * Phase 5.1: RAG Semantic Search
 */

import type { NextRequest } from "next/server";
import {
  ingestDocument,
  ingestDocuments,
  syncBrainItemsToRAG,
  type IngestDocumentInput,
} from "@/lib/rag/ingest";
import { ingestInternalDocs } from "@/lib/rag/ingest-docs";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;

/**
 * Verify the internal API secret.
 */
function verifySecret(req: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.warn("[rag/ingest] INTERNAL_SHARED_SECRET not configured");
    return false;
  }

  const secret = req.headers.get("X-Internal-Secret");
  return secret === INTERNAL_SECRET;
}

export async function POST(req: NextRequest) {
  // Verify internal secret
  if (!verifySecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    action: "ingest" | "ingest_batch" | "sync_brain_items" | "ingest_internal_docs";
    document?: IngestDocumentInput;
    documents?: IngestDocumentInput[];
    org_id?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    switch (body.action) {
      case "ingest": {
        if (!body.document) {
          return new Response(
            JSON.stringify({ error: "document is required for ingest action" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const result = await ingestDocument(body.document);
        return new Response(JSON.stringify({ success: true, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "ingest_batch": {
        if (!body.documents || !Array.isArray(body.documents)) {
          return new Response(
            JSON.stringify({
              error: "documents array is required for ingest_batch action",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const results = await ingestDocuments(body.documents);
        return new Response(JSON.stringify({ success: true, results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "sync_brain_items": {
        if (!body.org_id) {
          return new Response(
            JSON.stringify({
              error: "org_id is required for sync_brain_items action",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const result = await syncBrainItemsToRAG(body.org_id);
        return new Response(JSON.stringify({ success: true, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "ingest_internal_docs": {
        if (!body.org_id) {
          return new Response(
            JSON.stringify({
              error: "org_id is required for ingest_internal_docs action",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const result = await ingestInternalDocs(body.org_id);
        return new Response(JSON.stringify({ success: true, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(
          JSON.stringify({
            error: "Invalid action. Must be: ingest, ingest_batch, sync_brain_items, or ingest_internal_docs",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[rag/ingest] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Ingestion failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
