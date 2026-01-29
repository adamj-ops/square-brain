import {
  BRAIN_ITEM_TYPES,
  BRAIN_ITEM_SOURCES,
  type BrainItemType,
  type BrainItemSource,
  type BrainItemInput,
} from "./types";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** Sanitized/normalized input (only if valid) */
  data?: BrainItemInput;
}

/**
 * Validates and normalizes brain item input.
 * Returns sanitized data if valid, or errors if not.
 */
export function validateBrainItemInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Invalid input" }] };
  }

  const raw = input as Record<string, unknown>;

  // Type validation (required, must be in allowed list)
  if (!raw.type || typeof raw.type !== "string") {
    errors.push({ field: "type", message: "type is required" });
  } else if (!BRAIN_ITEM_TYPES.includes(raw.type as BrainItemType)) {
    errors.push({
      field: "type",
      message: `type must be one of: ${BRAIN_ITEM_TYPES.join(", ")}`,
    });
  }

  // Title validation (required, min 3 chars)
  if (!raw.title || typeof raw.title !== "string") {
    errors.push({ field: "title", message: "title is required" });
  } else if (raw.title.trim().length < 3) {
    errors.push({ field: "title", message: "title must be at least 3 characters" });
  }

  // Content validation (required, min 20 chars)
  if (!raw.content_md || typeof raw.content_md !== "string") {
    errors.push({ field: "content_md", message: "content_md is required" });
  } else if (raw.content_md.trim().length < 20) {
    errors.push({
      field: "content_md",
      message: "content_md must be at least 20 characters",
    });
  }

  // Confidence score validation (optional, 0-1)
  let confidenceScore = 0.75; // default
  if (raw.confidence_score !== undefined) {
    if (typeof raw.confidence_score !== "number") {
      errors.push({ field: "confidence_score", message: "confidence_score must be a number" });
    } else if (raw.confidence_score < 0 || raw.confidence_score > 1) {
      errors.push({
        field: "confidence_score",
        message: "confidence_score must be between 0 and 1",
      });
    } else {
      confidenceScore = raw.confidence_score;
    }
  }

  // Tags normalization (optional, trim, dedupe, remove empties, max 20)
  let tags: string[] = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      errors.push({ field: "tags", message: "tags must be an array" });
    } else {
      tags = normalizeTags(raw.tags);
      if (tags.length > 20) {
        errors.push({ field: "tags", message: "maximum 20 tags allowed" });
      }
    }
  }

  // Source validation (optional, must be in allowed list)
  let source: BrainItemSource | undefined;
  if (raw.source !== undefined && raw.source !== null) {
    if (typeof raw.source !== "string") {
      errors.push({ field: "source", message: "source must be a string" });
    } else if (!BRAIN_ITEM_SOURCES.includes(raw.source as BrainItemSource)) {
      errors.push({
        field: "source",
        message: `source must be one of: ${BRAIN_ITEM_SOURCES.join(", ")}`,
      });
    } else {
      source = raw.source as BrainItemSource;
    }
  }

  // org_id (optional, must be string if provided)
  let orgId: string | undefined;
  if (raw.org_id !== undefined) {
    if (typeof raw.org_id !== "string") {
      errors.push({ field: "org_id", message: "org_id must be a string" });
    } else {
      orgId = raw.org_id;
    }
  }

  // canonical_key (optional, must be string if provided)
  let canonicalKey: string | undefined;
  if (raw.canonical_key !== undefined && raw.canonical_key !== null) {
    if (typeof raw.canonical_key !== "string") {
      errors.push({ field: "canonical_key", message: "canonical_key must be a string" });
    } else if (raw.canonical_key.trim().length === 0) {
      errors.push({ field: "canonical_key", message: "canonical_key cannot be empty" });
    } else {
      canonicalKey = raw.canonical_key.trim();
    }
  }

  // metadata (optional, must be object if provided)
  let metadata: Record<string, unknown> = {};
  if (raw.metadata !== undefined) {
    if (typeof raw.metadata !== "object" || raw.metadata === null || Array.isArray(raw.metadata)) {
      errors.push({ field: "metadata", message: "metadata must be an object" });
    } else {
      metadata = raw.metadata as Record<string, unknown>;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Build sanitized input
  const data: BrainItemInput = {
    type: raw.type as BrainItemType,
    title: (raw.title as string).trim(),
    content_md: (raw.content_md as string).trim(),
    tags,
    confidence_score: confidenceScore,
    metadata,
  };

  if (orgId) data.org_id = orgId;
  if (source) data.source = source;
  if (canonicalKey) data.canonical_key = canonicalKey;

  return { valid: true, errors: [], data };
}

/**
 * Normalize tags: trim, lowercase, remove empties, dedupe
 */
function normalizeTags(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/**
 * Check if type is valid
 */
export function isValidBrainItemType(type: unknown): type is BrainItemType {
  return typeof type === "string" && BRAIN_ITEM_TYPES.includes(type as BrainItemType);
}
