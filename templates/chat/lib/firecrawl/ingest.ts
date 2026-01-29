/**
 * Firecrawl Ingestion Logic
 *
 * Core ingestion logic for Firecrawl content.
 * Extracted to lib/ to be importable by both routes and tools.
 *
 * Phase 6.1: Knowledge Ingestion Loops
 */

import { scrapeUrl, crawlUrl, type ScrapedPage } from "./client";
import {
  ingestDocument,
  type SourceType,
  type IngestDocumentResult,
} from "@/lib/rag/ingest";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "default";

// Hard caps per request
const MAX_DOCUMENTS_PER_REQUEST = 25;
const MAX_CHUNKS_PER_REQUEST = 500;
const DEFAULT_CRAWL_LIMIT = 10;
const MAX_CRAWL_LIMIT = 25;

/**
 * Input for Firecrawl ingestion
 */
export interface FirecrawlIngestInput {
  org_id?: string;
  mode: "scrape" | "crawl";
  url: string;
  source_type?: "firecrawl" | "internal_docs" | "website";
  source_id?: string;
  confidence?: "high" | "medium" | "low";
  tags?: string[];
  crawl?: {
    limit?: number;
    includePaths?: string[];
    excludePaths?: string[];
  };
}

/**
 * Output from Firecrawl ingestion
 */
export interface FirecrawlIngestOutput {
  ok: boolean;
  mode: "scrape" | "crawl";
  documents_processed: number;
  documents_skipped: number;
  chunks_created: number;
  docs: Array<{
    url: string;
    doc_id?: string;
    status: "ingested" | "skipped";
    reason?: string;
  }>;
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Extract hostname from URL for default source_id
 */
function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Ingest a single page into the RAG system
 */
async function ingestPage(
  page: ScrapedPage,
  orgId: string,
  sourceType: SourceType,
  sourceId: string,
  confidence: "high" | "medium" | "low",
  tags?: string[],
  mode?: "scrape" | "crawl"
): Promise<{ result: IngestDocumentResult; url: string }> {
  const confidenceValue =
    confidence === "high" ? 0.9 : confidence === "medium" ? 0.7 : 0.5;

  const result = await ingestDocument({
    org_id: orgId,
    source_type: sourceType,
    source_id: sourceId,
    title: page.title || page.url,
    content_md: page.markdown,
    metadata: {
      url: page.url,
      confidence: confidenceValue,
      fetched_at: new Date().toISOString(),
      firecrawl: {
        mode,
        source_url: page.metadata?.sourceURL,
        language: page.metadata?.language,
        status_code: page.metadata?.statusCode,
      },
      tags: tags || [],
    },
  });

  return { result, url: page.url };
}

/**
 * Validate input
 */
export function validateFirecrawlInput(input: FirecrawlIngestInput): void {
  if (!["scrape", "crawl"].includes(input.mode)) {
    throw new Error('mode must be "scrape" or "crawl"');
  }

  if (!input.url || !isValidUrl(input.url)) {
    throw new Error("url must be a valid HTTP/HTTPS URL");
  }
}

/**
 * Main ingestion logic
 */
export async function ingestFromFirecrawl(
  input: FirecrawlIngestInput
): Promise<FirecrawlIngestOutput> {
  // Validate
  validateFirecrawlInput(input);

  const orgId = input.org_id || DEFAULT_ORG_ID;
  const sourceType: SourceType = input.source_type || "firecrawl";
  const sourceId = input.source_id || getHostname(input.url);
  const confidence = input.confidence || "medium";
  const tags = input.tags || [];

  const docs: FirecrawlIngestOutput["docs"] = [];
  let documentsProcessed = 0;
  let documentsSkipped = 0;
  let chunksCreated = 0;

  try {
    let pages: ScrapedPage[];

    if (input.mode === "scrape") {
      // Single page scrape
      const page = await scrapeUrl({ url: input.url });
      pages = [page];
    } else {
      // Crawl multiple pages
      const crawlLimit = Math.min(
        input.crawl?.limit ?? DEFAULT_CRAWL_LIMIT,
        MAX_CRAWL_LIMIT
      );

      pages = await crawlUrl({
        url: input.url,
        limit: crawlLimit,
        includePaths: input.crawl?.includePaths,
        excludePaths: input.crawl?.excludePaths,
      });
    }

    // Process pages with caps
    for (const page of pages) {
      // Check document cap
      if (documentsProcessed >= MAX_DOCUMENTS_PER_REQUEST) {
        docs.push({
          url: page.url,
          status: "skipped",
          reason: "max documents per request reached",
        });
        documentsSkipped++;
        continue;
      }

      // Check chunk cap (estimate ~1 chunk per 1000 chars)
      const estimatedChunks = Math.ceil(page.markdown.length / 1000);
      if (chunksCreated + estimatedChunks > MAX_CHUNKS_PER_REQUEST) {
        docs.push({
          url: page.url,
          status: "skipped",
          reason: "max chunks per request reached",
        });
        documentsSkipped++;
        continue;
      }

      // Skip empty pages
      if (!page.markdown || page.markdown.trim().length < 50) {
        docs.push({
          url: page.url,
          status: "skipped",
          reason: "content too short or empty",
        });
        documentsSkipped++;
        continue;
      }

      try {
        const { result, url } = await ingestPage(
          page,
          orgId,
          sourceType,
          sourceId,
          confidence,
          tags,
          input.mode
        );

        if (result.status === "unchanged") {
          docs.push({
            url,
            doc_id: result.doc_id,
            status: "skipped",
            reason: "content unchanged",
          });
          documentsSkipped++;
        } else {
          docs.push({
            url,
            doc_id: result.doc_id,
            status: "ingested",
          });
          documentsProcessed++;
          chunksCreated += result.chunk_count;
        }
      } catch (error) {
        docs.push({
          url: page.url,
          status: "skipped",
          reason: error instanceof Error ? error.message : "ingestion failed",
        });
        documentsSkipped++;
      }
    }

    return {
      ok: true,
      mode: input.mode,
      documents_processed: documentsProcessed,
      documents_skipped: documentsSkipped,
      chunks_created: chunksCreated,
      docs,
    };
  } catch (error) {
    // Firecrawl API error - don't log secrets
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Firecrawl operation failed: ${message}`);
  }
}

/**
 * Limits for documentation
 */
export const FIRECRAWL_INGEST_LIMITS = {
  MAX_DOCUMENTS_PER_REQUEST,
  MAX_CHUNKS_PER_REQUEST,
  DEFAULT_CRAWL_LIMIT,
  MAX_CRAWL_LIMIT,
} as const;
