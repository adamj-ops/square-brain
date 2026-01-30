/**
 * POST /api/internal/ingest/firecrawl
 *
 * Internal endpoint for Firecrawl-based document ingestion.
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 *
 * Phase 6.1: Knowledge Ingestion Loops
 */

import type { NextRequest } from "next/server";
import {
  ingestFromFirecrawl,
  FIRECRAWL_INGEST_LIMITS,
  type FirecrawlIngestInput,
} from "@/lib/firecrawl/ingest";
import {
  createApiErrorResponse,
  getErrorMessage,
  isValidationError,
} from "@/lib/api/errors";

// Force Node.js runtime (crypto module required for content hashing)
export const runtime = "nodejs";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;

/**
 * Verify the internal API secret.
 */
function verifySecret(req: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.warn("[firecrawl/ingest] INTERNAL_SHARED_SECRET not configured");
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

    let body: FirecrawlIngestInput;

    try {
      body = await req.json();
    } catch {
      return createApiErrorResponse(
        "BAD_REQUEST",
        "Invalid JSON body",
        { expected: "FirecrawlIngestInput" }
      );
    }

    const result = await ingestFromFirecrawl(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = getErrorMessage(error);

    // Check if it's a validation error (400)
    if (isValidationError(message)) {
      return createApiErrorResponse(
        "VALIDATION_ERROR",
        message,
        { source: "input_validation" }
      );
    }

    // Check if it's a Firecrawl upstream error (502)
    if (message.includes("Firecrawl")) {
      return createApiErrorResponse(
        "UPSTREAM_ERROR",
        "Upstream service error",
        { originalError: message, service: "firecrawl" }
      );
    }

    console.error("[firecrawl/ingest] Error:", error);
    return createApiErrorResponse(
      "INTERNAL_ERROR",
      "Ingestion failed",
      { originalError: message }
    );
  }
}

/**
 * GET - Health check / info
 */
export async function GET() {
  try {
    return new Response(
      JSON.stringify({
        service: "firecrawl-ingest",
        limits: FIRECRAWL_INGEST_LIMITS,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[firecrawl/ingest] GET error:", error);
    return createApiErrorResponse(
      "INTERNAL_ERROR",
      "Failed to get service info",
      { originalError: getErrorMessage(error) }
    );
  }
}
