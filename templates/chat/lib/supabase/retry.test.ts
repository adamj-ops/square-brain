/**
 * Tests for Supabase Exponential Backoff Retry Logic
 *
 * Run with: npx tsx lib/supabase/retry.test.ts
 * Or: pnpm exec tsx lib/supabase/retry.test.ts
 */

import {
  withRetry,
  withSupabaseRetry,
  isTransientError,
  isPostgrestError,
  calculateDelay,
  RetryExhaustedError,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "./retry";

// Test utilities
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    failed++;
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

// Mock PostgrestError (includes all required fields)
function createPostgrestError(
  code: string,
  message: string
): { name: string; code: string; message: string; details: string; hint: string } {
  return {
    name: "PostgrestError",
    code,
    message,
    details: "",
    hint: "",
  };
}

// Tests

async function testIsTransientError(): Promise<void> {
  console.log("\n--- isTransientError tests ---");

  // Test network errors
  assert(
    isTransientError(new Error("network timeout")),
    "Detects network timeout error"
  );
  assert(
    isTransientError(new Error("ECONNRESET")),
    "Detects ECONNRESET error"
  );
  assert(
    isTransientError(new Error("socket hang up")),
    "Detects socket hang up error"
  );
  assert(
    isTransientError(new Error("connection pool exhausted")),
    "Detects connection pool error"
  );
  assert(
    isTransientError(new Error("rate limit exceeded")),
    "Detects rate limit error"
  );

  // Test non-retryable errors
  assert(
    !isTransientError(new Error("Invalid input")),
    "Does not retry validation errors"
  );
  assert(
    !isTransientError(new Error("Foreign key constraint violation")),
    "Does not retry constraint violations"
  );
  assert(
    !isTransientError(null),
    "Handles null error"
  );
  assert(
    !isTransientError(undefined),
    "Handles undefined error"
  );

  // Test PostgrestError
  assert(
    isTransientError(createPostgrestError("53300", "Too many connections")),
    "Detects PostgreSQL too many connections"
  );
  assert(
    isTransientError(createPostgrestError("40P01", "Deadlock detected")),
    "Detects PostgreSQL deadlock"
  );
  assert(
    !isTransientError(createPostgrestError("23505", "Unique constraint violation")),
    "Does not retry unique constraint errors"
  );

  // Test response-like objects
  assert(
    isTransientError({ status: 429, message: "Rate limited" }),
    "Detects 429 status code"
  );
  assert(
    isTransientError({ status: 503, message: "Service unavailable" }),
    "Detects 503 status code"
  );
  assert(
    !isTransientError({ status: 400, message: "Bad request" }),
    "Does not retry 400 status"
  );
  assert(
    !isTransientError({ status: 404, message: "Not found" }),
    "Does not retry 404 status"
  );
}

async function testIsPostgrestError(): Promise<void> {
  console.log("\n--- isPostgrestError tests ---");

  assert(
    isPostgrestError({ code: "23505", message: "Duplicate", details: "", hint: "" }),
    "Detects full PostgrestError"
  );
  assert(
    isPostgrestError({ message: "Error", code: "PGRST301" }),
    "Detects minimal PostgrestError"
  );
  assert(
    !isPostgrestError(new Error("Regular error")),
    "Does not match regular Error"
  );
  assert(
    !isPostgrestError({ status: 500 }),
    "Does not match status-only object"
  );
  assert(
    !isPostgrestError(null),
    "Handles null"
  );
}

async function testCalculateDelay(): Promise<void> {
  console.log("\n--- calculateDelay tests ---");

  const config = { ...DEFAULT_RETRY_CONFIG, jitter: false };

  // Test exponential backoff
  const delay1 = calculateDelay(1, config);
  const delay2 = calculateDelay(2, config);
  const delay3 = calculateDelay(3, config);

  assert(delay1 === 100, `First attempt delay is 100ms (got ${delay1})`);
  assert(delay2 === 200, `Second attempt delay is 200ms (got ${delay2})`);
  assert(delay3 === 400, `Third attempt delay is 400ms (got ${delay3})`);

  // Test max delay cap
  const configWithLowMax = { ...config, maxDelayMs: 150 };
  const cappedDelay = calculateDelay(3, configWithLowMax);
  assert(cappedDelay === 150, `Delay is capped at maxDelayMs (got ${cappedDelay})`);

  // Test jitter adds variance
  const configWithJitter = { ...DEFAULT_RETRY_CONFIG, jitter: true };
  const jitteredDelays = new Set<number>();
  for (let i = 0; i < 10; i++) {
    jitteredDelays.add(calculateDelay(2, configWithJitter));
  }
  assert(
    jitteredDelays.size > 1,
    "Jitter produces varying delays"
  );
}

async function testWithRetrySuccess(): Promise<void> {
  console.log("\n--- withRetry success tests ---");

  // Test immediate success
  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    return "success";
  });

  assert(result.data === "success", "Returns correct data");
  assert(result.attempts === 1, "Records single attempt");
  assert(callCount === 1, "Only calls operation once on success");
}

