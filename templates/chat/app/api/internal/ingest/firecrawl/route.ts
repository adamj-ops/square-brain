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
  // Verify internal secret
  if (!verifySecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: FirecrawlIngestInput;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ingestFromFirecrawl(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Check if it's a validation error (400) or Firecrawl error (502)
    if (
      message.includes("must be") ||
      message.includes("Invalid") ||
      message.includes("required")
    ) {
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (message.includes("Firecrawl")) {
      return new Response(
        JSON.stringify({
          error: "Upstream service error",
          message,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.error("[firecrawl/ingest] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Ingestion failed",
        message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * GET - Health check / info
 */
export async function GET() {
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
}
