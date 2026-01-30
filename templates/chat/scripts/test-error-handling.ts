#!/usr/bin/env tsx
/**
 * Test Script: Error Handling & Resilience (Checkpoint 1A)
 *
 * Verifies:
 * 1. Error boundary component exists and exports correctly
 * 2. Retry logic with exponential backoff works
 * 3. Error logging utility with error_type classification works
 *
 * Run: pnpm tsx scripts/test-error-handling.ts
 */

import {
  withRetry,
  retry,
  isRetryableError,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
  createRetryClient,
  type RetryConfig,
} from "../lib/supabase-retry";

import {
  logError,
  logErrorObject,
  classifyError,
  determineSeverity,
  createErrorLogger,
  type ErrorType,
  type ErrorLogEntry,
} from "../lib/error-logger";

// Track test results
let passedTests = 0;
let failedTests = 0;

function log(message: string) {
  console.log(`[test] ${message}`);
}

function pass(testName: string) {
  passedTests++;
  console.log(`✅ PASS: ${testName}`);
}

function fail(testName: string, error?: string) {
  failedTests++;
  console.error(`❌ FAIL: ${testName}${error ? ` - ${error}` : ""}`);
}

function section(name: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ============================================================
// TEST 1: Error Boundary Component
// ============================================================

async function testErrorBoundaryExists() {
  section("Error Boundary Component Tests");

  try {
    // Dynamic import to verify the component exists and exports correctly
    const { ErrorBoundary } = await import("../components/error-boundary");

    if (typeof ErrorBoundary === "function") {
      pass("ErrorBoundary component exists and is a function/class");
    } else {
      fail("ErrorBoundary is not a function/class", typeof ErrorBoundary);
    }

    // Verify it's a React component (has prototype with render method for class components)
    if (ErrorBoundary.prototype && typeof ErrorBoundary.prototype.render === "function") {
      pass("ErrorBoundary is a class component with render method");
    } else {
      fail("ErrorBoundary doesn't have expected class component structure");
    }

    // Verify getDerivedStateFromError exists (required for error boundaries)
    if (typeof (ErrorBoundary as any).getDerivedStateFromError === "function") {
      pass("ErrorBoundary has getDerivedStateFromError static method");
    } else {
      fail("ErrorBoundary missing getDerivedStateFromError");
    }

    // Verify componentDidCatch exists on prototype
    if (typeof ErrorBoundary.prototype.componentDidCatch === "function") {
      pass("ErrorBoundary has componentDidCatch method");
    } else {
      fail("ErrorBoundary missing componentDidCatch");
    }
  } catch (err) {
    fail("Failed to import ErrorBoundary", err instanceof Error ? err.message : String(err));
  }
}

// ============================================================
// TEST 2: Retry Logic
// ============================================================

async function testRetryLogic() {
  section("Retry Logic Tests");

  // Test 2.1: isRetryableError - connection errors
  const connectionError = { message: "Connection refused", code: "08006" };
  if (isRetryableError(connectionError)) {
    pass("isRetryableError identifies connection errors as retryable");
  } else {
    fail("isRetryableError should identify connection errors as retryable");
  }

  // Test 2.2: isRetryableError - timeout errors
  const timeoutError = { message: "Query timed out" };
  if (isRetryableError(timeoutError)) {
    pass("isRetryableError identifies timeout errors as retryable");
  } else {
    fail("isRetryableError should identify timeout errors as retryable");
  }

  // Test 2.3: isRetryableError - rate limit errors
  const rateLimitError = { message: "Rate limit exceeded", status: 429 };
  if (isRetryableError(rateLimitError)) {
    pass("isRetryableError identifies rate limit errors as retryable");
  } else {
    fail("isRetryableError should identify rate limit errors as retryable");
  }

  // Test 2.4: isRetryableError - non-retryable errors
  const validationError = { message: "Invalid email format" };
  if (!isRetryableError(validationError)) {
    pass("isRetryableError correctly identifies non-retryable errors");
  } else {
    fail("Validation error should not be retryable");
  }

  // Test 2.5: calculateRetryDelay - exponential backoff
  const delay0 = calculateRetryDelay(0, { ...DEFAULT_RETRY_CONFIG, useJitter: false });
  const delay1 = calculateRetryDelay(1, { ...DEFAULT_RETRY_CONFIG, useJitter: false });
  const delay2 = calculateRetryDelay(2, { ...DEFAULT_RETRY_CONFIG, useJitter: false });

  if (delay1 === delay0 * 2) {
    pass(`Exponential backoff: delay1 (${delay1}ms) = delay0 (${delay0}ms) * 2`);
  } else {
    fail(`Exponential backoff failed: expected ${delay0 * 2}, got ${delay1}`);
  }

  if (delay2 === delay0 * 4) {
    pass(`Exponential backoff: delay2 (${delay2}ms) = delay0 (${delay0}ms) * 4`);
  } else {
    fail(`Exponential backoff failed: expected ${delay0 * 4}, got ${delay2}`);
  }

  // Test 2.6: calculateRetryDelay - respects maxDelayMs
  const hugeDelay = calculateRetryDelay(100, {
    ...DEFAULT_RETRY_CONFIG,
    useJitter: false,
    maxDelayMs: 5000,
  });
  if (hugeDelay === 5000) {
    pass(`Max delay cap works: delay capped at ${hugeDelay}ms`);
  } else {
    fail(`Max delay cap failed: expected 5000, got ${hugeDelay}`);
  }

  // Test 2.7: calculateRetryDelay - jitter adds randomization
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, useJitter: true };
  const jitterDelays = new Set<number>();
  for (let i = 0; i < 10; i++) {
    jitterDelays.add(calculateRetryDelay(1, config));
  }
  if (jitterDelays.size > 1) {
    pass(`Jitter produces varied delays: ${jitterDelays.size} unique values from 10 samples`);
  } else {
    fail("Jitter should produce varied delays");
  }

  // Test 2.8: withRetry - succeeds on first try
  let successCalls = 0;
  const successResult = await withRetry(async () => {
    successCalls++;
    return { data: { id: 1 }, error: null };
  });

  if (successResult.success && successResult.attempts === 1 && successCalls === 1) {
    pass("withRetry succeeds on first try without retrying");
  } else {
    fail(`withRetry first-try behavior: attempts=${successResult.attempts}, calls=${successCalls}`);
  }

  // Test 2.9: withRetry - retries on retryable error then succeeds
  let retryCalls = 0;
  const retryResult = await withRetry(
    async () => {
      retryCalls++;
      if (retryCalls < 3) {
        return { data: null, error: { message: "Connection timeout", code: "08001" } as any };
      }
      return { data: { id: 2 }, error: null };
    },
    { maxRetries: 3, baseDelayMs: 10, useJitter: false }
  );

  if (retryResult.success && retryResult.attempts === 3 && retryCalls === 3) {
    pass(`withRetry retries and succeeds: ${retryResult.attempts} attempts`);
  } else {
    fail(`withRetry retry behavior: success=${retryResult.success}, attempts=${retryResult.attempts}, calls=${retryCalls}`);
  }

  // Test 2.10: withRetry - fails on non-retryable error immediately
  let nonRetryableCalls = 0;
  const nonRetryableResult = await withRetry(
    async () => {
      nonRetryableCalls++;
      return { data: null, error: { message: "Invalid input", code: "22001" } as any };
    },
    { maxRetries: 3, baseDelayMs: 10 }
  );

  if (!nonRetryableResult.success && nonRetryableResult.attempts === 1) {
    pass("withRetry fails immediately on non-retryable error");
  } else {
    fail(`Non-retryable handling: attempts=${nonRetryableResult.attempts}, should be 1`);
  }

  // Test 2.11: retry - simple retry wrapper
  let simpleRetryCalls = 0;
  try {
    const result = await retry(
      async () => {
        simpleRetryCalls++;
        if (simpleRetryCalls < 2) {
          throw new Error("Network error");
        }
        return "success";
      },
      { maxRetries: 2, baseDelayMs: 10 }
    );
    if (result === "success" && simpleRetryCalls === 2) {
      pass(`Simple retry wrapper works: ${simpleRetryCalls} calls`);
    } else {
      fail(`Simple retry failed: result=${result}, calls=${simpleRetryCalls}`);
    }
  } catch (err) {
    fail(`Simple retry threw unexpectedly: ${err}`);
  }
}