async function testWithRetryWithTransientFailure(): Promise<void> {
  console.log("\n--- withRetry with transient failure tests ---");

  // Test retry on transient error then success
  let callCount = 0;
  const config: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 10,
    onRetry: () => {}, // Suppress logging
  };

  const result = await withRetry(async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error("network timeout");
    }
    return "success after retries";
  }, config);

  assert(result.data === "success after retries", "Returns data after retries");
  assert(result.attempts === 3, "Records correct number of attempts");
  assert(callCount === 3, "Called operation correct number of times");
}

async function testWithRetryExhaustion(): Promise<void> {
  console.log("\n--- withRetry exhaustion tests ---");

  const config: RetryConfig = {
    maxRetries: 2,
    initialDelayMs: 10,
    onRetry: () => {},
  };

  try {
    await withRetry(async () => {
      throw new Error("network timeout");
    }, config);
    assert(false, "Should have thrown RetryExhaustedError");
  } catch (error) {
    assert(error instanceof RetryExhaustedError, "Throws RetryExhaustedError");
    if (error instanceof RetryExhaustedError) {
      assert(error.attempts === 3, `Records all attempts (got ${error.attempts})`);
      assert(error.lastError instanceof Error, "Preserves last error");
    }
  }
}

async function testWithRetryNonRetryableError(): Promise<void> {
  console.log("\n--- withRetry non-retryable error tests ---");

  let callCount = 0;
  const config: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 10,
    onRetry: () => {},
  };

  try {
    await withRetry(async () => {
      callCount++;
      throw new Error("Invalid input data");
    }, config);
    assert(false, "Should have thrown error");
  } catch (error) {
    assert(error instanceof Error, "Throws original error");
    assert(!(error instanceof RetryExhaustedError), "Does not wrap non-retryable errors");
    assert(callCount === 1, "Does not retry non-retryable errors");
  }
}

async function testWithSupabaseRetry(): Promise<void> {
  console.log("\n--- withSupabaseRetry tests ---");

  // Test success case
  const data = await withSupabaseRetry(async () => ({
    data: { id: 1, name: "Test" },
    error: null,
  }));
  assert(data !== null && data.id === 1, "Returns data on success");

  // Test error case with retry
  let callCount = 0;
  const config: RetryConfig = {
    maxRetries: 2,
    initialDelayMs: 10,
    onRetry: () => {},
  };

  const retryData = await withSupabaseRetry(
    async () => {
      callCount++;
      if (callCount < 2) {
        return {
          data: null,
          error: createPostgrestError("53300", "Too many connections"),
        };
      }
      return {
        data: { id: 2 },
        error: null,
      };
    },
    config
  );
  assert(retryData !== null && retryData.id === 2, "Returns data after retry");
  assert(callCount === 2, "Retried on PostgrestError");
}

async function testCustomRetryConfig(): Promise<void> {
  console.log("\n--- Custom retry config tests ---");

  let retryCount = 0;
  const customConfig: RetryConfig = {
    maxRetries: 5,
    initialDelayMs: 5,
    maxDelayMs: 50,
    backoffFactor: 1.5,
    jitter: false,
    isRetryable: (err) => err instanceof Error && err.message.includes("custom"),
    onRetry: () => {
      retryCount++;
    },
  };

  // Test custom isRetryable
  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error("custom retryable error");
    }
    return "done";
  }, customConfig);

  assert(result.data === "done", "Custom retry config works");
  assert(retryCount === 2, `onRetry callback called (${retryCount} times)`);
}

// Run all tests
async function runTests(): Promise<void> {
  console.log("=== Supabase Retry Logic Tests ===\n");

  await testIsTransientError();
  await testIsPostgrestError();
  await testCalculateDelay();
  await testWithRetrySuccess();
  await testWithRetryWithTransientFailure();
  await testWithRetryExhaustion();
  await testWithRetryNonRetryableError();
  await testWithSupabaseRetry();
  await testCustomRetryConfig();

  console.log("\n=== Test Results ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
