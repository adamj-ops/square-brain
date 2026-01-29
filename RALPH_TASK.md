---
task: Complete LifeRX Brain - Pipelines 1-5
test_command: "cd templates/chat && pnpm build"
---

# Task: Complete LifeRX Brain System

Complete the standalone LifeRX Brain app and implement Pipelines 1–5 for production-ready, shareable, demonstrable system.

## Project Context

- **App root**: `templates/chat/`
- **Stack**: Next.js App Router + Supabase + OpenAI
- **Already implemented**: Streaming chat, Tool registry + executor, Brain memory, RAG semantic search
- **Auth**: `X-Internal-Secret === INTERNAL_SHARED_SECRET`
- **Org scoping**: Required on ALL DB operations (default `DEFAULT_ORG_ID`)

## Global Rules

- Work in SMALL commits (one logical goal per commit)
- After each commit: typecheck/build + smoke test
- DO NOT redesign UI layout (branding changes only)
- Tool args MUST NEVER be sent to UI
- Any real-world action (email, outreach) MUST be human-approved
- All writes must be auditable
- All ingestion + jobs must be idempotent

---

## Success Criteria

### Phase A — Platform Completion & Cleanup

1. [x] A1.1: Commit all pending/untracked files in templates/chat/
2. [x] A1.2: Remove obsolete code and validate migrations 004-006
3. [x] A1.3: Create README.md with setup, env vars, migrations, how to run/test
4. [x] A1.4: Create .env.local.example (NO secrets, just placeholders)
5. [ ] A2.1: Remove Square UI branding from app
6. [ ] A2.2: Add LifeRX Brain branding (app name, icon, favicon, metadata)
7. [ ] CHECKPOINT 1: Report Phase A changes and how to test

### Phase B — Ingestion & Knowledge

8. [ ] B1: Implement Firecrawl ingestion endpoint /api/internal/ingest/firecrawl (scrape + crawl, normalize, ingest to ai_docs + ai_chunks)
9. [ ] B2: Implement internal docs ingestion /api/internal/ingest/docs (MD/MDX, source_type=internal_docs, idempotent)
10. [ ] B3: Implement Apify ingestion seam /api/internal/ingest/apify (accept normalized payloads, allowlist)
11. [ ] CHECKPOINT 2: Verify docs ingest + brain.semantic_search works

### Pipeline 1 — Guest Intelligence

12. [ ] P1.1: Create tables: guests, guest_profiles, guest_signals, guest_scores (migration)
13. [ ] P1.2: Implement guests.upsert_profile tool
14. [ ] P1.3: Implement guests.extract_signals tool
15. [ ] P1.4: Implement scoring.score_guest tool (rules versioned, explainable)
16. [ ] CHECKPOINT 3: Rank 5 mock guests with explanations

### Pipeline 2 — Interview Intelligence

17. [ ] P2.1: Create tables: interviews, interview_quotes, themes, interview_themes (migration)
18. [ ] P2.2: Implement interviews.add_quote tool
19. [ ] P2.3: Implement themes.upsert_theme + themes.link_to_interview tools
20. [ ] P2.4: Implement theme_scanner job (auto-tag expertise, identify recurring themes)
21. [ ] CHECKPOINT 4: Query themes + quotes across interviews

### Pipeline 3 — Content Repurposing

22. [ ] P3.1: Create content_assets table (migration)
23. [ ] P3.2: Implement content.generate_assets tool (quote cards, carousel outlines, shortform scripts, audio bite ideas)
24. [ ] CHECKPOINT 5: Generate content ideas from one interview

### Pipeline 4 — Outreach Automation (Human-in-the-Loop)

25. [ ] P4.1: Create tables: outreach_sequences, outreach_messages, outreach_events (migration)
26. [ ] P4.2: Implement outreach.compose_message tool
27. [ ] P4.3: Implement outreach.send_email tool (Resend, requires allowWrites + approval flag)
28. [ ] CHECKPOINT 6: Draft + approve + send test email (safe target)

### Pipeline 5 — Audience & Quiz Segmentation

29. [ ] P5.1: Create tables: quiz_responses, audience_segments, segment_rules, ctas (migration)
30. [ ] P5.2: Implement audience.score_quiz tool (sliding interdependency scoring)
31. [ ] P5.3: Implement audience.assign_segment tool (CTA suggestions tied to segment + emotion)
32. [ ] CHECKPOINT 7: Score sample quiz + assign segment

### Final Phase — Integration & Release

33. [ ] F1: Create smoke test script (ingest → search → tool call → audit log)
34. [ ] F2: Ensure all pipelines can be triggered via API/tools
35. [ ] F3: Final README update (system overview, pipeline descriptions, how to test each)
36. [ ] CHECKPOINT 8: Final report + release readiness

---

## Ralph Instructions

1. Work on the next unchecked criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run `pnpm build` after changes to verify
4. Commit your changes frequently with descriptive messages
5. When ALL criteria show `[x]`: output `<ralph>COMPLETE</ralph>`
6. If stuck 3+ times on same issue: output `<ralph>GUTTER</ralph>`
7. At each CHECKPOINT, update `.ralph/progress.md` with detailed report