// ============================================================
// TEST 3: Error Logging
// ============================================================

async function testErrorLogging() {
  section("Error Logging Tests");

  // Test 3.1: classifyError - network errors
  const networkError = new TypeError("Failed to fetch");
  const networkType = classifyError(networkError);
  if (networkType === "network_error") {
    pass("classifyError identifies network errors");
  } else {
    fail(`classifyError network: expected network_error, got ${networkType}`);
  }

  // Test 3.2: classifyError - timeout errors
  const timeoutType = classifyError(new Error("Request timed out"));
  if (timeoutType === "timeout_error") {
    pass("classifyError identifies timeout errors");
  } else {
    fail(`classifyError timeout: expected timeout_error, got ${timeoutType}`);
  }

  // Test 3.3: classifyError - database errors
  const dbType = classifyError(new Error("PostgreSQL connection failed"));
  if (dbType === "database_error") {
    pass("classifyError identifies database errors");
  } else {
    fail(`classifyError database: expected database_error, got ${dbType}`);
  }

  // Test 3.4: classifyError - validation errors
  const valType = classifyError(new Error("Validation failed: email is invalid"));
  if (valType === "validation_error") {
    pass("classifyError identifies validation errors");
  } else {
    fail(`classifyError validation: expected validation_error, got ${valType}`);
  }

  // Test 3.5: classifyError - rate limit errors
  const rateType = classifyError(new Error("Rate limit exceeded, too many requests"));
  if (rateType === "rate_limit_error") {
    pass("classifyError identifies rate limit errors");
  } else {
    fail(`classifyError rate limit: expected rate_limit_error, got ${rateType}`);
  }

  // Test 3.6: classifyError - auth errors
  const authType = classifyError(new Error("Unauthorized access"));
  if (authType === "authentication_error") {
    pass("classifyError identifies auth errors");
  } else {
    fail(`classifyError auth: expected authentication_error, got ${authType}`);
  }

  // Test 3.7: determineSeverity - critical for database errors
  const dbSeverity = determineSeverity("database_error");
  if (dbSeverity === "critical") {
    pass("determineSeverity: database_error is critical");
  } else {
    fail(`determineSeverity: expected critical for database_error, got ${dbSeverity}`);
  }

  // Test 3.8: determineSeverity - medium for network errors
  const netSeverity = determineSeverity("network_error");
  if (netSeverity === "medium") {
    pass("determineSeverity: network_error is medium");
  } else {
    fail(`determineSeverity: expected medium for network_error, got ${netSeverity}`);
  }

  // Test 3.9: determineSeverity - low for validation errors
  const valSeverity = determineSeverity("validation_error");
  if (valSeverity === "low") {
    pass("determineSeverity: validation_error is low");
  } else {
    fail(`determineSeverity: expected low for validation_error, got ${valSeverity}`);
  }

  // Test 3.10: createErrorLogger returns logger with methods
  const logger = createErrorLogger({ org_id: "test_org", session_id: "test_session" });
  if (typeof logger.log === "function" && typeof logger.logEntry === "function") {
    pass("createErrorLogger returns logger with log and logEntry methods");
  } else {
    fail("createErrorLogger should return logger with expected methods");
  }

  // Test 3.11: logError function exists and has correct signature
  if (typeof logError === "function") {
    pass("logError function exists");
  } else {
    fail("logError function should exist");
  }

  // Test 3.12: logErrorObject function exists
  if (typeof logErrorObject === "function") {
    pass("logErrorObject function exists");
  } else {
    fail("logErrorObject function should exist");
  }

  // Note: We can't test actual database writes without a live Supabase connection
  log("Note: Database write tests skipped (requires live Supabase connection)");
}

