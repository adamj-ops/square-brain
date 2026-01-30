/**
 * POST /api/internal/ingest/docs
 *
 * Internal endpoint for ingesting markdown documentation files.
 * Supports MD/MDX files with source_type=internal_docs.
 * Idempotent - skips unchanged files based on content hash.
 *
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 *
 * Phase B2: Internal Docs Ingestion
 */

import type { NextRequest } from "next/server";
import { ingestInternalDocs, readDocsDirectory } from "@/lib/rag/ingest-docs";
import { ingestDocument } from "@/lib/rag/ingest";
import { createApiErrorResponse, getErrorMessage } from "@/lib/api/errors";

// Force Node.js runtime (file system and crypto required)
export const runtime = "nodejs";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "default";

/**
 * Verify the internal API secret.
 */
function verifySecret(req: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.warn("[docs/ingest] INTERNAL_SHARED_SECRET not configured");
    return false;
  }

  const secret = req.headers.get("X-Internal-Secret");
  return secret === INTERNAL_SECRET;
}

/**
 * Input for docs ingestion
 */
interface DocsIngestInput {
  /** Organization ID (optional, defaults to DEFAULT_ORG_ID) */
  org_id?: string;

  /** Action to perform */
  action: "ingest_all" | "ingest_single";

  /** For ingest_single: document content */
  document?: {
    /** Filename or unique identifier */
    filename: string;
    /** Document title */
    title: string;
    /** Markdown content */
    content: string;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
  };

  /** Optional tags to apply */
  tags?: string[];
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

    let body: DocsIngestInput;

    try {
      body = await req.json();
    } catch {
      return createApiErrorResponse(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "{ action, document?, org_id?, tags? }" }
      );
    }

    const orgId = body.org_id || DEFAULT_ORG_ID;

    if (body.action === "ingest_all") {
      // Ingest all docs from the docs/ directory
      const result = await ingestInternalDocs(orgId);

      return new Response(
        JSON.stringify({
          ok: true,
          action: "ingest_all",
          ...result,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (body.action === "ingest_single") {
      if (!body.document) {
        return createApiErrorResponse(
          "VALIDATION_ERROR",
          "document is required for ingest_single action",
          { field: "document" }
        );
      }

      const { filename, title, content, metadata } = body.document;

      if (!filename || !content) {
        return createApiErrorResponse(
          "VALIDATION_ERROR",
          "document.filename and document.content are required",
          { missing: [!filename && "filename", !content && "content"].filter(Boolean) }
        );
      }

      const result = await ingestDocument({
        org_id: orgId,
        source_type: "internal_docs",
        source_id: filename,
        title: title || filename.replace(/\.(md|mdx)$/, ""),
        content_md: content,
        metadata: {
          confidence: "high",
          doc_type: "system_documentation",
          filename,
          tags: body.tags || [],
          ...(metadata || {}),
        },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          action: "ingest_single",
          result,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return createApiErrorResponse(
      "VALIDATION_ERROR",
      "Invalid action. Must be: ingest_all or ingest_single",
      { field: "action", allowed: ["ingest_all", "ingest_single"] }
    );
  } catch (error) {
    console.error("[docs/ingest] Error:", error);
    return createApiErrorResponse(
      "INTERNAL_ERROR",
      "Ingestion failed",
      { originalError: getErrorMessage(error) }
    );
  }
}

/**
 * GET - Health check / list available docs
 */
export async function GET() {
  try {
    const docs = readDocsDirectory();

    return new Response(
      JSON.stringify({
        service: "docs-ingest",
        source_type: "internal_docs",
        available_docs: docs.map((d) => ({
          filename: d.filename,
          title: d.title,
          content_length: d.content.length,
        })),
        actions: ["ingest_all", "ingest_single"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[docs/ingest] GET error:", error);
    // Return partial info even on error, but with structured note
    return new Response(
      JSON.stringify({
        service: "docs-ingest",
        source_type: "internal_docs",
        available_docs: [],
        actions: ["ingest_all", "ingest_single"],
        note: "Could not read docs directory",
        error: { code: "INTERNAL_ERROR", message: getErrorMessage(error) },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
