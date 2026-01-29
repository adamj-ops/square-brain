/**
 * Tool Smoke Test Script
 *
 * Manual test script to verify tool execution works end-to-end.
 * Run with: npx tsx scripts/tool-smoke-test.ts
 *
 * Phase 4: Tool Executor + Audit Logging
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local from the templates/chat directory
config({ path: resolve(__dirname, "../.env.local") });

import { executeTool } from "../lib/tools/executeTool";
import type { ToolContext } from "../lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

async function main() {
  console.log("=== Tool Smoke Test ===\n");

  if (!DEFAULT_ORG_ID) {
    console.error("ERROR: DEFAULT_ORG_ID not set in .env.local");
    process.exit(1);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("ERROR: Supabase credentials not set in .env.local");
    process.exit(1);
  }

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    user_id: "smoke-test-user",
    allowWrites: true,
    metadata: { test: true },
  };

  // Test 1: Upsert a brain item
  console.log("1. Testing brain.upsert_item (writes=true)...");
  const upsertResult = await executeTool(
    "brain.upsert_item",
    {
      type: "decision",
      title: "Smoke Test Decision",
      content_md:
        "This is a test decision created by the smoke test script. " +
        "It verifies that the tool executor and audit logging work correctly.",
      tags: ["smoke-test", "automated"],
      confidence_score: 0.9,
      canonical_key: "smoke-test-decision-001",
    },
    ctx
  );

  if (upsertResult.ok) {
    console.log("   ✓ Upsert succeeded:");
    console.log(`     - id: ${upsertResult.response.data.id}`);
    console.log(`     - version: ${upsertResult.response.data.version}`);
    console.log(`     - explainability:`, upsertResult.response.explainability);
  } else {
    console.error("   ✗ Upsert failed:", upsertResult.error);
    process.exit(1);
  }

  // Test 2: Search for the brain item
  console.log("\n2. Testing brain.search_items (writes=false)...");
  const searchResult = await executeTool(
    "brain.search_items",
    {
      query: "Smoke Test",
      type: "decision",
      limit: 5,
    },
    { ...ctx, allowWrites: false } // Prove read works without writes
  );

  if (searchResult.ok) {
    const items = (searchResult.response.data as { items: unknown[] }).items;
    console.log(`   ✓ Search succeeded: found ${items.length} item(s)`);
    console.log(`     - explainability:`, searchResult.response.explainability);
    if (items.length > 0) {
      console.log(`     - first result:`, items[0]);
    }
  } else {
    console.error("   ✗ Search failed:", searchResult.error);
    process.exit(1);
  }

  // Test 3: Write tool without allowWrites should fail
  console.log("\n3. Testing write protection (allowWrites=false)...");
  const writeProtectResult = await executeTool(
    "brain.upsert_item",
    {
      type: "decision",
      title: "Should Fail",
      content_md: "This should not be created because allowWrites is false.",
    },
    { ...ctx, allowWrites: false }
  );

  if (!writeProtectResult.ok && writeProtectResult.error.code === "WRITE_NOT_ALLOWED") {
    console.log("   ✓ Write protection works: correctly rejected write without permission");
  } else {
    console.error("   ✗ Write protection failed: should have rejected the write");
    process.exit(1);
  }

  // Test 4: Unknown tool should fail
  console.log("\n4. Testing unknown tool handling...");
  const unknownResult = await executeTool("nonexistent.tool", {}, ctx);

  if (!unknownResult.ok && unknownResult.error.code === "TOOL_NOT_FOUND") {
    console.log("   ✓ Unknown tool handling works: correctly rejected unknown tool");
  } else {
    console.error("   ✗ Unknown tool handling failed: should have rejected unknown tool");
    process.exit(1);
  }

  // Test 5: Validation error
  console.log("\n5. Testing validation error handling...");
  const validationResult = await executeTool(
    "brain.upsert_item",
    {
      type: "invalid-type",
      title: "x", // too short
      content_md: "short", // too short
    },
    ctx
  );

  if (!validationResult.ok && validationResult.error.code === "VALIDATION_ERROR") {
    console.log("   ✓ Validation error handling works: correctly rejected invalid input");
    console.log(`     - message: ${validationResult.error.message}`);
  } else {
    console.error("   ✗ Validation error handling failed: should have rejected invalid input");
    process.exit(1);
  }

  console.log("\n=== All Tests Passed ===");
  console.log("\nNote: Check ai_tool_logs table to verify audit entries were created.");
}

main().catch((err) => {
  console.error("Smoke test error:", err);
  process.exit(1);
});
