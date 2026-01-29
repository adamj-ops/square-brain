/**
 * Tool Registry
 *
 * Central registry of all available tools.
 * Phase 4: Tool Executor + Audit Logging
 * Phase 5.1: RAG Semantic Search
 * Pipeline 1: Guest Intelligence
 */

import type { ToolDefinition } from "./types";
import { brainUpsertItemTool } from "./implementations/brain-upsert-item";
import { brainSearchItemsTool } from "./implementations/brain-search-items";
import { brainSemanticSearchTool } from "./implementations/brain-semantic-search";
import { guestsUpsertProfileTool } from "./implementations/guests-upsert-profile";
import { guestsExtractSignalsTool } from "./implementations/guests-extract-signals";
import { scoringScoreGuestTool } from "./implementations/scoring-score-guest";
import { interviewsAddQuoteTool } from "./implementations/interviews-add-quote";
import { themesUpsertThemeTool } from "./implementations/themes-upsert-theme";
import { themesLinkToInterviewTool } from "./implementations/themes-link-to-interview";
import { contentGenerateAssetsTool } from "./implementations/content-generate-assets";
import { outreachComposeMessageTool } from "./implementations/outreach-compose-message";
import { outreachSendEmailTool } from "./implementations/outreach-send-email";
import { audienceScoreQuizTool } from "./implementations/audience-score-quiz";
// Note: knowledgeIngestFirecrawlTool not registered here because it requires
// Node.js runtime (crypto). Use the HTTP endpoint /api/internal/ingest/firecrawl instead.

/**
 * Map of tool name -> tool definition
 * Using `any` generics to allow storing tools with different arg/result types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: Map<string, ToolDefinition<any, any>> = new Map();

/**
 * Register a tool in the registry
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerTool(tool: ToolDefinition<any, any>): void {
  if (TOOLS.has(tool.name)) {
    console.warn(`[registry] Tool "${tool.name}" is already registered, overwriting`);
  }
  TOOLS.set(tool.name, tool);
}

// Register core tools (Edge-compatible)
registerTool(brainUpsertItemTool);
registerTool(brainSearchItemsTool);
registerTool(brainSemanticSearchTool);

// Pipeline 1: Guest Intelligence tools
registerTool(guestsUpsertProfileTool);
registerTool(guestsExtractSignalsTool);
registerTool(scoringScoreGuestTool);

// Pipeline 2: Interview Intelligence tools
registerTool(interviewsAddQuoteTool);
registerTool(themesUpsertThemeTool);
registerTool(themesLinkToInterviewTool);

// Pipeline 3: Content Repurposing tools
registerTool(contentGenerateAssetsTool);

// Pipeline 4: Outreach Automation tools
registerTool(outreachComposeMessageTool);
registerTool(outreachSendEmailTool);

// Pipeline 5: Audience & Quiz Segmentation tools
registerTool(audienceScoreQuizTool);

// knowledgeIngestFirecrawlTool requires Node.js - use HTTP endpoint instead

/**
 * Get a tool by name
 */
export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS.get(name);
}

/**
 * Get all registered tool names
 */
export function getToolNames(): string[] {
  return Array.from(TOOLS.keys());
}

/**
 * Get all registered tools
 */
export function getAllTools(): ToolDefinition[] {
  return Array.from(TOOLS.values());
}

/**
 * Check if a tool exists
 */
export function hasTool(name: string): boolean {
  return TOOLS.has(name);
}