// ============================================================
// TEST 4: Integration Check - Layout has ErrorBoundary
// ============================================================

async function testLayoutIntegration() {
  section("Layout Integration Tests");

  try {
    // Read the layout file to verify ErrorBoundary is used
    const fs = await import("fs/promises");
    const layoutContent = await fs.readFile("./app/layout.tsx", "utf-8");

    if (layoutContent.includes('import { ErrorBoundary }') || layoutContent.includes('import {ErrorBoundary}')) {
      pass("Layout imports ErrorBoundary component");
    } else {
      fail("Layout should import ErrorBoundary component");
    }

    if (layoutContent.includes("<ErrorBoundary>")) {
      pass("Layout wraps children with ErrorBoundary");
    } else {
      fail("Layout should wrap children with ErrorBoundary");
    }

    if (layoutContent.includes("</ErrorBoundary>")) {
      pass("Layout properly closes ErrorBoundary");
    } else {
      fail("Layout should properly close ErrorBoundary");
    }
  } catch (err) {
    fail("Failed to read layout.tsx", err instanceof Error ? err.message : String(err));
  }
}

// ============================================================
// TEST 5: API Endpoint Exists
// ============================================================

async function testLogErrorEndpoint() {
  section("Log Error API Endpoint Tests");

  try {
    const fs = await import("fs/promises");
    const routeContent = await fs.readFile("./app/api/internal/log-error/route.ts", "utf-8");

    if (routeContent.includes("export async function POST")) {
      pass("Log error API endpoint has POST handler");
    } else {
      fail("Log error API should have POST handler");
    }

    if (routeContent.includes("logError")) {
      pass("Log error API uses logError function");
    } else {
      fail("Log error API should use logError function");
    }

    if (routeContent.includes("error_type") && routeContent.includes("error_message")) {
      pass("Log error API handles error_type and error_message");
    } else {
      fail("Log error API should handle error_type and error_message");
    }
  } catch (err) {
    fail("Failed to read log-error route.ts", err instanceof Error ? err.message : String(err));
  }
}

// ============================================================
// Run All Tests
// ============================================================

async function runAllTests() {
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   CHECKPOINT 1A: Error Handling & Resilience Tests         ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  await testErrorBoundaryExists();
  await testRetryLogic();
  await testErrorLogging();
  await testLayoutIntegration();
  await testLogErrorEndpoint();

  section("Test Summary");
  console.log(`Total Passed: ${passedTests}`);
  console.log(`Total Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%\n`);

  if (failedTests === 0) {
    console.log("🎉 All tests passed! Checkpoint 1A is verified.\n");
    process.exit(0);
  } else {
    console.log(`⚠️  ${failedTests} test(s) failed. Please review.\n`);
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Fatal error running tests:", err);
  process.exit(1);
});
