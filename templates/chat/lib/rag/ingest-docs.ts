/**
 * Internal Docs Ingestion
 *
 * Ingests markdown documentation files into the RAG system
 * with source_type = "internal_docs" and high confidence.
 *
 * Phase 5.2: Knowledge ingestion from docs
 */

import fs from "fs";
import path from "path";
import { ingestDocument, type IngestDocumentResult } from "./ingest";

const DOCS_DIR = path.join(process.cwd(), "docs");
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "";

export interface DocFile {
  filename: string;
  title: string;
  content: string;
}

/**
 * Read all markdown files from the docs directory
 */
export function readDocsDirectory(): DocFile[] {
  if (!fs.existsSync(DOCS_DIR)) {
    console.warn(`Docs directory not found: ${DOCS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  const docs: DocFile[] = [];

  for (const filename of files) {
    const filepath = path.join(DOCS_DIR, filename);
    const content = fs.readFileSync(filepath, "utf-8");

    // Extract title from first H1 or use filename
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : filename.replace(".md", "");

    docs.push({
      filename,
      title,
      content,
    });
  }

  return docs;
}

/**
 * Ingest all docs into RAG system
 */
export async function ingestInternalDocs(
  org_id: string = DEFAULT_ORG_ID
): Promise<{
  ingested: number;
  unchanged: number;
  errors: number;
  results: IngestDocumentResult[];
}> {
  if (!org_id) {
    throw new Error("org_id is required");
  }

  const docs = readDocsDirectory();

  if (docs.length === 0) {
    return { ingested: 0, unchanged: 0, errors: 0, results: [] };
  }

  const results: IngestDocumentResult[] = [];
  let ingested = 0;
  let unchanged = 0;
  let errors = 0;

  for (const doc of docs) {
    try {
      const result = await ingestDocument({
        org_id,
        source_type: "internal_docs",
        source_id: doc.filename, // Use filename as stable ID
        title: doc.title,
        content_md: doc.content,
        metadata: {
          confidence: "high",
          doc_type: "system_documentation",
          filename: doc.filename,
        },
      });

      results.push(result);

      if (result.status === "unchanged") {
        unchanged++;
      } else {
        ingested++;
      }
    } catch (err) {
      console.error(`Failed to ingest doc ${doc.filename}:`, err);
      errors++;
      results.push({
        doc_id: "",
        chunk_count: 0,
        status: "unchanged",
        duration_ms: 0,
      });
    }
  }

  return { ingested, unchanged, errors, results };
}

/**
 * CLI entry point for running ingestion
 */
export async function main() {
  const org_id = process.env.DEFAULT_ORG_ID;

  if (!org_id) {
    console.error("DEFAULT_ORG_ID environment variable is required");
    process.exit(1);
  }

  console.log(`Ingesting docs from: ${DOCS_DIR}`);
  console.log(`Target org: ${org_id}`);

  const result = await ingestInternalDocs(org_id);

  console.log(`\nIngestion complete:`);
  console.log(`  Ingested: ${result.ingested}`);
  console.log(`  Unchanged: ${result.unchanged}`);
  console.log(`  Errors: ${result.errors}`);

  if (result.errors > 0) {
    process.exit(1);
  }
}
