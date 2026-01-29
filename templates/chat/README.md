# LifeRX Brain

An intelligent knowledge management and AI assistant system with 5 production-ready pipelines for podcast production, guest research, content repurposing, outreach automation, and audience segmentation.

## System Overview

LifeRX Brain is a comprehensive AI platform built for podcasters and content creators:

- **Brain Memory**: Structured knowledge storage with versioning and semantic search
- **Streaming Chat**: Real-time conversational AI with OpenAI integration
- **Tool Executor**: 14 registered tools with full audit logging
- **RAG Search**: Vector-based document retrieval using pgvector
- **5 Pipelines**: Guest Intelligence, Interview Intelligence, Content Repurposing, Outreach Automation, Quiz Segmentation

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: OpenAI GPT-4o / text-embedding-3-small
- **Ingestion**: Firecrawl for web scraping
- **Email**: Resend for outreach
- **State**: Zustand
- **UI**: Tailwind CSS + Radix UI

## The 5 Pipelines

### Pipeline 1: Guest Intelligence
Research and score potential podcast guests with explainable scoring.

**Tables**: `guests`, `guest_profiles`, `guest_signals`, `guest_scores`

**Tools**:
- `guests.upsert_profile` - Create/update guest profiles
- `guests.extract_signals` - Store signals with weights
- `scoring.score_guest` - Calculate comprehensive scores (0-100)

```bash
# Test Pipeline 1
npx tsx scripts/test-guest-ranking.ts
```

### Pipeline 2: Interview Intelligence
Extract and organize quotes, themes, and insights from interviews.

**Tables**: `interviews`, `interview_quotes`, `themes`, `interview_themes`

**Tools**:
- `interviews.add_quote` - Store interview quotes with timestamps
- `themes.upsert_theme` - Create/update themes
- `themes.link_to_interview` - Link themes to interviews

```bash
# Test Pipeline 2
npx tsx scripts/test-interview-themes.ts
```

### Pipeline 3: Content Repurposing
Generate content assets from interviews (quote cards, carousels, scripts).

**Tables**: `content_assets`

**Tools**:
- `content.generate_assets` - Generate multiple asset types

```bash
# Test via full smoke test
npx tsx scripts/full-smoke-test.ts
```

### Pipeline 4: Outreach Automation
Human-in-the-loop email outreach with approval workflow.

**Tables**: `outreach_sequences`, `outreach_messages`, `outreach_events`

**Tools**:
- `outreach.compose_message` - Draft messages (requires approval)
- `outreach.send_email` - Send approved messages via Resend

```bash
# Test via full smoke test
npx tsx scripts/full-smoke-test.ts
```

### Pipeline 5: Audience & Quiz Segmentation
Score quizzes with interdependency scoring and assign audience segments.

**Tables**: `quiz_responses`, `audience_segments`, `segment_rules`, `ctas`

**Tools**:
- `audience.score_quiz` - Score with interdependency modifiers
- `audience.assign_segment` - Assign segment and suggest CTAs

```bash
# Test Pipeline 5
npx tsx scripts/test-quiz-segmentation.ts
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Supabase project with pgvector extension enabled
- OpenAI API key
- (Optional) Firecrawl API key for web scraping
- (Optional) Resend API key for email sending

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.local.example .env.local

# Edit .env.local with your credentials
```

### Environment Variables

See `.env.local.example` for all required and optional environment variables:

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
OPENAI_API_KEY=your-openai-key
DEFAULT_ORG_ID=your-org-id
INTERNAL_SHARED_SECRET=your-internal-secret

# Optional
FIRECRAWL_API_KEY=your-firecrawl-key
RESEND_API_KEY=your-resend-key
```

### Database Migrations

Run migrations in order against your Supabase database:

```bash
# Via Supabase SQL Editor or CLI
migrations/003_ai_tool_logs.sql       # Audit logging
migrations/004_ai_docs_chunks.sql     # RAG storage + vector search
migrations/005_messages_assumptions.sql
migrations/006_themes.sql             # Theme extraction
migrations/007_guest_intelligence.sql # Pipeline 1
migrations/008_interview_intelligence.sql # Pipeline 2
migrations/009_content_assets.sql     # Pipeline 3
migrations/010_outreach.sql           # Pipeline 4
migrations/011_audience_quiz.sql      # Pipeline 5
```

### Running the App

```bash
# Development
pnpm dev

