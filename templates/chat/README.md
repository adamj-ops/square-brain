# LifeRX Brain

An intelligent knowledge management and AI assistant system built with Next.js, Supabase, and OpenAI.

## Overview

LifeRX Brain is a production-ready AI assistant platform that features:

- **Streaming Chat**: Real-time conversational AI with OpenAI integration
- **Tool Registry & Executor**: Extensible tool system with audit logging
- **Brain Memory**: Structured knowledge storage with versioning
- **RAG Semantic Search**: Vector-based document retrieval using pgvector
- **Theme Scanner**: Background job for extracting themes from content

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: OpenAI GPT-4o / text-embedding-3-small
- **Ingestion**: Firecrawl for web scraping
- **State**: Zustand
- **UI**: Tailwind CSS + Radix UI

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Supabase project with pgvector extension enabled
- OpenAI API key
- (Optional) Firecrawl API key for web scraping

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.local.example .env.local

# Edit .env.local with your credentials
```

### Environment Variables

See `.env.local.example` for all required and optional environment variables.

### Database Migrations

Run migrations in order against your Supabase database:

```bash
# Via Supabase SQL Editor or CLI
migrations/003_ai_tool_logs.sql      # Audit logging for tool executions
migrations/004_ai_docs_chunks.sql    # RAG document storage + vector search
migrations/005_messages_assumptions.sql  # Message assumptions tracking
migrations/006_themes.sql            # Theme extraction and linking
```

The migrations create:
- `ai_tool_logs`: Audit trail for all tool executions
- `ai_docs`: Parent documents/sources for RAG
- `ai_chunks`: Embedded chunks with vector indexes
- `themes`: Extracted themes from content
- `content_themes`: Evidence linking themes to content

### Running the App

```bash
# Development
pnpm dev

# Production build
pnpm build
pnpm start
```

## Architecture

### API Routes

**Public:**
- `POST /api/assistant/run` - Streaming chat with tool support
- `GET/POST /api/conversations` - Conversation management
- `GET /api/conversations/[id]/messages` - Message history

**Internal (requires X-Internal-Secret header):**
- `POST /api/internal/brain/search` - Search brain items
- `POST /api/internal/brain/upsert-item` - Create/update brain items
- `POST /api/internal/ingest/firecrawl` - Web scraping ingestion
- `POST /api/internal/rag/ingest` - Document ingestion
- `POST /api/internal/rag/process-pending` - Process pending embeddings
- `POST /api/internal/jobs/theme-scanner` - Run theme extraction

### Tool System

Tools are registered in `lib/tools/registry.ts` and executed via `lib/tools/executeTool.ts`. Every tool execution is logged to `ai_tool_logs` for auditing.

Available tools:
- `brain.semantic_search` - Search knowledge base
- `brain.search_items` - Search structured brain items
- `brain.upsert_item` - Create/update brain items
- `knowledge.ingest_firecrawl` - Ingest content from URLs

### Document Ingestion

```bash
# Ingest local markdown docs
pnpm ingest-docs
```

This ingests files from the `docs/` folder into the RAG system.

## Testing

```bash
# Type checking and build
pnpm build

# Lint
pnpm lint

# Run tool smoke test
tsx scripts/tool-smoke-test.ts

# Manual tool call test
tsx scripts/tool-call-test.ts
```

## Security

- All internal API routes require `X-Internal-Secret` header matching `INTERNAL_SHARED_SECRET`
- Organization scoping (`org_id`) is required on ALL database operations
- Tool arguments are stored for auditing but never sent to the client
- All writes are logged for auditability

## Documentation

See the `docs/` folder for detailed documentation:
- `brain-overview.md` - Brain system architecture
- `brain-tools.md` - Tool usage guide
- `brain-item-types.md` - Item type reference
- `search-behavior.md` - Search configuration
- `confidence-scoring.md` - Confidence system
- `internal-ingestion-firecrawl.md` - Firecrawl setup
- `cron-jobs.md` - Background job configuration
