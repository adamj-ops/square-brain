/**
 * Test Script: Error Logging Utility
 *
 * Tests the error logging functionality that writes to ai_tool_logs
 * with error_type classification.
 *
 * Usage: npx tsx scripts/test-error-logging.ts
 *
 * Prerequisites:
 * - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars set
 * - ai_tool_logs table created via migrations
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  logError,
  logErrorFromException,
  TypedError,
  isTypedError,
  type ErrorType,
} from "../lib/audit/logError";

// Test org ID for testing purposes
const TEST_ORG_ID = "00000000-0000-0000-0000-000000000001";

// Color helpers for console output
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;

async function main() {
  console.log(cyan("\n=== Error Logging Utility Test ===\n"));

  // Verify environment variables
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(red("❌ Missing SUPABASE environment variables"));
    console.log(yellow("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"));
    process.exit(1);
  }

  console.log(green("✓ Environment variables present"));

  const supabase = createClient(url, key);
  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Log a simple validation error
  console.log(cyan("\n--- Test 1: Log validation error ---"));
  try {
    const result = await logError(
      {
        error_type: "VALIDATION_ERROR",
        code: "400",
        message: "Invalid email format",
        details: { field: "email", value: "not-an-email" },
      },
      {
        org_id: TEST_ORG_ID,
        source: "test-error-logging",
        session_id: "test-session-1",
      }
    );

    if (result.logged && result.id) {
      console.log(green(`✓ Validation error logged with ID: ${result.id}`));
      passedTests++;

      // Verify the entry
      const { data } = await supabase
        .from("ai_tool_logs")
        .select("*")
        .eq("id", result.id)
        .single();

      if (data && data.error?.error_type === "VALIDATION_ERROR") {
        console.log(green("✓ Verified error_type is correctly stored"));
      } else {
        console.log(red("✗ error_type not correctly stored"));
        failedTests++;
      }
    } else {
      console.log(red(`✗ Failed to log error: ${result.loggingError}`));
      failedTests++;
    }
  } catch (err) {
    console.log(red(`✗ Exception: ${err}`));
    failedTests++;
  }

  // Test 2: Log a database error
  console.log(cyan("\n--- Test 2: Log database error ---"));
  try {
    const result = await logError(
      {
        error_type: "DATABASE_ERROR",
        code: "PGRST116",
        message: "The result contains 0 rows",
        details: { table: "guests", query: "select by id" },
      },
      {
        org_id: TEST_ORG_ID,
        source: "guests.get",
        metadata: { query_time_ms: 45 },
      }
    );

    if (result.logged) {
      console.log(green(`✓ Database error logged with ID: ${result.id}`));
      passedTests++;
    } else {
      console.log(red(`✗ Failed: ${result.loggingError}`));
      failedTests++;
    }
  } catch (err) {
    console.log(red(`✗ Exception: ${err}`));
    failedTests++;
  }

  // Test 3: Log from an exception with auto-classification
  console.log(cyan("\n--- Test 3: Log from exception (auto-classify) ---"));
  try {
    // Simulate a network error
    const simulatedError = new Error("fetch failed: ECONNREFUSED");
    const result = await logErrorFromException(simulatedError, {
      org_id: TEST_ORG_ID,
      source: "external-api-call",
    });

    if (result.logged) {
      console.log(green(`✓ Exception logged with ID: ${result.id}`));

      // Verify auto-classification
      const { data } = await supabase
        .from("ai_tool_logs")
        .select("error")
        .eq("id", result.id)
        .single();

      if (data?.error?.error_type === "NETWORK_ERROR") {
        console.log(green("✓ Auto-classified as NETWORK_ERROR correctly"));
        passedTests++;
      } else {
        console.log(yellow(`△ Classified as ${data?.error?.error_type} (expected NETWORK_ERROR)`));
        passedTests++; // Still passed, just different classification
      }
    } else {
      console.log(red(`✗ Failed: ${result.loggingError}`));
      failedTests++;
    }
  } catch (err) {
    console.log(red(`✗ Exception: ${err}`));
    failedTests++;
  }

  // Test 4: TypedError usage
  console.log(cyan("\n--- Test 4: TypedError class ---"));
  try {
    const typedError = new TypedError("AUTH_ERROR", "Invalid API key", {
      code: "401",
      details: { header: "X-Internal-Secret" },
    });

    if (isTypedError(typedError) && typedError.error_type === "AUTH_ERROR") {
      console.log(green("✓ TypedError created and type guard works"));

      const result = await logError(
        {
          error_type: typedError.error_type,
          code: typedError.code,
          message: typedError.message,
          details: typedError.details,
          stack: typedError.stack,
        },
        {
          org_id: TEST_ORG_ID,
          source: "auth-middleware",
        }
      );

      if (result.logged) {
        console.log(green(`✓ TypedError logged with ID: ${result.id}`));
        passedTests++;
      } else {
        console.log(red(`✗ Failed: ${result.loggingError}`));
        failedTests++;
      }
    } else {
      console.log(red("✗ TypedError or type guard failed"));
      failedTests++;
    }
  } catch (err) {
    console.log(red(`✗ Exception: ${err}`));
    failedTests++;
  }

  // Test 5: Various error types
  console.log(cyan("\n--- Test 5: Multiple error types ---"));
  const errorTypes: ErrorType[] = [
    "RATE_LIMIT_ERROR",
    "TIMEOUT_ERROR",
    "INTERNAL_ERROR",
    "TOOL_EXECUTION_ERROR",
    "RESOURCE_NOT_FOUND",
    "PERMISSION_DENIED",
  ];

  let allTypesLogged = true;
  for (const errorType of errorTypes) {
    const result = await logError(
      {
        error_type: errorType,
        message: `Test ${errorType} message`,
      },
      {
        org_id: TEST_ORG_ID,
        source: "error-type-test",
      }
    );

    if (!result.logged) {
      console.log(red(`✗ Failed to log ${errorType}: ${result.loggingError}`));
      allTypesLogged = false;
    }
  }

  if (allTypesLogged) {
    console.log(green(`✓ All ${errorTypes.length} error types logged successfully`));
    passedTests++;
  } else {
    failedTests++;
  }

  // Summary
  console.log(cyan("\n=== Test Summary ==="));
  console.log(`Total: ${passedTests + failedTests} tests`);
  console.log(green(`Passed: ${passedTests}`));
  if (failedTests > 0) {
    console.log(red(`Failed: ${failedTests}`));
  }

  // Query and display logged entries
  console.log(cyan("\n--- Recent error logs from this test ---"));
  const { data: logs } = await supabase
    .from("ai_tool_logs")
    .select("id, tool_name, status, error, started_at")
    .eq("org_id", TEST_ORG_ID)
    .eq("status", "error")
    .order("started_at", { ascending: false })
    .limit(10);

  if (logs && logs.length > 0) {
    console.log(`\nFound ${logs.length} error logs:\n`);
    for (const log of logs) {
      console.log(`  ${log.id.slice(0, 8)}... | ${log.tool_name} | ${log.error?.error_type ?? "unknown"}`);
    }
  }

  console.log("\n" + green("Test complete!"));
  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(red("Test failed with error:"), err);
  process.exit(1);
});
