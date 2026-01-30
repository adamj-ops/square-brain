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
import { createApiErrorResponse, getErrorMessage } from "@/lib/api/errors";

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
      action: "ingest" | "ingest_batch" | "sync_brain_items" | "ingest_internal_docs";
      document?: IngestDocumentInput;
      documents?: IngestDocumentInput[];
      org_id?: string;
    };

    try {
      body = await req.json();
    } catch {
      return createApiErrorResponse(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "{ action, document?, documents?, org_id? }" }
      );
    }

    switch (body.action) {
      case "ingest": {
        if (!body.document) {
          return createApiErrorResponse(
            "VALIDATION_ERROR",
            "document is required for ingest action",
            { field: "document" }
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
          return createApiErrorResponse(
            "VALIDATION_ERROR",
            "documents array is required for ingest_batch action",
            { field: "documents" }
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
          return createApiErrorResponse(
            "VALIDATION_ERROR",
            "org_id is required for sync_brain_items action",
            { field: "org_id" }
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
          return createApiErrorResponse(
            "VALIDATION_ERROR",
            "org_id is required for ingest_internal_docs action",
            { field: "org_id" }
          );
        }
        const result = await ingestInternalDocs(body.org_id);
        return new Response(JSON.stringify({ success: true, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      default:
        return createApiErrorResponse(
          "VALIDATION_ERROR",
          "Invalid action. Must be: ingest, ingest_batch, sync_brain_items, or ingest_internal_docs",
          { field: "action", allowed: ["ingest", "ingest_batch", "sync_brain_items", "ingest_internal_docs"] }
        );
    }
  } catch (error) {
    console.error("[rag/ingest] Error:", error);
    return createApiErrorResponse(
      "INTERNAL_ERROR",
      "Ingestion failed",
      { originalError: getErrorMessage(error) }
    );
  }
}
