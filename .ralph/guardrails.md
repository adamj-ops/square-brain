# Ralph Guardrails (Signs)

> Lessons learned from past failures. READ THESE BEFORE ACTING.

## Core Signs

### Sign: Read Before Writing
- **Trigger**: Before modifying any file
- **Instruction**: Always read the existing file first
- **Added after**: Core principle

### Sign: Test After Changes
- **Trigger**: After any code change
- **Instruction**: Run tests to verify nothing broke
- **Added after**: Core principle

### Sign: Commit Checkpoints
- **Trigger**: Before risky changes
- **Instruction**: Commit current working state first
- **Added after**: Core principle

---

## Project-Specific Signs

### Sign: Work in templates/chat/
- **Trigger**: Any file operation
- **Instruction**: All app code lives in `templates/chat/`. Do not create files outside this directory unless they are repo-level (README, .env.example).
- **Added after**: Project structure requirement

### Sign: Org Scoping Required
- **Trigger**: Any database query or mutation
- **Instruction**: ALL queries must include org_id filter. Use DEFAULT_ORG_ID from env for development.
- **Added after**: Multi-tenancy requirement

### Sign: Never Expose Tool Args to UI
- **Trigger**: Any tool execution response
- **Instruction**: Tool arguments contain sensitive data. Only return sanitized results to the client.
- **Added after**: Security requirement

### Sign: Internal Auth Pattern
- **Trigger**: Creating internal API endpoints
- **Instruction**: Use `X-Internal-Secret === INTERNAL_SHARED_SECRET` header check for all /api/internal/* routes.
- **Added after**: Auth pattern

### Sign: Idempotent Ingestion
- **Trigger**: Writing ingestion code
- **Instruction**: All ingestion must be idempotent - use content_hash or source_id to prevent duplicates.
- **Added after**: Data integrity requirement

### Sign: Human Approval for Actions
- **Trigger**: Implementing outreach/email tools
- **Instruction**: Any real-world action (email send) requires allowWrites=true AND explicit approval flag in args.
- **Added after**: Safety requirement

### Sign: Small Commits
- **Trigger**: After completing any logical unit of work
- **Instruction**: Commit frequently with descriptive messages. One goal per commit.
- **Added after**: Project rule

---

## Learned Signs

(Signs added from observed failures will appear below)
