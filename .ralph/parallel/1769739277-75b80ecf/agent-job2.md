# Agent Job2 Report: Add Try-Catch Wrappers to API Routes

## Task
1A.2: Add try-catch wrappers to all API routes with structured error responses (code, message, details)

## Summary of Changes

Created a centralized API error utilities module and updated all 12 API routes to use consistent, structured error responses.

## Files Changed

### New Files
1. **`templates/chat/lib/api/errors.ts`** - New centralized API error utilities module
   - Defines `ApiErrorCode` type with standard error codes
   - Exports `createApiError()` for NextResponse-based routes
   - Exports `createApiErrorResponse()` for plain Response routes (edge runtime)
   - Exports helper functions: `getErrorMessage()`, `isValidationError()`
   - Maps error codes to HTTP status codes

### Modified Files

2. **`templates/chat/app/api/conversations/route.ts`**
   - Added try-catch wrappers to GET and POST handlers
   - Replaced simple error responses with structured `{ code, message, details }`
   - Added configuration error check for DEFAULT_ORG_ID

3. **`templates/chat/app/api/conversations/[id]/messages/route.ts`**
   - Added try-catch wrappers to GET and POST handlers
   - Structured error responses with validation details

4. **`templates/chat/app/api/tools/execute/route.ts`**
   - Wrapped entire POST handler in try-catch
   - Mapped tool error codes to API error codes
   - Added structured error response format

5. **`templates/chat/app/api/internal/brain/upsert-item/route.ts`**
   - Added outer try-catch wrapper
   - Structured errors for validation and DB failures

6. **`templates/chat/app/api/internal/brain/search/route.ts`**
   - Added outer try-catch wrapper
   - Structured validation errors with allowed values

7. **`templates/chat/app/api/internal/ingest/firecrawl/route.ts`**
   - Added try-catch to POST and GET handlers
   - Categorized errors as VALIDATION_ERROR, UPSTREAM_ERROR, or INTERNAL_ERROR

8. **`templates/chat/app/api/internal/ingest/docs/route.ts`**
   - Added outer try-catch wrappers to POST and GET
   - Structured validation and ingestion errors

9. **`templates/chat/app/api/internal/ingest/apify/route.ts`**
   - Added outer try-catch wrapper to POST
   - Added try-catch to GET handler
   - Improved error categorization (FORBIDDEN for actor allowlist)

10. **`templates/chat/app/api/internal/rag/ingest/route.ts`**
    - Added outer try-catch wrapper
    - Structured all validation errors

11. **`templates/chat/app/api/internal/rag/process-pending/route.ts`**
    - Added try-catch to POST and GET handlers
    - Structured DB and processing errors

12. **`templates/chat/app/api/internal/jobs/theme-scanner/route.ts`**
    - Added try-catch to POST and GET handlers
    - Structured validation and job errors

13. **`templates/chat/app/api/assistant/run/route.ts`**
    - Added outer try-catch wrapper for setup phase
    - Created local `createErrorResponse` helper for edge runtime
    - Structured validation errors for messages and config

## Error Response Format

All API routes now return errors in this consistent format:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable error message",
  "details": {
    "field": "fieldName",
    "originalError": "...",
    "allowed": ["value1", "value2"]
  }
}
```

### Error Codes
- `UNAUTHORIZED` (401) - Missing/invalid auth
- `FORBIDDEN` (403) - Action not allowed
- `BAD_REQUEST` (400) - Malformed request
- `VALIDATION_ERROR` (400) - Invalid input data
- `NOT_FOUND` (404) - Resource not found
- `CONFLICT` (409) - Resource conflict
- `INTERNAL_ERROR` (500) - Unexpected server error
- `UPSTREAM_ERROR` (502) - External service failure
- `SERVICE_UNAVAILABLE` (503) - Service unavailable
- `CONFIGURATION_ERROR` (500) - Missing config/env vars

## How to Test

Since this is a parallel worktree without installed dependencies, testing requires:

1. Install dependencies in the chat template:
   ```bash
   cd templates/chat
   npm install
   ```

2. Run type check:
   ```bash
   npm run build
   ```

3. Test API endpoints manually or with curl:
   ```bash
   # Test validation error
   curl -X POST http://localhost:3000/api/conversations \
     -H "Content-Type: application/json" \
     -d '{}'
   
   # Test auth error on internal routes
   curl http://localhost:3000/api/internal/brain/search
   ```

## Gotchas

1. **Edge Runtime Routes**: The `assistant/run` route uses edge runtime which doesn't support NextResponse.json() the same way. Used a local helper function instead of the shared utility.

2. **Health Check Endpoints**: GET endpoints that serve as health checks (like theme-scanner, firecrawl, apify) now have try-catch wrappers even though they're unlikely to fail - ensures consistency.

3. **Streaming Routes**: The assistant/run route has internal error handling for streaming. The outer try-catch only catches setup errors before streaming begins.

4. **Original Error Preservation**: The `details.originalError` field preserves the original error message for debugging while providing a user-friendly message.