# Production build
pnpm build
pnpm start
```

## API Reference

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/assistant/run` | POST | Streaming chat with tool support |
| `/api/conversations` | GET/POST | Conversation management |
| `/api/conversations/[id]/messages` | GET | Message history |

### Internal Endpoints (X-Internal-Secret required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/internal/brain/search` | POST | Search brain items |
| `/api/internal/brain/upsert-item` | POST | Create/update brain items |
| `/api/internal/ingest/firecrawl` | POST | Web scraping ingestion |
| `/api/internal/ingest/docs` | POST | Markdown docs ingestion |
| `/api/internal/ingest/apify` | POST | Apify actor payloads |
| `/api/internal/rag/ingest` | POST | Document ingestion |
| `/api/internal/rag/process-pending` | POST | Process pending embeddings |
| `/api/internal/jobs/theme-scanner` | POST | Run theme extraction |

### Tool Executor

Execute any registered tool via:

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "X-Internal-Secret: $INTERNAL_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "brain.semantic_search",
    "args": { "query": "health optimization", "limit": 5 },
    "context": { "org_id": "your-org-id", "allowWrites": false }
  }'
```

### Registered Tools

**Core Tools:**
- `brain.upsert_item` - Create/update brain items
- `brain.search_items` - Search structured brain items
- `brain.semantic_search` - Semantic/hybrid search

**Pipeline 1 - Guest Intelligence:**
- `guests.upsert_profile` - Create/update guest profiles
- `guests.extract_signals` - Extract scoring signals
- `scoring.score_guest` - Calculate guest scores

**Pipeline 2 - Interview Intelligence:**
- `interviews.add_quote` - Add interview quotes
- `themes.upsert_theme` - Create/update themes
- `themes.link_to_interview` - Link themes to interviews

**Pipeline 3 - Content Repurposing:**
- `content.generate_assets` - Generate content assets

**Pipeline 4 - Outreach Automation:**
- `outreach.compose_message` - Draft outreach messages
- `outreach.send_email` - Send approved emails

**Pipeline 5 - Quiz Segmentation:**
- `audience.score_quiz` - Score quiz responses
- `audience.assign_segment` - Assign audience segments

## Testing

```bash
# Type checking and build
pnpm build

# Lint
pnpm lint

# Full system smoke test (all pipelines)
npx tsx scripts/full-smoke-test.ts

# Individual pipeline tests
npx tsx scripts/test-guest-ranking.ts      # Pipeline 1
npx tsx scripts/test-interview-themes.ts   # Pipeline 2
npx tsx scripts/test-quiz-segmentation.ts  # Pipeline 5

# Basic tool smoke test
npx tsx scripts/tool-smoke-test.ts
```

## Security

- **Internal Auth**: All `/api/internal/*` routes require `X-Internal-Secret` header
- **Org Scoping**: All database operations require `org_id` filter
- **Audit Logging**: All tool executions logged to `ai_tool_logs`
- **Human-in-the-Loop**: Outreach emails require explicit approval
- **No Tool Args to UI**: Sensitive tool arguments never sent to client

## Documentation

See the `docs/` folder for detailed documentation:

- `brain-overview.md` - Brain system architecture
- `brain-tools.md` - Tool usage guide
- `brain-item-types.md` - Item type reference
- `brain-sources.md` - Source configuration
- `search-behavior.md` - Search configuration
- `confidence-scoring.md` - Confidence system
- `internal-ingestion-firecrawl.md` - Firecrawl setup
- `cron-jobs.md` - Background job configuration

## Release Notes

### Version 1.0 (2026-01-29)

- ✅ Phase A: Platform Completion & Cleanup
- ✅ Phase B: Ingestion & Knowledge
- ✅ Pipeline 1: Guest Intelligence
- ✅ Pipeline 2: Interview Intelligence
- ✅ Pipeline 3: Content Repurposing
- ✅ Pipeline 4: Outreach Automation
- ✅ Pipeline 5: Audience & Quiz Segmentation
- ✅ Final Phase: Integration & Release

All 5 pipelines production-ready with full tool support and audit logging.
