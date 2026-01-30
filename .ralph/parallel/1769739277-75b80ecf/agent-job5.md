# Agent Job5 Report: Error Logging Utility

## Task
1A.5: Create error logging utility that writes to ai_tool_logs with error_type classification

## Status
✅ Completed

## What Changed

Created a comprehensive error logging utility that writes to the `ai_tool_logs` table with error type classification. The utility provides:

### Error Type Classifications
Defined 14 error types for categorizing errors:
- `VALIDATION_ERROR` - Input validation failures
- `DATABASE_ERROR` - Supabase/PostgreSQL errors
- `API_ERROR` - External API call failures
- `AUTH_ERROR` - Authentication/authorization failures
- `RATE_LIMIT_ERROR` - Rate limiting triggered
- `TIMEOUT_ERROR` - Operation timeout
- `NETWORK_ERROR` - Network connectivity issues
- `INTERNAL_ERROR` - Unexpected internal errors
- `TOOL_EXECUTION_ERROR` - Tool-specific execution failures
- `CONFIGURATION_ERROR` - Missing or invalid configuration
- `RESOURCE_NOT_FOUND` - Requested resource doesn't exist
- `PERMISSION_DENIED` - User lacks required permissions
- `CONFLICT_ERROR` - Resource conflict (e.g., duplicate)
- `UNKNOWN_ERROR` - Unclassified errors

### Main Functions
1. **`logError()`** - Log an error with explicit classification
2. **`logErrorFromException()`** - Log from caught exceptions with auto-classification
3. **`TypedError`** class - Create typed errors with built-in classification
4. **`isTypedError()`** - Type guard for TypedError instances

### Features
- Auto-classifies errors based on error message content
- Maps error types to HTTP-like status codes
- Stores full error context including stack traces (server-side only)
- Integrates with existing `ai_tool_logs` table structure
- Non-blocking (gracefully handles logging failures)

## Files Touched

| File | Action | Description |
|------|--------|-------------|
| `templates/chat/lib/audit/logError.ts` | Created | Main error logging utility |
| `templates/chat/lib/audit/index.ts` | Created | Barrel export for audit module |
| `templates/chat/scripts/test-error-logging.ts` | Created | Test script for the utility |

## How to Run Tests

```bash
cd templates/chat

# Install dependencies (if not done)
pnpm install

# Run the error logging test script (requires .env.local with Supabase credentials)
npx tsx scripts/test-error-logging.ts
```

**Prerequisites:**
- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- `ai_tool_logs` table created via `migrations/003_ai_tool_logs.sql`

## Usage Examples

```typescript
import { logError, logErrorFromException, TypedError } from "@/lib/audit";

// Log explicit error with classification
await logError(
  {
    error_type: "DATABASE_ERROR",
    code: "PGRST116",
    message: "Row not found",
    details: { table: "guests", id: "123" }
  },
  { org_id: "org-abc", source: "guests.get" }
);

// Log from caught exception (auto-classifies)
try {
  await someOperation();
} catch (err) {
  await logErrorFromException(err, { org_id: "org-abc", source: "api/guests" });
}

// Create typed error for consistent handling
throw new TypedError("VALIDATION_ERROR", "Email is required", {
  code: "400",
  details: { field: "email" }
});
```

## Gotchas

1. **Environment Variables Required**: The utility requires Supabase credentials to be set. It will gracefully fail and log to console if credentials are missing.

2. **Build Requires Env Vars**: The Next.js build (`pnpm build`) fails without env vars due to pre-existing code that initializes clients at module load time. TypeScript checking (`npx tsc --noEmit`) passes and is a better way to verify code correctness.

3. **Error Column Structure**: The `error_type` is stored inside the `error` JSONB column (not as a separate column), following the existing table schema.

4. **Non-blocking**: Logging failures don't throw - they return `{ logged: false, loggingError: "..." }` to avoid breaking application flow.
