# Brain System Overview

The Brain is LifeRX's persistent knowledge management system. It stores, organizes, and retrieves organizational knowledge through structured memory items.

## Core Concepts

### What is the Brain?

The Brain is an intelligent memory layer that:
- Stores organizational knowledge as structured items
- Provides semantic search for finding relevant information
- Maintains confidence scores for reliability tracking
- Supports versioning and audit trails

### Memory Architecture

The Brain uses a two-layer architecture:

1. **Structured Memory (brain_items)**: Typed, categorized knowledge items with metadata
2. **Semantic Memory (ai_docs/ai_chunks)**: RAG-indexed content for similarity search

Both layers work together - structured items are automatically synced to semantic memory for enhanced retrieval.

## Data Flow

```
User Input → Brain Search → Retrieved Context → LLM Response
     ↓
User Request to Save → Brain Upsert → Structured + Semantic Storage
```

## Key Features

- **Semantic Search**: Find information by meaning, not just keywords
- **Hybrid Search**: Combines semantic + keyword matching for best recall
- **Confidence Tracking**: Every item has a confidence score (0-1)
- **Source Attribution**: Track where each piece of knowledge came from
- **Versioning**: All items maintain version history
- **Org Isolation**: Strict data separation between organizations
