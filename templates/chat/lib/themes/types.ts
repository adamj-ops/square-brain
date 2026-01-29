/**
 * Theme Types
 *
 * Types for the themes system - extracted patterns from content.
 *
 * Phase 5.3: Background compounding job (themes scanner)
 */

/** Theme categories */
export const THEME_CATEGORIES = [
  "product",
  "culture",
  "process",
  "strategy",
  "technical",
  "customer",
  "growth",
  "operations",
  "other",
] as const;
export type ThemeCategory = (typeof THEME_CATEGORIES)[number];

/** Theme status */
export const THEME_STATUSES = ["active", "merged", "archived"] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];

/** Content types that can be linked to themes */
export const CONTENT_TYPES = ["brain_item", "ai_doc", "ai_chunk"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Theme - An extracted pattern/topic from content
 */
export interface Theme {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  category: ThemeCategory | null;
  mention_count: number;
  evidence_count: number;
  confidence_score: number;
  status: ThemeStatus;
  merged_into_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

/**
 * Content-Theme link (evidence)
 */
export interface ContentTheme {
  id: string;
  org_id: string;
  theme_id: string;
  content_type: ContentType;
  content_id: string;
  relevance_score: number;
  excerpt: string | null;
  context: string | null;
  detected_by: string;
  detection_metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Theme with its evidence (for display)
 */
export interface ThemeWithEvidence extends Theme {
  evidence: ContentTheme[];
}

/**
 * Extracted theme from LLM analysis
 */
export interface ExtractedTheme {
  name: string;
  slug: string;
  description: string;
  category: ThemeCategory;
  relevance_score: number;
  excerpt: string;
  context?: string;
}

/**
 * Scanner job input
 */
export interface ThemeScannerInput {
  org_id: string;
  /** Content types to scan (default: all) */
  content_types?: ContentType[];
  /** Only scan content updated after this date */
  since?: string;
  /** Limit number of items to scan */
  limit?: number;
  /** Force rescan even if already scanned */
  force?: boolean;
}

/**
 * Scanner job result
 */
export interface ThemeScannerResult {
  scanned_count: number;
  themes_created: number;
  themes_updated: number;
  links_created: number;
  errors: number;
  duration_ms: number;
}
