/**
 * Text Embedder
 *
 * Generates embeddings using OpenAI's text-embedding-3-small model.
 * Phase 5.1: RAG Semantic Search
 */

import OpenAI from "openai";

/** Embedding model configuration */
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100; // OpenAI limit
const MAX_TOKENS_PER_REQUEST = 8191; // Model limit per input

export interface EmbeddingResult {
  /** The input text */
  text: string;
  /** The embedding vector (1536 dimensions) */
  embedding: number[];
  /** Token count used */
  tokenCount: number;
}

export interface EmbedderOptions {
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
}

/**
 * Embedder class for generating text embeddings.
 */
export class Embedder {
  private openai: OpenAI;

  constructor(options: EmbedderOptions = {}) {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key is required for embedding");
    }
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /**
   * Generate embeddings for multiple texts in batch.
   * Handles batching automatically for large inputs.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }

    // Truncate texts that are too long
    const processedTexts = texts.map((text) => truncateForEmbedding(text));

    // Process in batches
    const results: EmbeddingResult[] = [];
    for (let i = 0; i < processedTexts.length; i += MAX_BATCH_SIZE) {
      const batch = processedTexts.slice(i, i + MAX_BATCH_SIZE);
      const batchResults = await this.embedBatchInternal(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Internal batch embedding (handles single API call).
   */
  private async embedBatchInternal(texts: string[]): Promise<EmbeddingResult[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data.map((item, index) => ({
      text: texts[index],
      embedding: item.embedding,
      tokenCount: response.usage?.total_tokens
        ? Math.ceil(response.usage.total_tokens / texts.length)
        : estimateTokens(texts[index]),
    }));
  }
}

/**
 * Truncate text to fit within embedding model's token limit.
 * Uses a conservative character estimate.
 */
function truncateForEmbedding(text: string): string {
  // Rough estimate: 4 chars per token, leave some buffer
  const maxChars = MAX_TOKENS_PER_REQUEST * 3;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + "...";
}

/**
 * Estimate token count (rough approximation).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a singleton embedder instance.
 */
let embedderInstance: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (!embedderInstance) {
    embedderInstance = new Embedder();
  }
  return embedderInstance;
}

/**
 * Convenience function to embed a single text.
 */
export async function embedText(text: string): Promise<number[]> {
  const embedder = getEmbedder();
  const result = await embedder.embed(text);
  return result.embedding;
}

/**
 * Convenience function to embed multiple texts.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = getEmbedder();
  const results = await embedder.embedBatch(texts);
  return results.map((r) => r.embedding);
}
