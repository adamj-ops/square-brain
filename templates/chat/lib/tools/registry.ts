/**
 * Tool Registry
 *
 * Central registry of all available tools.
 * Phase 4: Tool Executor + Audit Logging
 */

import type { ToolDefinition } from "./types";
import { brainUpsertItemTool } from "./implementations/brain-upsert-item";
import { brainSearchItemsTool } from "./implementations/brain-search-items";

/**
 * Map of tool name -> tool definition
 */
const TOOLS: Map<string, ToolDefinition> = new Map();

/**
 * Register a tool in the registry
 */
function registerTool(tool: ToolDefinition): void {
  if (TOOLS.has(tool.name)) {
    console.warn(`[registry] Tool "${tool.name}" is already registered, overwriting`);
  }
  TOOLS.set(tool.name, tool);
}

// Register core tools
registerTool(brainUpsertItemTool);
registerTool(brainSearchItemsTool);

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
