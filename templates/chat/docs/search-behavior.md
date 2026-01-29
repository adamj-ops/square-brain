# Search Behavior

The Brain supports two complementary search modes: **semantic search** and **keyword search**.

## Semantic Search (Primary)

### How It Works

1. **Query Embedding**: Your query is converted to a 1536-dimensional vector using OpenAI's `text-embedding-3-small` model
2. **Vector Similarity**: The query vector is compared against all indexed chunks using cosine similarity
3. **Threshold Filtering**: Only results above the similarity threshold (default 0.65) are returned
4. **Ranking**: Results are ordered by similarity score, highest first

### Strengths
- Finds conceptually related content even with different wording
- Understands synonyms and related concepts
- Works well for questions and natural language queries
- No need to know exact keywords

### Limitations
- May miss exact matches if embedding is weak
- Requires good chunk quality
- Threshold tuning may be needed

## Hybrid Search (Recommended)

### How It Works

Hybrid search combines semantic and keyword approaches:

1. **Semantic Pass**: Vector similarity search (same as above)
2. **Keyword Pass**: ILIKE pattern matching on content
3. **Result Merging**: Combines both result sets, deduplicates, re-ranks

### When to Use
- **Default mode** for most queries
- When you need both conceptual and exact matches
- For technical terms or proper nouns

### Configuration

```typescript
search(query, orgId, {
  hybrid: true,        // Enable hybrid mode
  limit: 5,           // Max results
  threshold: 0.65     // Min similarity
});
```

## Keyword Search (Fallback)

### How It Works

1. **Pattern Matching**: Uses SQL ILIKE for case-insensitive substring matching
2. **Type/Tag Filtering**: Can filter by item type or tags
3. **Pagination**: Supports offset/limit for browsing

### When to Use
- Browsing items by type ("show all SOPs")
- Exact title searches
- Tag-based filtering
- When semantic search returns nothing

## Search Strategy

The assistant follows this strategy:

```
1. Use brain.semantic_search first
   ↓ No results?
2. Try brain.semantic_search with lower threshold (0.5)
   ↓ Still no results?
3. Fall back to brain.search_items with keywords
   ↓ Still nothing?
4. Acknowledge no matching information found
```

## Similarity Thresholds

| Threshold | Behavior |
|-----------|----------|
| 0.80+ | Very strict, only highly relevant |
| 0.65 | Default, good balance |
| 0.50 | Looser, more results |
| 0.30 | Very loose, may include noise |

## Best Practices

1. **Start with semantic**: It handles most queries well
2. **Use hybrid for reliability**: Catches both concepts and keywords
3. **Adjust threshold if needed**: Lower for broad queries, higher for precision
4. **Limit appropriately**: 5 results is usually enough, max 20
5. **Read results carefully**: Higher similarity ≠ always more relevant
