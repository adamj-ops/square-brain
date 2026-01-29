# Brain Item Sources

Every brain item tracks its source - where the information came from. This enables provenance tracking and helps determine reliability.

## Source Types

### manual
**Description**: Directly entered by a user through the UI or API.
**Default Confidence**: 0.75
**Use Cases**:
- Admin documenting a decision
- User saving a procedure they wrote
- Manual knowledge entry

### agent
**Description**: Created by the AI assistant during conversation.
**Default Confidence**: 0.6
**Use Cases**:
- User asks assistant to save something
- AI summarizes and persists information
- Generated content from conversation

### import
**Description**: Bulk imported from external systems.
**Default Confidence**: 0.5
**Use Cases**:
- Migrating from another knowledge base
- Importing from spreadsheets/CSVs
- Initial data seeding

### apify
**Description**: Scraped from web sources using Apify.
**Default Confidence**: 0.5
**Use Cases**:
- Ingesting competitor information
- Scraping documentation sites
- Automated content collection

### interview
**Description**: Recorded from human interviews or conversations.
**Default Confidence**: 0.7
**Use Cases**:
- Transcribed meeting notes
- Expert interviews
- Knowledge capture sessions

### internal_docs
**Description**: Official internal documentation.
**Default Confidence**: 0.9
**Use Cases**:
- System documentation
- Product specifications
- Official guidelines
- API documentation

## Source Metadata

Each source can include additional metadata:

```json
{
  "source": "import",
  "metadata": {
    "original_system": "Notion",
    "import_date": "2024-01-15",
    "imported_by": "user-123"
  }
}
```

## Source in Search Results

When displaying search results, always show the source to help users assess reliability:

- **internal_docs**: Treated as authoritative
- **manual**: Generally reliable
- **interview**: Good but may need verification
- **agent**: Should be validated
- **import/apify**: May be stale or inaccurate

## Updating Sources

Source cannot be changed after creation. If information needs to be re-sourced:
1. Archive the old item
2. Create a new item with the correct source
3. This maintains provenance integrity
