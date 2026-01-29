/**
 * Brain Item Types
 * 
 * Core memory primitives for the LifeRX Brain:
 * - Decisions: Key choices made
 * - SOPs: Standard operating procedures
 * - Principles: Guiding beliefs/rules
 * - Playbooks: Step-by-step guides
 */

/** Allowed brain item types */
export const BRAIN_ITEM_TYPES = ["decision", "sop", "principle", "playbook"] as const;
export type BrainItemType = (typeof BRAIN_ITEM_TYPES)[number];

/** Allowed status values */
export const BRAIN_ITEM_STATUSES = ["active", "archived"] as const;
export type BrainItemStatus = (typeof BRAIN_ITEM_STATUSES)[number];

/** Allowed source values */
export const BRAIN_ITEM_SOURCES = ["manual", "agent", "import", "apify", "interview"] as const;
export type BrainItemSource = (typeof BRAIN_ITEM_SOURCES)[number];

/**
 * Brain Item - Core memory unit
 */
export interface BrainItem {
  id: string;
  org_id: string;
  type: BrainItemType;
  title: string;
  content_md: string;
  tags: string[];
  confidence_score: number; // 0-1
  source: BrainItemSource | null;
  status: BrainItemStatus;
  version: number;
  canonical_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating/upserting a brain item
 */
export interface BrainItemInput {
  org_id?: string; // Defaults to DEFAULT_ORG_ID
  type: BrainItemType;
  title: string;
  content_md: string;
  tags?: string[];
  confidence_score?: number; // Defaults to 0.75
  source?: BrainItemSource;
  canonical_key?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Response from upsert operation
 */
export interface UpsertResult {
  id: string;
  version: number;
}

/**
 * Search result item (excerpt instead of full content)
 */
export interface BrainItemSearchResult {
  id: string;
  type: BrainItemType;
  title: string;
  excerpt: string;
  tags: string[];
  confidence_score: number;
  updated_at: string;
}

/**
 * Search parameters
 */
export interface BrainSearchParams {
  query?: string;
  type?: BrainItemType;
  tag?: string;
  limit?: number;
  offset?: number;
}
