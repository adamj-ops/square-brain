# Firecrawl Ingestion Endpoint

Internal endpoint for ingesting web content via Firecrawl into the RAG knowledge base.

## Overview

The `/api/internal/ingest/firecrawl` endpoint allows you to:
- **Scrape** a single URL into clean markdown
- **Crawl** a site starting from a URL (bounded)
- Normalize, dedupe, and ingest into `ai_docs` + `ai_chunks`

All content becomes searchable via `brain.semantic_search`.

## Authentication

All requests require the `X-Internal-Secret` header:

```
X-Internal-Secret: <INTERNAL_SHARED_SECRET>
```

Requests without valid auth return `401 Unauthorized`.

## Endpoint

```
POST /api/internal/ingest/firecrawl
```

### Request Body

```json
{
  "org_id": "string (optional, default: DEFAULT_ORG_ID)",
  "mode": "scrape" | "crawl",
  "url": "string (required, valid HTTP/HTTPS URL)",
  "source_type": "firecrawl" | "internal_docs" | "website" (default: "firecrawl"),
  "source_id": "string (optional, default: hostname)",
  "confidence": "high" | "medium" | "low" (default: "medium"),
  "tags": ["string"] (optional),
  "crawl": {
    "limit": "number (default: 10, max: 25)",
    "includePaths": ["string"] (optional),
    "excludePaths": ["string"] (optional)
  }
}
```

### Response

```json
{
  "ok": true,
  "mode": "scrape" | "crawl",
  "documents_processed": 5,
  "documents_skipped": 2,
  "chunks_created": 23,
  "docs": [
    {
      "url": "https://example.com/page",
      "doc_id": "uuid",
      "status": "ingested" | "skipped",
      "reason": "string (if skipped)"
    }
  ]
}
```

## Safety Limits

Hard caps enforced at multiple layers:

| Limit | Value | Layer |
|-------|-------|-------|
| Max markdown chars per page | 50,000 | Client |
| Max pages per crawl | 25 | Client |
| Max documents per request | 25 | Endpoint |
| Max chunks per request | 500 | Endpoint |
| Default crawl limit | 10 | Endpoint |

## Deduplication

Documents are deduplicated by content hash (SHA-256). Re-ingesting unchanged content is safe and fast (returns `status: "skipped", reason: "content unchanged"`).

## Examples

### A) Scrape Single URL

```bash
curl -X POST http://localhost:3000/api/internal/ingest/firecrawl \
  -H "X-Internal-Secret: $INTERNAL_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "scrape",
    "url": "https://example.com/docs/getting-started",
    "source_type": "website",
    "confidence": "medium"
  }'
```

### B) Crawl Site (Bounded)

```bash
curl -X POST http://localhost:3000/api/internal/ingest/firecrawl \
  -H "X-Internal-Secret: $INTERNAL_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "crawl",
    "url": "https://example.com/docs",
    "crawl": {
      "limit": 10,
      "excludePaths": ["/privacy", "/terms", "/legal"]
    },
    "source_type": "website",
    "confidence": "low",
    "tags": ["external", "documentation"]
  }'
```

### C) Health Check

```bash
curl http://localhost:3000/api/internal/ingest/firecrawl
```

Returns current limits configuration.

## Scheduling

This endpoint is designed to be called via cron for continuous ingestion:

### Vercel Cron (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/internal/ingest/firecrawl",
      "schedule": "0 2 * * *"
    }
  ]
}
```

Note: You'll need a wrapper endpoint or use Vercel's body parameter support.

### GitHub Actions

```yaml
name: Ingest External Docs
on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - name: Ingest docs.example.com
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/internal/ingest/firecrawl \
            -H "X-Internal-Secret: ${{ secrets.INTERNAL_SHARED_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{"mode":"crawl","url":"https://docs.example.com","crawl":{"limit":20}}'
```

## Tool Access

The `knowledge.ingest_firecrawl` tool implementation exists but is **not registered** in the assistant's tool registry due to Edge Runtime constraints (requires Node.js `crypto` module).

**Primary access method:** Use the HTTP endpoint directly via:
- Manual curl calls
- Scheduled cron jobs
- GitHub Actions workflows

If you need tool-based access in the future, the assistant route could be switched to Node.js runtime, or you can create a separate Node.js-only endpoint that exposes the tool.

## Error Handling

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Invalid input (malformed JSON, invalid URL, bad mode) |
| 401 | Missing or invalid X-Internal-Secret |
| 502 | Firecrawl API error (upstream failure) |
| 500 | Unexpected server error |

## Confidence Levels

| Level | Score | Use Case |
|-------|-------|----------|
| high | 0.9 | Official docs, primary sources |
| medium | 0.7 | Reputable third-party content |
| low | 0.5 | User-submitted, unverified sources |

## Related

- [Brain Overview](./brain-overview.md) - How the knowledge base works
- [Search Behavior](./search-behavior.md) - How semantic search retrieves content
- [Confidence Scoring](./confidence-scoring.md) - How confidence affects ranking
