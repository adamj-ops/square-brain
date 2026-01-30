# LifeRX Brain

Intelligent knowledge management and AI assistant system with 5 production-ready pipelines for podcast production, guest research, content repurposing, outreach automation, and audience segmentation.

## Quick Start

```bash
cd templates/chat
pnpm install
cp .env.local.example .env.local  # fill in credentials
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Chat UI (Next.js)                         │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Streaming API (/api/assistant/run)               │
│                         OpenAI GPT-4o + Tool Calls                  │
└───────────┬─────────────────────────────────────────┬───────────────┘
            │                                         │
            ▼                                         ▼
┌───────────────────────┐                 ┌───────────────────────────┐
│     Tool Executor     │                 │       RAG Search          │
│    (14 registered)    │                 │  (pgvector embeddings)    │
└───────────┬───────────┘                 └─────────────┬─────────────┘
            │                                           │
            └─────────────────┬─────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Supabase (PostgreSQL)                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  brain_items    │  │   ai_chunks     │  │  pipeline tables    │  │
│  │  (structured)   │  │   (vectors)     │  │  (guests, themes..) │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Two-Layer Memory System

| Layer                       | Storage                     | Purpose                                                                                        |
| --------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Structured Memory** | `brain_items`             | Typed knowledge items (decisions, SOPs, principles, playbooks) with metadata, tags, versioning |
| **Semantic Memory**   | `ai_docs` + `ai_chunks` | RAG-indexed content for vector similarity search                                               |

Both layers sync automatically—structured items are embedded into semantic memory for enhanced retrieval.

## The 5 Pipelines

| # | Pipeline                         | Purpose                          | Key Tools                                                                       | Test Command                                  |
| - | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| 1 | **Guest Intelligence**     | Research & score podcast guests  | `guests.upsert_profile`, `guests.extract_signals`, `scoring.score_guest`  | `npx tsx scripts/test-guest-ranking.ts`     |
| 2 | **Interview Intelligence** | Extract quotes, themes, insights | `interviews.add_quote`, `themes.upsert_theme`, `themes.link_to_interview` | `npx tsx scripts/test-interview-themes.ts`  |
| 3 | **Content Repurposing**    | Generate assets from interviews  | `content.generate_assets`                                                     | `npx tsx scripts/full-smoke-test.ts`        |
| 4 | **Outreach Automation**    | Human-in-the-loop email outreach | `outreach.compose_message`, `outreach.send_email`                           | `npx tsx scripts/full-smoke-test.ts`        |
| 5 | **Quiz Segmentation**      | Score quizzes & assign segments  | `audience.score_quiz`, `audience.assign_segment`                            | `npx tsx scripts/test-quiz-segmentation.ts` |

## API Endpoints

### Public Endpoints

| Endpoint                             | Method | Description                      |
| ------------------------------------ | ------ | -------------------------------- |
| `/api/assistant/run`               | POST   | Streaming chat with tool support |
| `/api/conversations`               | GET    | List conversations               |
| `/api/conversations`               | POST   | Create conversation              |
| `/api/conversations/[id]/messages` | GET    | Get message history              |

### Internal Endpoints

All internal endpoints require `X-Internal-Secret` header.

| Endpoint                              | Method | Description                |
| ------------------------------------- | ------ | -------------------------- |
| `/api/internal/brain/search`        | POST   | Search brain items         |
| `/api/internal/brain/upsert-item`   | POST   | Create/update brain items  |
| `/api/internal/ingest/firecrawl`    | POST   | Web scraping ingestion     |
| `/api/internal/ingest/docs`         | POST   | Markdown docs ingestion    |
| `/api/internal/ingest/apify`        | POST   | Apify actor payloads       |
| `/api/internal/rag/ingest`          | POST   | Document ingestion         |
| `/api/internal/rag/process-pending` | POST   | Process pending embeddings |
| `/api/internal/jobs/theme-scanner`  | POST   | Run theme extraction       |

### Tool Executor

Execute any registered tool directly:

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

## Tools Reference

### Core Tools

| Tool                      | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `brain.upsert_item`     | Create/update brain items (decisions, SOPs, principles, playbooks) |
| `brain.search_items`    | Keyword search with type/tag filtering                             |
| `brain.semantic_search` | Vector similarity search across all knowledge                      |

### Pipeline 1: Guest Intelligence

| Tool                       | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| `guests.upsert_profile`  | Create/update guest profiles with bio, links, topics             |
| `guests.extract_signals` | Store scoring signals (reach, relevance, expertise) with weights |
| `scoring.score_guest`    | Calculate comprehensive guest score (0-100) with explanation     |

### Pipeline 2: Interview Intelligence

| Tool                         | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `interviews.add_quote`     | Store interview quotes with timestamps and speaker |
| `themes.upsert_theme`      | Create/update themes with description              |
| `themes.link_to_interview` | Associate themes with specific interviews          |

### Pipeline 3: Content Repurposing

| Tool                        | Description                                                    |
| --------------------------- | -------------------------------------------------------------- |
| `content.generate_assets` | Generate quote cards, carousels, video scripts from interviews |

### Pipeline 4: Outreach Automation

| Tool                         | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `outreach.compose_message` | Draft outreach messages (saved as pending, requires approval) |
| `outreach.send_email`      | Send approved messages via Resend                             |

### Pipeline 5: Quiz Segmentation

| Tool                        | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `audience.score_quiz`     | Score quiz responses with interdependency modifiers |
| `audience.assign_segment` | Assign audience segment and suggest CTAs            |

## Database

### Migration Order

Run these in order via Supabase SQL Editor or CLI:

```
migrations/003_ai_tool_logs.sql        # Audit logging
migrations/004_ai_docs_chunks.sql      # RAG storage + vector search
migrations/005_messages_assumptions.sql
migrations/006_themes.sql              # Theme extraction
migrations/007_guest_intelligence.sql  # Pipeline 1: guests, signals, scores
migrations/008_interview_intelligence.sql  # Pipeline 2: interviews, quotes
migrations/009_content_assets.sql      # Pipeline 3: content assets
migrations/010_outreach.sql            # Pipeline 4: sequences, messages, events
migrations/011_audience_quiz.sql       # Pipeline 5: quiz, segments, CTAs
```

### Key Tables by Pipeline

| Pipeline                   | Tables                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| Core                       | `brain_items`, `ai_docs`, `ai_chunks`, `ai_tool_logs`          |
| 1 - Guest Intelligence     | `guests`, `guest_profiles`, `guest_signals`, `guest_scores`    |
| 2 - Interview Intelligence | `interviews`, `interview_quotes`, `themes`, `interview_themes` |
| 3 - Content Repurposing    | `content_assets`                                                     |
| 4 - Outreach Automation    | `outreach_sequences`, `outreach_messages`, `outreach_events`     |
| 5 - Quiz Segmentation      | `quiz_responses`, `audience_segments`, `segment_rules`, `ctas` |

## Environment Variables

Copy `.env.local.example` and fill in:

### Required

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
OPENAI_API_KEY=your-openai-key
DEFAULT_ORG_ID=your-org-id
INTERNAL_SHARED_SECRET=your-internal-secret
```

