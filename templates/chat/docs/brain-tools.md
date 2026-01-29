# Brain Tools Reference

The Brain assistant has access to three core tools for interacting with the knowledge base.

## brain.semantic_search

**Purpose**: Find information by meaning using semantic similarity.

### When to Use
- Answering questions about stored knowledge
- Finding related information
- Looking up concepts, processes, or decisions
- Any query before claiming "I don't know"

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Natural language search query |
| `limit` | number | No | 5 | Max results (1-20) |
| `threshold` | number | No | 0.65 | Min similarity score (0-1) |

### How It Works

1. Query is converted to an embedding vector
2. Vector similarity search against indexed chunks
3. Hybrid mode also checks keyword matches
4. Results ranked by similarity score
5. Returns chunks with source attribution

### Response Format

```json
{
  "results": [
    {
      "chunk_id": "uuid",
      "doc_id": "uuid",
      "title": "Document Title",
      "content": "Relevant chunk text...",
      "similarity": 0.87,
      "source_type": "brain_item",
      "source_id": "item-uuid",
      "section": "Section Title"
    }
  ],
  "count": 1
}
```

## brain.search_items

**Purpose**: Keyword-based search with filtering by type and tags.

### When to Use
- Exact title or keyword searches
- Filtering by specific item type (decision, sop, etc.)
- Finding items with specific tags
- Browsing/listing items

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | - | Keyword search (ilike) |
| `type` | string | No | - | Filter by type: decision, sop, principle, playbook |
| `tag` | string | No | - | Filter by tag |
| `limit` | number | No | 10 | Max results |
| `offset` | number | No | 0 | Pagination offset |

### Response Format

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "decision",
      "title": "Item Title",
      "excerpt": "First 200 chars...",
      "tags": ["engineering"],
      "confidence_score": 0.8,
      "updated_at": "2024-01-15T..."
    }
  ],
  "count": 1
}
```

## brain.upsert_item

**Purpose**: Create or update a brain item.

### When to Use
- User explicitly asks to save/store/remember something
- Creating new decisions, SOPs, principles, or playbooks
- Updating existing items with new information

### IMPORTANT: Only use when explicitly requested

Never auto-save. Only call this tool when the user clearly wants to persist information.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string | Yes | - | Item type |
| `title` | string | Yes | - | Item title |
| `content_md` | string | Yes | - | Markdown content |
| `tags` | string[] | No | [] | Item tags |
| `confidence_score` | number | No | 0.75 | Confidence 0-1 |
| `canonical_key` | string | No | - | Unique key for upsert |

### Response Format

```json
{
  "id": "uuid",
  "version": 1
}
```

## Tool Selection Guide

| User Intent | Primary Tool | Fallback |
|-------------|--------------|----------|
| "What is X?" | semantic_search | search_items |
| "How do we do X?" | semantic_search | search_items |
| "Find decisions about X" | semantic_search (then filter) | search_items with type |
| "List all SOPs" | search_items with type | - |
| "Items tagged X" | search_items with tag | - |
| "Save this as..." | upsert_item | - |
| "Remember that..." | upsert_item | - |

## Best Practices

1. **Always search first**: Never claim information doesn't exist without searching
2. **Use semantic search by default**: It's more powerful than keyword search
3. **Combine tools**: Search to find, then upsert to update
4. **Cite sources**: When returning search results, mention the source title
5. **Respect confidence**: Acknowledge uncertainty for low-confidence items
