/**
 * POST /api/internal/jobs/theme-scanner
 *
 * Internal endpoint to trigger the theme scanner job.
 * Auth: X-Internal-Secret header must match INTERNAL_SHARED_SECRET
 *
 * This endpoint can be called:
 * - Manually for testing
 * - From a cron job (e.g., Vercel Cron, GitHub Actions)
 * - From other internal services
 *
 * Phase 5.3: Background compounding job (themes scanner)
 */

import type { NextRequest } from "next/server";
import { runThemeScanner, getThemesWithEvidence } from "@/lib/themes";
import type { ThemeScannerInput, ContentType } from "@/lib/themes/types";

const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Verify the internal API secret.
 */
function verifySecret(req: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.warn("[theme-scanner] INTERNAL_SHARED_SECRET not configured");
    return false;
  }

  const secret = req.headers.get("X-Internal-Secret");
  return secret === INTERNAL_SECRET;
}

/**
 * POST handler - trigger theme scanner
 */
export async function POST(req: NextRequest) {
  // Verify internal secret
  if (!verifySecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    action?: "scan" | "list_themes";
    org_id?: string;
    content_types?: ContentType[];
    since?: string;
    limit?: number;
    force?: boolean;
    category?: string;
  };

  try {
    body = await req.json();
  } catch {
    // Default to scan action with empty body
    body = {};
  }

  const action = body.action || "scan";
  const orgId = body.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    return new Response(
      JSON.stringify({ error: "org_id is required (or set DEFAULT_ORG_ID)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    switch (action) {
      case "scan": {
        const input: ThemeScannerInput = {
          org_id: orgId,
          content_types: body.content_types,
          since: body.since,
          limit: body.limit,
          force: body.force,
        };

        console.log(`[theme-scanner] Starting scan for org ${orgId}`);
        const result = await runThemeScanner(input);

        return new Response(
          JSON.stringify({
            success: true,
            action: "scan",
            result,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      case "list_themes": {
        const themes = await getThemesWithEvidence(orgId, {
          limit: body.limit,
          category: body.category,
        });

        return new Response(
          JSON.stringify({
            success: true,
            action: "list_themes",
            themes,
            count: themes.length,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action. Must be: scan or list_themes" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[theme-scanner] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Job failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET handler - health check / status
 */
export async function GET(_req: NextRequest) {
  // Allow unauthenticated health checks
  return new Response(
    JSON.stringify({
      status: "ok",
      job: "theme-scanner",
      description: "Scans content to extract and link themes",
      endpoints: {
        "POST /scan": "Trigger theme extraction scan",
        "POST /list_themes": "List themes with evidence",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
