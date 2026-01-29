/**
 * RAG (Retrieval-Augmented Generation) Module
 *
 * Exports all RAG-related utilities.
 * Phase 5.1: RAG Semantic Search
 */

// Chunking
export { chunkText, chunkMarkdown, type Chunk, type ChunkOptions } from "./chunker";

// Embedding
export {
  Embedder,
  getEmbedder,
  embedText,
  embedTexts,
  type EmbeddingResult,
  type EmbedderOptions,
} from "./embedder";

// Ingestion
export {
  ingestDocument,
  ingestDocuments,
  syncBrainItemsToRAG,
  type IngestDocumentInput,
  type IngestDocumentResult,
  type SourceType,
} from "./ingest";

// Internal Docs Ingestion
export {
  ingestInternalDocs,
  readDocsDirectory,
  type DocFile,
} from "./ingest-docs";

// Search
export {
  semanticSearch,
  hybridSearch,
  search,
  type SemanticSearchResult,
  type HybridSearchResult,
  type SearchOptions,
} from "./search";
