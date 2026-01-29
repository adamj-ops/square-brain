# Cron Jobs & Background Jobs

The Brain system supports background jobs that run periodically to compound knowledge over time.

## Theme Scanner Job

**Endpoint**: `POST /api/internal/jobs/theme-scanner`

**Purpose**: Scans content (brain_items, ai_docs) to extract recurring themes and create evidence links.

### How It Works

1. Fetches unscanned content from the database
2. Uses GPT-4o-mini to extract themes from each piece of content
3. Creates/updates theme records in the `themes` table
4. Links content to themes in the `content_themes` table
5. Tracks mention counts and evidence counts

### Authentication

Requires `X-Internal-Secret` header matching `INTERNAL_SHARED_SECRET` environment variable.

### Request Body

```json
{
  "action": "scan",           // or "list_themes"
  "org_id": "your-org-id",   // optional if DEFAULT_ORG_ID is set
  "content_types": ["brain_item", "ai_doc"],  // optional, defaults to both
  "since": "2024-01-01T00:00:00Z",  // optional, only scan content updated after
  "limit": 50,               // optional, max items to scan (default: 50)
  "force": false             // optional, rescan already-scanned items
}
```

### Response

```json
{
  "success": true,
  "action": "scan",
  "result": {
    "scanned_count": 25,
    "themes_created": 8,
    "themes_updated": 12,
    "links_created": 35,
    "errors": 0,
    "duration_ms": 15420
  }
}
```

### Manual Trigger

```bash
curl -X POST http://localhost:3000/api/internal/jobs/theme-scanner \
  -H "X-Internal-Secret: $INTERNAL_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action": "scan", "org_id": "your-org-id"}'
```

### List Themes

```bash
curl -X POST http://localhost:3000/api/internal/jobs/theme-scanner \
  -H "X-Internal-Secret: $INTERNAL_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_themes", "org_id": "your-org-id"}'
```

## Cron Setup (Future)

### Vercel Cron

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/internal/jobs/theme-scanner",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

Note: Vercel Cron requires `CRON_SECRET` validation. Update the endpoint to check:
```typescript
const cronSecret = req.headers.get("Authorization")?.replace("Bearer ", "");
if (cronSecret !== process.env.CRON_SECRET) { ... }
```

### GitHub Actions

```yaml
name: Theme Scanner
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger theme scanner
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/internal/jobs/theme-scanner \
            -H "X-Internal-Secret: ${{ secrets.INTERNAL_SHARED_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{"action": "scan", "org_id": "${{ secrets.DEFAULT_ORG_ID }}"}'
```

### Recommended Schedule

| Job | Frequency | Rationale |
|-----|-----------|-----------|
| Theme Scanner | Every 6 hours | Balance freshness vs. API costs |
| RAG Sync | On content change | Keep embeddings fresh |
| Confidence Decay | Daily | Gradually reduce stale item confidence |

## Job Idempotency

All jobs are designed to be idempotent:
- Theme scanner skips already-scanned content (unless `force: true`)
- Duplicate theme links are upserted, not duplicated
- Failed runs can be safely retried

## Monitoring

Check job status:
- `GET /api/internal/jobs/theme-scanner` returns health status
- Server logs include `[theme-scanner]` prefix for filtering
- Result includes `duration_ms` for performance tracking
