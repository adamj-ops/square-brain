/**
 * POST /api/internal/ingest/apify
 *
 * Internal endpoint for Apify-based content ingestion.
 * Accepts normalized payloads from allowlisted Apify actors.
 *
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 *
 * Phase B3: Apify Ingestion Seam
 */

import type { NextRequest } from "next/server";
import { ingestDocument, type SourceType } from "@/lib/rag/ingest";

// Force Node.js runtime (crypto module required for content hashing)
export const runtime = "nodejs";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "default";

/**
 * Allowlisted Apify actor IDs.
 * Only payloads from these actors will be accepted.
 * Add new actor IDs here as needed.
 */
const ALLOWED_ACTOR_IDS = new Set([
  "apify/web-scraper",
  "apify/website-content-crawler",
  "apify/cheerio-scraper",
  "apify/puppeteer-scraper",
  "apify/playwright-scraper",
  // Add custom actor IDs as needed
]);

/**
 * Normalized payload from Apify webhook or direct call
 */
interface ApifyIngestPayload {
  /** Apify actor ID (e.g., "apify/web-scraper") */
  actor_id: string;

  /** Apify run ID for traceability */
  run_id?: string;

  /** Organization ID (optional, defaults to DEFAULT_ORG_ID) */
  org_id?: string;

  /** Array of documents to ingest */
  documents: ApifyDocument[];

  /** Optional source type override */
  source_type?: "apify" | "website" | "url";

  /** Optional tags to apply to all documents */
  tags?: string[];
}

/**
 * Normalized document from Apify
 */
interface ApifyDocument {
  /** Source URL */
  url: string;

  /** Document title */
  title: string;

  /** Content as markdown */
  markdown: string;

  /** Optional metadata from Apify */
  metadata?: Record<string, unknown>;
}

/**
 * Verify the internal API secret.
 */
function verifySecret(req: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.warn("[apify/ingest] INTERNAL_SHARED_SECRET not configured");
    return false;
  }

  const secret = req.headers.get("X-Internal-Secret");
  return secret === INTERNAL_SECRET;
}

/**
 * Validate a URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Extract hostname from URL for source_id
 */
function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

// Hard limits
const MAX_DOCUMENTS_PER_REQUEST = 50;
const MAX_CONTENT_LENGTH = 100_000; // 100K chars per document

export async function POST(req: NextRequest) {
  // Verify internal secret
  if (!verifySecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: ApifyIngestPayload;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate required fields
  if (!body.actor_id) {
    return new Response(
      JSON.stringify({ error: "actor_id is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Verify actor is in allowlist
  if (!ALLOWED_ACTOR_IDS.has(body.actor_id)) {
    return new Response(
      JSON.stringify({
        error: "Actor not allowed",
        message: `Actor "${body.actor_id}" is not in the allowlist. Contact admin to add it.`,
        allowed_actors: Array.from(ALLOWED_ACTOR_IDS),
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!body.documents || !Array.isArray(body.documents)) {
    return new Response(
      JSON.stringify({ error: "documents array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (body.documents.length > MAX_DOCUMENTS_PER_REQUEST) {
    return new Response(
      JSON.stringify({
        error: `Maximum ${MAX_DOCUMENTS_PER_REQUEST} documents per request`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const orgId = body.org_id || DEFAULT_ORG_ID;
  const sourceType: SourceType = body.source_type || "apify";
  const tags = body.tags || [];

  const results: Array<{
    url: string;
    doc_id?: string;
    status: "ingested" | "skipped";
    reason?: string;
  }> = [];

  let documentsProcessed = 0;
  let documentsSkipped = 0;
  let chunksCreated = 0;

  for (const doc of body.documents) {
    // Validate document
    if (!doc.url || !isValidUrl(doc.url)) {
      results.push({
        url: doc.url || "unknown",
        status: "skipped",
        reason: "Invalid URL",
      });
      documentsSkipped++;
      continue;
    }

    if (!doc.markdown || doc.markdown.trim().length < 50) {
      results.push({
        url: doc.url,
        status: "skipped",
        reason: "Content too short or empty",
      });
      documentsSkipped++;
      continue;
    }

    // Truncate overly long content
    let content = doc.markdown;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
    }

    try {
      const result = await ingestDocument({
        org_id: orgId,
        source_type: sourceType,
        source_id: getHostname(doc.url),
        title: doc.title || doc.url,
        content_md: content,
        metadata: {
          url: doc.url,
          apify: {
            actor_id: body.actor_id,
            run_id: body.run_id,
          },
          tags,
          ...(doc.metadata || {}),
        },
      });

      if (result.status === "unchanged") {
        results.push({
          url: doc.url,
          doc_id: result.doc_id,
          status: "skipped",
          reason: "Content unchanged",
        });
        documentsSkipped++;
      } else {
        results.push({
          url: doc.url,
          doc_id: result.doc_id,
          status: "ingested",
        });
        documentsProcessed++;
        chunksCreated += result.chunk_count;
      }
    } catch (error) {
      results.push({
        url: doc.url,
        status: "skipped",
        reason: error instanceof Error ? error.message : "Ingestion failed",
      });
      documentsSkipped++;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      actor_id: body.actor_id,
      run_id: body.run_id,
      documents_processed: documentsProcessed,
      documents_skipped: documentsSkipped,
      chunks_created: chunksCreated,
      results,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * GET - Health check / info
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      service: "apify-ingest",
      allowed_actors: Array.from(ALLOWED_ACTOR_IDS),
      limits: {
        MAX_DOCUMENTS_PER_REQUEST,
        MAX_CONTENT_LENGTH,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
