/**
 * Tool: knowledge.ingest_firecrawl
 *
 * Ingests web content via Firecrawl into the RAG knowledge base.
 * Supports single-page scraping or bounded site crawling.
 *
 * Note: Uses dynamic imports to avoid loading crypto-dependent code
 * at module parse time (required for Edge runtime compatibility).
 *
 * Phase 6.1: Knowledge Ingestion Loops
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Input args for knowledge.ingest_firecrawl
 */
export interface KnowledgeIngestFirecrawlArgs {
  /** Scraping mode: "scrape" for single page, "crawl" for site crawl */
  mode: "scrape" | "crawl";
  /** URL to scrape or starting URL for crawl */
  url: string;
  /** Source type classification (default: "firecrawl") */
  source_type?: "firecrawl" | "internal_docs" | "website";
  /** Custom source identifier (default: hostname) */
  source_id?: string;
  /** Confidence level for ingested content (default: "medium") */
  confidence?: "high" | "medium" | "low";
  /** Tags to apply to ingested documents */
  tags?: string[];
  /** Crawl-specific options */
  crawl?: {
    /** Max pages to crawl (default: 10, max: 25) */
    limit?: number;
    /** URL path patterns to include */
    includePaths?: string[];
    /** URL path patterns to exclude */
    excludePaths?: string[];
  };
}

/**
 * Output from knowledge.ingest_firecrawl
 */
export interface KnowledgeIngestFirecrawlResult {
  /** Whether the operation succeeded */
  ok: boolean;
  /** Mode used */
  mode: "scrape" | "crawl";
  /** Number of documents successfully ingested */
  documents_processed: number;
  /** Number of documents skipped */
  documents_skipped: number;
  /** Total chunks created */
  chunks_created: number;
  /** Per-document results */
  docs: Array<{
    url: string;
    doc_id?: string;
    status: "ingested" | "skipped";
    reason?: string;
  }>;
}

/**
 * Validate a URL
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
 * Validate input args
 */
function validateArgs(args: unknown): KnowledgeIngestFirecrawlArgs {
  if (args === null || args === undefined) {
    throw new Error("mode and url are required");
  }

  if (typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  // mode (required)
  if (!raw.mode || !["scrape", "crawl"].includes(raw.mode as string)) {
    throw new Error('mode must be "scrape" or "crawl"');
  }
  const mode = raw.mode as "scrape" | "crawl";

  // url (required)
  if (!raw.url || typeof raw.url !== "string") {
    throw new Error("url must be a non-empty string");
  }
  const url = raw.url.trim();
  if (!isValidUrl(url)) {
    throw new Error("url must be a valid HTTP/HTTPS URL");
  }

  const result: KnowledgeIngestFirecrawlArgs = { mode, url };

  // source_type (optional)
  if (raw.source_type !== undefined) {
    if (!["firecrawl", "internal_docs", "website"].includes(raw.source_type as string)) {
      throw new Error('source_type must be "firecrawl", "internal_docs", or "website"');
    }
    result.source_type = raw.source_type as "firecrawl" | "internal_docs" | "website";
  }

  // source_id (optional)
  if (raw.source_id !== undefined) {
    if (typeof raw.source_id !== "string") {
      throw new Error("source_id must be a string");
    }
    result.source_id = raw.source_id;
  }

  // confidence (optional)
  if (raw.confidence !== undefined) {
    if (!["high", "medium", "low"].includes(raw.confidence as string)) {
      throw new Error('confidence must be "high", "medium", or "low"');
    }
    result.confidence = raw.confidence as "high" | "medium" | "low";
  }

  // tags (optional)
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((t) => typeof t === "string")) {
      throw new Error("tags must be an array of strings");
    }
    result.tags = raw.tags;
  }

  // crawl options (optional)
  if (raw.crawl !== undefined) {
    if (typeof raw.crawl !== "object" || raw.crawl === null) {
      throw new Error("crawl must be an object");
    }
    const crawlOpts = raw.crawl as Record<string, unknown>;
    result.crawl = {};

    if (crawlOpts.limit !== undefined) {
      if (typeof crawlOpts.limit !== "number" || !Number.isInteger(crawlOpts.limit) || crawlOpts.limit < 1) {
        throw new Error("crawl.limit must be a positive integer");
      }
      result.crawl.limit = Math.min(crawlOpts.limit, 25); // Enforce max
    }

    if (crawlOpts.includePaths !== undefined) {
      if (!Array.isArray(crawlOpts.includePaths) || !crawlOpts.includePaths.every((p) => typeof p === "string")) {
        throw new Error("crawl.includePaths must be an array of strings");
      }
      result.crawl.includePaths = crawlOpts.includePaths;
    }

    if (crawlOpts.excludePaths !== undefined) {
      if (!Array.isArray(crawlOpts.excludePaths) || !crawlOpts.excludePaths.every((p) => typeof p === "string")) {
        throw new Error("crawl.excludePaths must be an array of strings");
      }
      result.crawl.excludePaths = crawlOpts.excludePaths;
    }
  }

  return result;
}

/**
 * Execute the ingestion
 *
 * Uses dynamic import to avoid loading crypto-dependent code at parse time.
 * This enables the tool to be registered in Edge runtime while the actual
 * execution happens in a context that supports Node.js APIs.
 */
async function run(
  args: KnowledgeIngestFirecrawlArgs,
  ctx: ToolContext
): Promise<ToolResponse<KnowledgeIngestFirecrawlResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  // Dynamic import to avoid crypto dependency at module parse time
  const { ingestFromFirecrawl } = await import("@/lib/firecrawl/ingest");

  // Build ingestion input
  const result = await ingestFromFirecrawl({
    org_id: orgId,
    mode: args.mode,
    url: args.url,
    source_type: args.source_type,
    source_id: args.source_id,
    confidence: args.confidence,
    tags: args.tags,
    crawl: args.crawl,
  });

  // Determine why this source is being ingested
  const ingestReason =
    args.mode === "scrape"
      ? `Single page scrape of ${args.url}`
      : `Site crawl starting from ${args.url} (limit: ${args.crawl?.limit || 10})`;

  return {
    data: result,
    explainability: {
      reason: ingestReason,
      mode: args.mode,
      url: args.url,
      source_type: args.source_type || "firecrawl",
      confidence_used: args.confidence || "medium",
      documents_added: result.documents_processed,
      documents_skipped: result.documents_skipped,
      chunks_created: result.chunks_created,
      crawl_options: args.crawl,
    },
  };
}

/**
 * Tool definition for knowledge.ingest_firecrawl
 */
export const knowledgeIngestFirecrawlTool: ToolDefinition<
  KnowledgeIngestFirecrawlArgs,
  KnowledgeIngestFirecrawlResult
> = {
  name: "knowledge.ingest_firecrawl",
  description:
    "Ingest web content into the knowledge base by scraping a URL or crawling a site. " +
    'Use mode "scrape" for a single page or "crawl" to discover and ingest multiple pages. ' +
    "Crawling is bounded (max 25 pages) to prevent runaway costs. " +
    "Content is deduplicated by hash, so re-ingesting unchanged pages is safe. " +
    "Use this to add external knowledge sources that can be retrieved via brain.semantic_search.",
  writes: true,
  validateArgs,
  run,
};
