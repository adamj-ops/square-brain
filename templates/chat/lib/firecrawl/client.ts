/**
 * Firecrawl Client Wrapper
 *
 * Server-only module for scraping and crawling URLs via Firecrawl.
 * Phase 6.1: Knowledge Ingestion Loops
 */

import Firecrawl from "@mendable/firecrawl-js";

// Hard limits to prevent runaway costs
const MAX_MARKDOWN_CHARS_PER_PAGE = 50_000;
const MAX_PAGES_PER_CRAWL = 25;

// Environment validation (server-only)
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

/**
 * Scraped page result
 */
export interface ScrapedPage {
  url: string;
  markdown: string;
  title?: string;
  metadata?: {
    description?: string;
    language?: string;
    statusCode?: number;
    sourceURL?: string;
    [key: string]: unknown;
  };
}

/**
 * Scrape input
 */
export interface ScrapeInput {
  url: string;
}

/**
 * Crawl input
 */
export interface CrawlInput {
  url: string;
  limit: number;
  includePaths?: string[];
  excludePaths?: string[];
}

/**
 * Normalize markdown content:
 * - Trim whitespace
 * - Collapse excessive whitespace (3+ newlines -> 2)
 * - Remove null bytes
 * - Truncate to max chars
 */
function normalizeMarkdown(markdown: string | null | undefined): string {
  if (!markdown) return "";

  let normalized = markdown
    // Remove null bytes
    .replace(/\0/g, "")
    // Collapse 3+ consecutive newlines to 2
    .replace(/\n{3,}/g, "\n\n")
    // Collapse multiple spaces to single
    .replace(/ {2,}/g, " ")
    // Trim
    .trim();

  // Truncate if too long
  if (normalized.length > MAX_MARKDOWN_CHARS_PER_PAGE) {
    normalized = normalized.slice(0, MAX_MARKDOWN_CHARS_PER_PAGE);
    // Try to end at a word boundary
    const lastSpace = normalized.lastIndexOf(" ");
    if (lastSpace > MAX_MARKDOWN_CHARS_PER_PAGE * 0.9) {
      normalized = normalized.slice(0, lastSpace);
    }
    normalized += "\n\n[Content truncated]";
  }

  return normalized;
}

/**
 * Get the Firecrawl client instance.
 * Throws if API key is not configured.
 */
function getClient(): Firecrawl {
  if (!FIRECRAWL_API_KEY) {
    throw new Error(
      "FIRECRAWL_API_KEY is not configured. Add it to your environment variables."
    );
  }
  return new Firecrawl({ apiKey: FIRECRAWL_API_KEY });
}

/**
 * Scrape a single URL and return clean markdown.
 */
export async function scrapeUrl(input: ScrapeInput): Promise<ScrapedPage> {
  const client = getClient();

  const response = await client.scrape(input.url, {
    formats: ["markdown"],
  });

  // Response is the Document directly (SDK handles success check)
  const data = response as {
    markdown?: string;
    metadata?: Record<string, unknown>;
  };

  return {
    url: input.url,
    markdown: normalizeMarkdown(data.markdown),
    title: data.metadata?.title as string | undefined,
    metadata: {
      description: data.metadata?.description as string | undefined,
      language: data.metadata?.language as string | undefined,
      statusCode: data.metadata?.statusCode as number | undefined,
      sourceURL: data.metadata?.sourceURL as string | undefined,
    },
  };
}

/**
 * Crawl a site starting from a URL.
 * Returns an array of scraped pages (bounded by limit and MAX_PAGES_PER_CRAWL).
 */
export async function crawlUrl(input: CrawlInput): Promise<ScrapedPage[]> {
  const client = getClient();

  // Enforce hard cap
  const effectiveLimit = Math.min(input.limit, MAX_PAGES_PER_CRAWL);

  // crawl() is a convenience waiter that polls until completion
  const response = await client.crawl(input.url, {
    limit: effectiveLimit,
    includePaths: input.includePaths,
    excludePaths: input.excludePaths,
    scrapeOptions: {
      formats: ["markdown"],
    },
  });

  const pages: ScrapedPage[] = [];

  // Response is CrawlResponse with data array
  const data = (response as { data?: unknown[] }).data || [];

  for (const page of data) {
    if (pages.length >= MAX_PAGES_PER_CRAWL) break;

    const pageData = page as {
      markdown?: string;
      metadata?: Record<string, unknown>;
    };

    pages.push({
      url: (pageData.metadata?.sourceURL as string) || input.url,
      markdown: normalizeMarkdown(pageData.markdown),
      title: pageData.metadata?.title as string | undefined,
      metadata: {
        description: pageData.metadata?.description as string | undefined,
        language: pageData.metadata?.language as string | undefined,
        statusCode: pageData.metadata?.statusCode as number | undefined,
        sourceURL: pageData.metadata?.sourceURL as string | undefined,
      },
    });
  }

  return pages;
}

/**
 * Check if Firecrawl is configured
 */
export function isFirecrawlConfigured(): boolean {
  return !!FIRECRAWL_API_KEY;
}

/**
 * Get limits for documentation/validation
 */
export const FIRECRAWL_LIMITS = {
  MAX_MARKDOWN_CHARS_PER_PAGE,
  MAX_PAGES_PER_CRAWL,
} as const;
