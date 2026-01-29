/**
 * Text Chunker
 *
 * Splits documents into overlapping chunks for embedding.
 * Phase 5.1: RAG Semantic Search
 */

export interface ChunkOptions {
  /** Target chunk size in characters (default: 1000) */
  chunkSize?: number;
  /** Overlap between chunks in characters (default: 200) */
  chunkOverlap?: number;
  /** Minimum chunk size to keep (default: 100) */
  minChunkSize?: number;
}

export interface Chunk {
  /** 0-based index of the chunk in the document */
  index: number;
  /** Chunk content */
  content: string;
  /** Approximate token count (chars / 4) */
  tokenCount: number;
  /** Start character position in original document */
  startChar: number;
  /** End character position in original document */
  endChar: number;
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_MIN_CHUNK_SIZE = 100;

/**
 * Split text into chunks with overlap.
 *
 * Strategy:
 * 1. Try to split on paragraph boundaries (double newline)
 * 2. Fall back to sentence boundaries (. ! ?)
 * 3. Fall back to word boundaries (space)
 * 4. Last resort: hard character split
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const minChunkSize = options.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;

  if (!text || text.trim().length === 0) {
    return [];
  }

  // Normalize whitespace but preserve structure
  const normalizedText = text.replace(/\r\n/g, "\n").trim();

  // If text is smaller than chunk size, return as single chunk
  if (normalizedText.length <= chunkSize) {
    return [
      {
        index: 0,
        content: normalizedText,
        tokenCount: estimateTokens(normalizedText),
        startChar: 0,
        endChar: normalizedText.length,
      },
    ];
  }

  const chunks: Chunk[] = [];
  let currentPos = 0;
  let chunkIndex = 0;

  while (currentPos < normalizedText.length) {
    // Calculate end position for this chunk
    let endPos = Math.min(currentPos + chunkSize, normalizedText.length);

    // If we're not at the end, try to find a good break point
    if (endPos < normalizedText.length) {
      const breakPoint = findBreakPoint(
        normalizedText,
        currentPos,
        endPos,
        chunkSize
      );
      if (breakPoint > currentPos) {
        endPos = breakPoint;
      }
    }

    // Extract chunk content
    const content = normalizedText.slice(currentPos, endPos).trim();

    // Only add if meets minimum size
    if (content.length >= minChunkSize) {
      chunks.push({
        index: chunkIndex,
        content,
        tokenCount: estimateTokens(content),
        startChar: currentPos,
        endChar: endPos,
      });
      chunkIndex++;
    }

    // Move position forward, accounting for overlap
    const effectiveOverlap = Math.min(chunkOverlap, endPos - currentPos - 1);
    currentPos = endPos - effectiveOverlap;

    // Prevent infinite loop
    if (currentPos >= normalizedText.length - minChunkSize) {
      break;
    }
  }

  return chunks;
}

/**
 * Find a good break point for chunking.
 * Prefers: paragraph > sentence > word > hard break
 */
function findBreakPoint(
  text: string,
  startPos: number,
  endPos: number,
  chunkSize: number
): number {
  const searchWindow = text.slice(startPos, endPos);
  const windowLength = searchWindow.length;

  // Look in the last 20% of the chunk for break points
  const searchStart = Math.floor(windowLength * 0.8);

  // Try paragraph break (double newline)
  const paragraphBreak = searchWindow.lastIndexOf("\n\n", windowLength);
  if (paragraphBreak > searchStart) {
    return startPos + paragraphBreak + 2; // After the double newline
  }

  // Try single newline
  const newlineBreak = searchWindow.lastIndexOf("\n", windowLength);
  if (newlineBreak > searchStart) {
    return startPos + newlineBreak + 1;
  }

  // Try sentence break (. ! ?)
  const sentencePattern = /[.!?]\s+/g;
  let lastSentenceBreak = -1;
  let match;
  while ((match = sentencePattern.exec(searchWindow)) !== null) {
    if (match.index > searchStart) {
      lastSentenceBreak = match.index + match[0].length;
    }
  }
  if (lastSentenceBreak > searchStart) {
    return startPos + lastSentenceBreak;
  }

  // Try word break (space)
  const spaceBreak = searchWindow.lastIndexOf(" ", windowLength);
  if (spaceBreak > searchStart) {
    return startPos + spaceBreak + 1;
  }

  // Hard break at end position
  return endPos;
}

/**
 * Estimate token count (rough approximation: ~4 chars per token for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk a markdown document with awareness of headings.
 * Adds section context to chunk metadata.
 */
export function chunkMarkdown(
  text: string,
  options: ChunkOptions = {}
): (Chunk & { sectionTitle?: string })[] {
  const chunks = chunkText(text, options);

  // Find section headings and add to chunks
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const headings: { level: number; title: string; pos: number }[] = [];

  let match;
  while ((match = headingPattern.exec(text)) !== null) {
    headings.push({
      level: match[1].length,
      title: match[2].trim(),
      pos: match.index,
    });
  }

  // Add section context to each chunk
  return chunks.map((chunk) => {
    // Find the most recent heading before this chunk
    const relevantHeadings = headings.filter((h) => h.pos <= chunk.startChar);
    const currentHeading = relevantHeadings[relevantHeadings.length - 1];

    return {
      ...chunk,
      sectionTitle: currentHeading?.title,
    };
  });
}
