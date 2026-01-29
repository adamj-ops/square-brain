# Confidence Scoring

Every brain item has a **confidence_score** from 0 to 1 that indicates how reliable or validated that piece of knowledge is.

## What is Confidence?

Confidence represents the reliability of a brain item based on:
- **Source quality**: Where did this information come from?
- **Validation status**: Has it been reviewed or tested?
- **Recency**: Is the information still current?
- **Consistency**: Does it align with other known facts?

## Confidence Scale

| Score | Level | Meaning |
|-------|-------|---------|
| 0.9 - 1.0 | Very High | Verified, tested, authoritative |
| 0.75 - 0.89 | High | Reviewed, reliable, from trusted source |
| 0.5 - 0.74 | Medium | Reasonable but unverified |
| 0.25 - 0.49 | Low | Uncertain, needs validation |
| 0.0 - 0.24 | Very Low | Speculative, possibly outdated |

## Default Confidence by Source

| Source | Default Confidence | Rationale |
|--------|-------------------|-----------|
| `manual` | 0.75 | Human-entered, assumed reviewed |
| `agent` | 0.6 | AI-generated, needs validation |
| `import` | 0.5 | Bulk import, unknown quality |
| `apify` | 0.5 | Scraped content, may be stale |
| `interview` | 0.7 | Recorded from human conversation |
| `internal_docs` | 0.9 | Official documentation, authoritative |

## How Confidence is Used

### In Search Results
- Results are weighted by confidence
- Higher confidence items appear first (all else equal)
- Low confidence items may include a disclaimer

### In Responses
- The agent cites confidence when relevant
- Low confidence information is flagged as uncertain
- Very low confidence may be omitted unless explicitly requested

### For Maintenance
- Items with low confidence are candidates for review
- Confidence can be updated as items are validated
- Stale items may have confidence automatically reduced

## Updating Confidence

Confidence can be updated:
1. **Manually**: Admin reviews and updates score
2. **Through validation**: Positive feedback increases confidence
3. **Automatically**: Decay over time without interaction
4. **On correction**: Errors reduce confidence

## Best Practices

1. **Don't over-rate**: Only use 0.9+ for truly verified information
2. **Be honest about uncertainty**: Medium confidence is fine for most items
3. **Review low-confidence items**: Regularly audit and improve or archive
4. **Trust the system**: Let confidence guide, but allow override when needed