### Optional

```env
FIRECRAWL_API_KEY=your-firecrawl-key    # For web scraping
RESEND_API_KEY=your-resend-key          # For email sending
```

## Testing

```bash
# Full system smoke test (all pipelines)
npx tsx scripts/full-smoke-test.ts

# Individual pipeline tests
npx tsx scripts/test-guest-ranking.ts       # Pipeline 1
npx tsx scripts/test-interview-themes.ts    # Pipeline 2
npx tsx scripts/test-quiz-segmentation.ts   # Pipeline 5

# Basic tool smoke test
npx tsx scripts/tool-smoke-test.ts

# Type checking
pnpm build

# Lint
pnpm lint
```

## Security

| Feature                      | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| **Internal Auth**      | All `/api/internal/*` routes require `X-Internal-Secret` header |
| **Org Scoping**        | All database operations filter by `org_id`                        |
| **Audit Logging**      | All tool executions logged to `ai_tool_logs`                      |
| **Human-in-the-Loop**  | Outreach emails require explicit approval before sending            |
| **No Tool Args to UI** | Sensitive tool arguments never sent to client                       |

## Troubleshooting

### Common Issues

| Problem                   | Solution                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| "Invalid API key"         | Check `OPENAI_API_KEY` in `.env.local`                            |
| "relation does not exist" | Run migrations in order                                               |
| pgvector errors           | Enable pgvector extension:`CREATE EXTENSION IF NOT EXISTS vector;`  |
| Internal endpoint 401     | Check `X-Internal-Secret` header matches `INTERNAL_SHARED_SECRET` |
| Tool execution fails      | Check `ai_tool_logs` table for error details                        |
| Embeddings not generating | Run `/api/internal/rag/process-pending` to process queue            |

### Logs

- **Tool execution logs**: `ai_tool_logs` table in Supabase
- **Server logs**: Terminal running `pnpm dev`
- **Client errors**: Browser console

## Tech Stack

| Component | Technology                            |
| --------- | ------------------------------------- |
| Framework | Next.js 16 (App Router)               |
| Database  | Supabase (PostgreSQL + pgvector)      |
| AI        | OpenAI GPT-4o, text-embedding-3-small |
| Ingestion | Firecrawl                             |
| Email     | Resend                                |
| State     | Zustand                               |
| UI        | Tailwind CSS + Radix UI               |

## Documentation

See `/docs` for detailed documentation:

| Doc                                                                  | Description                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| [brain-overview.md](docs/brain-overview.md)                             | Brain system architecture                                |
| [brain-tools.md](docs/brain-tools.md)                                   | Tool usage guide with parameters                         |
| [brain-item-types.md](docs/brain-item-types.md)                         | Item type reference (decision, SOP, principle, playbook) |
| [brain-sources.md](docs/brain-sources.md)                               | Source configuration                                     |
| [search-behavior.md](docs/search-behavior.md)                           | Search configuration                                     |
| [confidence-scoring.md](docs/confidence-scoring.md)                     | Confidence system                                        |
| [internal-ingestion-firecrawl.md](docs/internal-ingestion-firecrawl.md) | Firecrawl setup                                          |
| [cron-jobs.md](docs/cron-jobs.md)                                       | Background job configuration                             |

## Quick Reference

**"Which tool do I use for...?"**

| Task                        | Tool                         |
| --------------------------- | ---------------------------- |
| Save a decision/process     | `brain.upsert_item`        |
| Find information by meaning | `brain.semantic_search`    |
| Find items by type/tag      | `brain.search_items`       |
| Add a potential guest       | `guests.upsert_profile`    |
| Score a guest               | `scoring.score_guest`      |
| Save an interview quote     | `interviews.add_quote`     |
| Tag a theme                 | `themes.upsert_theme`      |
| Generate social content     | `content.generate_assets`  |
| Draft an outreach email     | `outreach.compose_message` |
| Send approved email         | `outreach.send_email`      |
| Score a quiz response       | `audience.score_quiz`      |
| Assign audience segment     | `audience.assign_segment`  |
