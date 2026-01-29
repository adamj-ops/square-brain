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
  // Verify internal secret
  if (!verifySecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: DocsIngestInput;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const orgId = body.org_id || DEFAULT_ORG_ID;

  try {
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
        return new Response(
          JSON.stringify({
            error: "document is required for ingest_single action",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const { filename, title, content, metadata } = body.document;

      if (!filename || !content) {
        return new Response(
          JSON.stringify({
            error: "document.filename and document.content are required",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
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

    return new Response(
      JSON.stringify({
        error: "Invalid action. Must be: ingest_all or ingest_single",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[docs/ingest] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Ingestion failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
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
  } catch {
    return new Response(
      JSON.stringify({
        service: "docs-ingest",
        source_type: "internal_docs",
        available_docs: [],
        actions: ["ingest_all", "ingest_single"],
        note: "Could not read docs directory",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
