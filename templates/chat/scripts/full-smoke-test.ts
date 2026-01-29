/**
 * Full System Smoke Test
 *
 * Comprehensive end-to-end test covering:
 * 1. Document ingestion
 * 2. Semantic search
 * 3. Tool execution across all pipelines
 * 4. Audit log verification
 *
 * Run with: npx tsx scripts/full-smoke-test.ts
 *
 * Final Phase: Integration & Release
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local from the templates/chat directory
config({ path: resolve(__dirname, "../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { executeTool } from "../lib/tools/executeTool";
import type { ToolContext } from "../lib/tools/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "default-org";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];
let testStartTime: number;

function startTest(name: string) {
  console.log(`\n📋 ${name}...`);
  testStartTime = Date.now();
}

function pass(message: string) {
  const duration = Date.now() - testStartTime;
  console.log(`   ✓ ${message} (${duration}ms)`);
  results.push({ name: "", passed: true, message, duration });
}

function fail(message: string) {
  const duration = Date.now() - testStartTime;
  console.log(`   ✗ ${message} (${duration}ms)`);
  results.push({ name: "", passed: false, message, duration });
}

async function testIngestion() {
  startTest("1. Document Ingestion");

  try {
    // Insert a test document into ai_docs
    const testDoc = {
      org_id: DEFAULT_ORG_ID,
      source_type: "smoke_test",
      source_url: "smoke://test/doc-001",
      title: "Smoke Test Document",
      content_md: `# Smoke Test Document

This is a test document for the LifeRX Brain smoke test.
It contains information about health optimization and wellness practices.

## Key Topics
- Nutrition fundamentals
- Exercise protocols
- Sleep optimization
- Stress management

This document verifies that ingestion and search work correctly.`,
      content_hash: `smoke-test-${Date.now()}`,
      metadata: { test: true, created_by: "smoke-test" },
    };

    const { data: doc, error } = await supabase
      .from("ai_docs")
      .upsert(testDoc, { onConflict: "org_id,source_url" })
      .select("id")
      .single();

    if (error) throw new Error(`Ingestion failed: ${error.message}`);

    pass(`Document ingested: ${doc.id}`);

    // Create a chunk for searching
    const testChunk = {
      org_id: DEFAULT_ORG_ID,
      doc_id: doc.id,
      chunk_index: 0,
      content: testDoc.content_md,
      token_count: 100,
      metadata: { test: true },
    };

    const { error: chunkError } = await supabase
      .from("ai_chunks")
      .upsert(testChunk, { onConflict: "doc_id,chunk_index" });

    if (chunkError) throw new Error(`Chunk creation failed: ${chunkError.message}`);

    pass("Chunk created for search");
    return doc.id;
  } catch (err) {
    fail(String(err));
    return null;
  }
}

async function testSemanticSearch() {
  startTest("2. Semantic Search");

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    allowWrites: false,
  };

  try {
    // Test brain.search_items
    const result = await executeTool(
      "brain.search_items",
      { query: "health optimization", limit: 5 },
      ctx
    );

    if (!result.ok) throw new Error(`Search failed: ${result.error.message}`);

    const data = result.response.data as { items: unknown[] };
    pass(`Search returned ${data.items?.length || 0} results`);
    return true;
  } catch (err) {
    fail(String(err));
    return false;
  }
}

async function testPipeline1() {
  startTest("3. Pipeline 1 - Guest Intelligence");

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    allowWrites: true,
  };

  try {
    // Create a test guest
    const guestResult = await executeTool(
      "guests.upsert_profile",
      {
        name: "Smoke Test Guest",
        email: `smoke-test-${Date.now()}@example.com`,
        title: "Test Subject",
        company: "Test Corp",
        expertise_areas: ["testing", "automation"],
        talking_points: ["smoke testing", "integration testing"],
      },
      ctx
    );

    if (!guestResult.ok) throw new Error(`Guest creation failed: ${guestResult.error.message}`);

    const guestData = guestResult.response.data as { guest_id: string };
    pass(`Guest created: ${guestData.guest_id}`);

    // Add signals
    const signalResult = await executeTool(
      "guests.extract_signals",
      {
        guest_id: guestData.guest_id,
        signals: [
          { signal_type: "expertise", title: "Test expertise", weight: 0.8, confidence: 0.9 },
        ],
      },
      ctx
    );

    if (!signalResult.ok) throw new Error(`Signal extraction failed: ${signalResult.error.message}`);
    pass("Signals extracted");

    // Score guest
    const scoreResult = await executeTool(
      "scoring.score_guest",
      { guest_id: guestData.guest_id },
      ctx
    );

    if (!scoreResult.ok) throw new Error(`Scoring failed: ${scoreResult.error.message}`);

    const scoreData = scoreResult.response.data as { total_score: number; grade: string };
    pass(`Guest scored: ${scoreData.total_score} (${scoreData.grade})`);

    return guestData.guest_id;
  } catch (err) {
    fail(String(err));
    return null;
  }
}

async function testPipeline2() {
  startTest("4. Pipeline 2 - Interview Intelligence");

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    allowWrites: true,
  };

  try {
    // Create a test interview
    const { data: interview, error: intError } = await supabase
      .from("interviews")
      .insert({
        org_id: DEFAULT_ORG_ID,
        title: "Smoke Test Interview",
        interview_date: new Date().toISOString().split("T")[0],
        status: "published",
      })
      .select("id")
      .single();

    if (intError) throw new Error(`Interview creation failed: ${intError.message}`);
    pass(`Interview created: ${interview.id}`);

    // Add a quote
    const quoteResult = await executeTool(
      "interviews.add_quote",
      {
        interview_id: interview.id,
        quote_text: "Testing is not just about finding bugs, it's about building confidence in the system.",
        speaker: "Test Speaker",
        timestamp_start: "00:05:00",
        timestamp_end: "00:05:30",
        tags: ["testing", "quality"],
      },
      ctx
    );

    if (!quoteResult.ok) throw new Error(`Quote addition failed: ${quoteResult.error.message}`);
    pass("Quote added to interview");

    // Create and link a theme
    const themeResult = await executeTool(
      "themes.upsert_theme",
      {
        name: "Quality Assurance",
        slug: `qa-smoke-test-${Date.now()}`,
        description: "Testing and quality practices",
        category: "technical",
      },
      ctx
    );

    if (!themeResult.ok) throw new Error(`Theme creation failed: ${themeResult.error.message}`);

    const themeData = themeResult.response.data as { theme_id: string };
    pass(`Theme created: ${themeData.theme_id}`);

    // Link theme to interview
    const linkResult = await executeTool(
      "themes.link_to_interview",
      {
        theme_id: themeData.theme_id,
        interview_id: interview.id,
        relevance_score: 0.9,
      },
      ctx
    );

    if (!linkResult.ok) throw new Error(`Theme linking failed: ${linkResult.error.message}`);
    pass("Theme linked to interview");

    return interview.id;
  } catch (err) {
    fail(String(err));
    return null;
  }
}

async function testPipeline3(interviewId: string | null) {
  startTest("5. Pipeline 3 - Content Repurposing");

  if (!interviewId) {
    fail("Skipped - no interview ID from Pipeline 2");
    return null;
  }

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    allowWrites: true,
  };

  try {
    const assetResult = await executeTool(
      "content.generate_assets",
      {
        interview_id: interviewId,
        asset_types: ["quote_card", "carousel_outline"],
        themes: ["quality assurance"],
      },
      ctx
    );

    if (!assetResult.ok) throw new Error(`Asset generation failed: ${assetResult.error.message}`);

    const assetData = assetResult.response.data as { assets_created: number };
    pass(`${assetData.assets_created} content assets generated`);

    return true;
  } catch (err) {
    fail(String(err));
    return false;
  }
}

async function testPipeline4() {
  startTest("6. Pipeline 4 - Outreach Automation");

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    allowWrites: true,
  };

  try {
    // Compose a test message (but don't send it)
    const composeResult = await executeTool(
      "outreach.compose_message",
      {
        recipient_email: "smoke-test@example.com",
        recipient_name: "Smoke Test Recipient",
        subject: "Smoke Test - Do Not Send",
        body_text: "This is a smoke test message. It should not be sent.",
        requires_approval: true,
      },
      ctx
    );

    if (!composeResult.ok) throw new Error(`Message composition failed: ${composeResult.error.message}`);

    const msgData = composeResult.response.data as { message_id: string; status: string };
    pass(`Message composed: ${msgData.message_id} (status: ${msgData.status})`);

    return msgData.message_id;
  } catch (err) {
    fail(String(err));
    return null;
  }
}

async function testPipeline5() {
  startTest("7. Pipeline 5 - Quiz Segmentation");

  const ctx: ToolContext = {
    org_id: DEFAULT_ORG_ID,
    session_id: "smoke-test-session",
    allowWrites: true,
  };

  try {
    // Score a sample quiz
    const scoreResult = await executeTool(
      "audience.score_quiz",
      {
        quiz_id: "smoke-test-quiz",
        session_id: `smoke-test-${Date.now()}`,
        answers: {
          q_health_priority: "important",
          q_current_habits: "moderately_active",
          q_knowledge_level: "intermediate",
        },
      },
      ctx
    );

    if (!scoreResult.ok) throw new Error(`Quiz scoring failed: ${scoreResult.error.message}`);

    const quizData = scoreResult.response.data as {
      response_id: string;
      normalized_score: number;
      emotional_profile: { primary: string };
    };
    pass(`Quiz scored: ${quizData.normalized_score}/100 (emotion: ${quizData.emotional_profile.primary})`);

    // Assign segment
    const segmentResult = await executeTool(
      "audience.assign_segment",
      { response_id: quizData.response_id },
      ctx
    );

    if (!segmentResult.ok) throw new Error(`Segment assignment failed: ${segmentResult.error.message}`);

    const segData = segmentResult.response.data as {
      assigned_segment: { name: string } | null;
      segment_confidence: number;
      suggested_ctas: unknown[];
    };

    if (segData.assigned_segment) {
      pass(`Segment assigned: ${segData.assigned_segment.name} (${Math.round(segData.segment_confidence * 100)}% confidence)`);
    } else {
      pass("No segment matched (expected if segments not seeded)");
    }

    pass(`${segData.suggested_ctas?.length || 0} CTAs suggested`);
    return quizData.response_id;
  } catch (err) {
    fail(String(err));
    return null;
  }
}

async function testAuditLog() {
  startTest("8. Audit Log Verification");

  try {
    // Check that audit logs were created
    const { data: logs, error } = await supabase
      .from("ai_tool_logs")
      .select("id, tool_name, status, created_at")
      .eq("org_id", DEFAULT_ORG_ID)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw new Error(`Audit log query failed: ${error.message}`);

    if (!logs || logs.length === 0) {
      fail("No audit logs found");
      return false;
    }

    const recentLogs = logs.filter((log) => {
      const created = new Date(log.created_at);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return created > fiveMinutesAgo;
    });

    pass(`Found ${recentLogs.length} recent audit log entries`);

    // Check for variety of tools
    const toolNames = [...new Set(recentLogs.map((l) => l.tool_name))];
    pass(`Tools logged: ${toolNames.join(", ")}`);

    // Check for success/failure mix
    const statuses = [...new Set(recentLogs.map((l) => l.status))];
    pass(`Statuses recorded: ${statuses.join(", ")}`);

    return true;
  } catch (err) {
    fail(String(err));
    return false;
  }
}

async function cleanup(docId: string | null, guestId: string | null, interviewId: string | null) {
  console.log("\n🧹 Cleanup (optional - keeping test data for inspection)...");

  // Uncomment to delete test data:
  // if (docId) await supabase.from("ai_docs").delete().eq("id", docId);
  // if (guestId) await supabase.from("guests").delete().eq("id", guestId);
  // if (interviewId) await supabase.from("interviews").delete().eq("id", interviewId);
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  LifeRX Brain - Full System Smoke Test                    ║");
  console.log("║  Testing all pipelines end-to-end                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\nOrg ID: ${DEFAULT_ORG_ID}`);
  console.log(`Supabase: ${SUPABASE_URL}`);

  const startTime = Date.now();

  // Run all tests
  const docId = await testIngestion();
  await testSemanticSearch();
  const guestId = await testPipeline1();
  const interviewId = await testPipeline2();
  await testPipeline3(interviewId);
  await testPipeline4();
  await testPipeline5();
  await testAuditLog();

  // Cleanup
  await cleanup(docId, guestId, interviewId);

  // Summary
  const totalTime = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed (${totalTime}ms total)`);
  console.log("═══════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\n❌ SMOKE TEST FAILED");
    console.log("\nFailed tests:");
    results.filter((r) => !r.passed).forEach((r) => console.log(`  - ${r.message}`));
    process.exit(1);
  } else {
    console.log("\n✅ SMOKE TEST PASSED - All systems operational!");
    console.log("\n📋 Checklist:");
    console.log("  ✓ Document ingestion working");
    console.log("  ✓ Semantic search working");
    console.log("  ✓ Pipeline 1 (Guest Intelligence) working");
    console.log("  ✓ Pipeline 2 (Interview Intelligence) working");
    console.log("  ✓ Pipeline 3 (Content Repurposing) working");
    console.log("  ✓ Pipeline 4 (Outreach Automation) working");
    console.log("  ✓ Pipeline 5 (Quiz Segmentation) working");
    console.log("  ✓ Audit logging working");
  }
}

main().catch((err) => {
  console.error("\n💥 Unexpected error:", err);
  process.exit(1);
});
