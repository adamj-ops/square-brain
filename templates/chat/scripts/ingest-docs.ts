#!/usr/bin/env tsx
/**
 * CLI script to ingest internal docs into the RAG system.
 *
 * Usage:
 *   npx tsx scripts/ingest-docs.ts
 *
 * Requires:
 *   - OPENAI_API_KEY: For generating embeddings
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Service role key (bypasses RLS)
 *   - DEFAULT_ORG_ID: Target organization ID
 *
 * Phase 5.2: Knowledge ingestion from docs
 */

import { config } from "dotenv";
config(); // Load .env file

import path from "path";
import fs from "fs";

// We need to resolve paths manually since we're not in Next.js context
const DOCS_DIR = path.join(process.cwd(), "docs");

async function main() {
  const orgId = process.env.DEFAULT_ORG_ID;
  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Validate required env vars
  const missing: string[] = [];
  if (!orgId) missing.push("DEFAULT_ORG_ID");
  if (!openaiKey) missing.push("OPENAI_API_KEY");
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    missing.forEach((v) => console.error(`  - ${v}`));
    process.exit(1);
  }

  // Check docs directory
  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`Docs directory not found: ${DOCS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  console.log(`Found ${files.length} doc files to ingest:`);
  files.forEach((f) => console.log(`  - ${f}`));

  // Make API call to ingestion endpoint
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const internalSecret = process.env.INTERNAL_SHARED_SECRET;

  if (!internalSecret) {
    console.error("INTERNAL_SHARED_SECRET is required to call the ingestion API");
    process.exit(1);
  }

  console.log(`\nIngesting docs via API: ${baseUrl}/api/internal/rag/ingest`);
  console.log(`Target org: ${orgId}`);

  try {
    const response = await fetch(`${baseUrl}/api/internal/rag/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": internalSecret,
      },
      body: JSON.stringify({
        action: "ingest_internal_docs",
        org_id: orgId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Ingestion failed:", data);
      process.exit(1);
    }

    console.log("\nIngestion complete:");
    console.log(`  Ingested: ${data.result.ingested}`);
    console.log(`  Unchanged: ${data.result.unchanged}`);
    console.log(`  Errors: ${data.result.errors}`);

    if (data.result.errors > 0) {
      console.warn("\nSome documents failed to ingest. Check server logs for details.");
      process.exit(1);
    }

    console.log("\n✅ Done! Internal docs are now searchable via brain.semantic_search");
  } catch (error) {
    console.error("Failed to call ingestion API:", error);
    console.log("\nMake sure the dev server is running: npm run dev");
    process.exit(1);
  }
}

main();
