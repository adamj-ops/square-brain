/**
 * Firecrawl Module
 *
 * Exports all Firecrawl-related utilities.
 * Phase 6.1: Knowledge Ingestion Loops
 */

export {
  scrapeUrl,
  crawlUrl,
  isFirecrawlConfigured,
  FIRECRAWL_LIMITS,
  type ScrapedPage,
  type ScrapeInput,
  type CrawlInput,
} from "./client";

export {
  ingestFromFirecrawl,
  validateFirecrawlInput,
  FIRECRAWL_INGEST_LIMITS,
  type FirecrawlIngestInput,
  type FirecrawlIngestOutput,
} from "./ingest";
