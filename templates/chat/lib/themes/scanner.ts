/**
 * Theme Scanner Job
 *
 * Scans content (brain_items, ai_docs) to extract themes
 * and create evidence links.
 *
 * Phase 5.3: Background compounding job (themes scanner)
 */

import OpenAI from "openai";
import { getServiceSupabase } from "@/lib/supabase/server";
import type {
  ThemeScannerInput,
  ThemeScannerResult,
  ExtractedTheme,
  ThemeCategory,
} from "./types";

const openai = new OpenAI();

const DEFAULT_LIMIT = 50;
const BATCH_SIZE = 5; // Process in batches to avoid rate limits

/**
 * Slugify a theme name for URL-safe identifier
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Extract themes from content using LLM
 */
async function extractThemes(
  title: string,
  content: string,
  contentType: string
): Promise<ExtractedTheme[]> {
  const systemPrompt = `You are a theme extraction system. Analyze the given content and extract recurring themes, patterns, or key topics.

For each theme, provide:
- name: A clear, concise name (2-4 words)
- description: A brief description of what this theme represents
- category: One of: product, culture, process, strategy, technical, customer, growth, operations, other
- relevance_score: How central this theme is to the content (0.0-1.0)
- excerpt: A direct quote or paraphrase from the content that exemplifies this theme

Guidelines:
- Extract 1-5 themes per piece of content
- Focus on substantive, recurring patterns, not one-off mentions
- Themes should be general enough to appear across multiple documents
- Be precise with excerpts - they should clearly demonstrate the theme
- Higher relevance_score for themes that are central to the content's message

Return JSON array of themes. If no clear themes, return empty array [].`;

  const userPrompt = `Content Type: ${contentType}
Title: ${title}

Content:
${content.slice(0, 4000)}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const result = response.choices[0]?.message?.content;
    if (!result) return [];

    const parsed = JSON.parse(result);
    const themes = parsed.themes || parsed;

    if (!Array.isArray(themes)) return [];

    // Validate and transform
    return themes
      .filter((t: Record<string, unknown>) => t.name && typeof t.name === "string")
      .map((t: Record<string, unknown>) => ({
        name: String(t.name).trim(),
        slug: slugify(String(t.name)),
        description: String(t.description || "").trim(),
        category: validateCategory(t.category),
        relevance_score: Math.min(1, Math.max(0, Number(t.relevance_score) || 0.5)),
        excerpt: String(t.excerpt || "").trim(),
        context: String(t.context || "").trim() || undefined,
      }));
  } catch (error) {
    console.error("[theme-scanner] LLM extraction failed:", error);
    return [];
  }
}

/**
 * Validate category is one of the allowed values
 */
function validateCategory(cat: unknown): ThemeCategory {
  const validCategories: ThemeCategory[] = [
    "product",
    "culture",
    "process",
    "strategy",
    "technical",
    "customer",
    "growth",
    "operations",
    "other",
  ];
  if (typeof cat === "string" && validCategories.includes(cat as ThemeCategory)) {
    return cat as ThemeCategory;
  }
  return "other";
}

/**
 * Get or create a theme and return its ID
 * Uses the get_or_create_theme RPC function for atomicity
 */
async function getOrCreateTheme(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  theme: ExtractedTheme
): Promise<{ id: string; created: boolean }> {
  // Check for existing theme first (to know if we're creating or updating)
  const { data: existing } = await supabase
    .from("themes")
    .select("id")
    .eq("org_id", orgId)
    .eq("slug", theme.slug)
    .eq("status", "active")
    .single();

  const wasExisting = !!existing;

  // Use RPC function for atomic get-or-create
  const { data: themeId, error: rpcError } = await supabase.rpc("get_or_create_theme", {
    p_org_id: orgId,
    p_name: theme.name,
    p_slug: theme.slug,
    p_description: theme.description,
    p_category: theme.category,
  });

  if (rpcError) {
    // Fallback to direct insert if RPC fails
    console.warn("[theme-scanner] RPC failed, trying direct insert:", rpcError);
    
    if (existing) {
      // Update existing theme
      await supabase
        .from("themes")
        .update({
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return { id: existing.id, created: false };
    }

    // Try direct insert
    const { data: newTheme, error: insertError } = await supabase
      .from("themes")
      .insert({
        org_id: orgId,
        name: theme.name,
        slug: theme.slug,
        description: theme.description,
        category: theme.category,
        confidence_score: theme.relevance_score,
      })
      .select("id")
      .single();

    if (insertError) {
      // Handle race condition
      if (insertError.code === "23505") {
        const { data: raced } = await supabase
          .from("themes")
          .select("id")
          .eq("org_id", orgId)
          .eq("slug", theme.slug)
          .single();
        if (raced) return { id: raced.id, created: false };
      }
      throw insertError;
    }

    return { id: newTheme.id, created: true };
  }

  return { id: themeId, created: !wasExisting };
}

/**
 * Link content to a theme
 */
async function linkContentToTheme(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  themeId: string,
  contentType: string,
  contentId: string,
  theme: ExtractedTheme
): Promise<boolean> {
  const { error } = await supabase.from("content_themes").upsert(
    {
      org_id: orgId,
      theme_id: themeId,
      content_type: contentType,
      content_id: contentId,
      relevance_score: theme.relevance_score,
      excerpt: theme.excerpt || null,
      context: theme.context || null,
      detected_by: "scanner",
      detection_metadata: {
        model: "gpt-4o-mini",
        scanned_at: new Date().toISOString(),
      },
    },
    {
      onConflict: "theme_id,content_type,content_id",
    }
  );

  if (error) {
    console.error("[theme-scanner] Failed to link content:", error);
    return false;
  }

  return true;
}

/**
 * Scan brain_items for themes
 */
async function scanBrainItems(
  supabase: ReturnType<typeof getServiceSupabase>,
  input: ThemeScannerInput
): Promise<{ items: Array<{ id: string; title: string; content_md: string }>; count: number }> {
  let query = supabase
    .from("brain_items")
    .select("id, title, content_md")
    .eq("org_id", input.org_id)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(input.limit || DEFAULT_LIMIT);

  if (input.since) {
    query = query.gt("updated_at", input.since);
  }

  // Skip already scanned items unless force
  if (!input.force) {
    // Get already scanned item IDs
    const { data: scanned } = await supabase
      .from("content_themes")
      .select("content_id")
      .eq("org_id", input.org_id)
      .eq("content_type", "brain_item");

    const scannedIds = (scanned || []).map((s) => s.content_id);
    if (scannedIds.length > 0) {
      query = query.not("id", "in", `(${scannedIds.join(",")})`);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch brain_items: ${error.message}`);
  }

  return { items: data || [], count: data?.length || 0 };
}

/**
 * Scan ai_docs for themes
 */
async function scanAiDocs(
  supabase: ReturnType<typeof getServiceSupabase>,
  input: ThemeScannerInput
): Promise<{ items: Array<{ id: string; title: string; content_md: string }>; count: number }> {
  let query = supabase
    .from("ai_docs")
    .select("id, title, content_md")
    .eq("org_id", input.org_id)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(input.limit || DEFAULT_LIMIT);

  if (input.since) {
    query = query.gt("updated_at", input.since);
  }

  // Skip internal_docs (they're system docs, not content to theme)
  query = query.neq("source_type", "internal_docs");

  // Skip already scanned unless force
  if (!input.force) {
    const { data: scanned } = await supabase
      .from("content_themes")
      .select("content_id")
      .eq("org_id", input.org_id)
      .eq("content_type", "ai_doc");

    const scannedIds = (scanned || []).map((s) => s.content_id);
    if (scannedIds.length > 0) {
      query = query.not("id", "in", `(${scannedIds.join(",")})`);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch ai_docs: ${error.message}`);
  }

  return { items: data || [], count: data?.length || 0 };
}

/**
 * Scan interviews for themes
 * Pipeline 2: Interview Intelligence - auto-tag expertise and recurring themes
 */
async function scanInterviews(
  supabase: ReturnType<typeof getServiceSupabase>,
  input: ThemeScannerInput
): Promise<{ items: Array<{ id: string; title: string; content_md: string }>; count: number }> {
  let query = supabase
    .from("interviews")
    .select("id, title, transcript_text, summary, key_topics")
    .eq("org_id", input.org_id)
    .in("status", ["transcribed", "analyzed", "published"]) // Only scan interviews with content
    .order("updated_at", { ascending: false })
    .limit(input.limit || DEFAULT_LIMIT);

  if (input.since) {
    query = query.gt("updated_at", input.since);
  }

  // Skip already scanned unless force
  if (!input.force) {
    const { data: scanned } = await supabase
      .from("interview_themes")
      .select("interview_id")
      .eq("org_id", input.org_id);

    const scannedIds = (scanned || []).map((s) => s.interview_id);
    if (scannedIds.length > 0) {
      query = query.not("id", "in", `(${scannedIds.join(",")})`);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch interviews: ${error.message}`);
  }

  // Transform to common format - use transcript_text or summary as content
  const items = (data || []).map((interview) => {
    // Build content from available fields
    let content = "";
    if (interview.transcript_text) {
      content = interview.transcript_text;
    } else if (interview.summary) {
      content = interview.summary;
    }
    
    // Append key topics if available
    if (interview.key_topics && interview.key_topics.length > 0) {
      content += `\n\nKey Topics: ${interview.key_topics.join(", ")}`;
    }

    return {
      id: interview.id,
      title: interview.title,
      content_md: content,
    };
  }).filter(item => item.content_md.length > 0); // Only include interviews with content

  return { items, count: items.length };
}

/**
 * Link interview to extracted themes via interview_themes table
 */
async function linkInterviewToTheme(
  supabase: ReturnType<typeof getServiceSupabase>,
  orgId: string,
  themeId: string,
  interviewId: string,
  theme: ExtractedTheme
): Promise<boolean> {
  // Determine discussion depth based on relevance score
  let discussionDepth: "mentioned" | "discussed" | "deep_dive" | "expert_insight" = "discussed";
  if (theme.relevance_score >= 0.8) {
    discussionDepth = "deep_dive";
  } else if (theme.relevance_score >= 0.6) {
    discussionDepth = "discussed";
  } else {
    discussionDepth = "mentioned";
  }

  const { error } = await supabase.from("interview_themes").upsert(
    {
      org_id: orgId,
      interview_id: interviewId,
      theme_id: themeId,
      relevance_score: theme.relevance_score,
      discussion_depth: discussionDepth,
      excerpt: theme.excerpt || null,
      detected_by: "scanner",
      detection_metadata: {
        model: "gpt-4o-mini",
        scanned_at: new Date().toISOString(),
        category: theme.category,
      },
    },
    {
      onConflict: "interview_id,theme_id",
    }
  );

  if (error) {
    console.error("[theme-scanner] Failed to link interview to theme:", error);
    return false;
  }

  return true;
}

/**
 * Run the theme scanner job
 */
export async function runThemeScanner(
  input: ThemeScannerInput
): Promise<ThemeScannerResult> {
  const startTime = Date.now();
  const supabase = getServiceSupabase();

  const result: ThemeScannerResult = {
    scanned_count: 0,
    themes_created: 0,
    themes_updated: 0,
    links_created: 0,
    errors: 0,
    duration_ms: 0,
  };

  // Determine what to scan (now includes interview by default)
  const contentTypes = input.content_types || ["brain_item", "ai_doc", "interview"];

  // Collect items to scan
  const itemsToScan: Array<{
    type: string;
    id: string;
    title: string;
    content: string;
  }> = [];

  if (contentTypes.includes("brain_item")) {
    const { items } = await scanBrainItems(supabase, input);
    items.forEach((item) => {
      itemsToScan.push({
        type: "brain_item",
        id: item.id,
        title: item.title,
        content: item.content_md,
      });
    });
  }

  if (contentTypes.includes("ai_doc")) {
    const { items } = await scanAiDocs(supabase, input);
    items.forEach((item) => {
      itemsToScan.push({
        type: "ai_doc",
        id: item.id,
        title: item.title,
        content: item.content_md,
      });
    });
  }

  if (contentTypes.includes("interview")) {
    const { items } = await scanInterviews(supabase, input);
    items.forEach((item) => {
      itemsToScan.push({
        type: "interview",
        id: item.id,
        title: item.title,
        content: item.content_md,
      });
    });
  }

  console.log(`[theme-scanner] Scanning ${itemsToScan.length} items`);

  // Process in batches
  for (let i = 0; i < itemsToScan.length; i += BATCH_SIZE) {
    const batch = itemsToScan.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (item) => {
        try {
          result.scanned_count++;

          // Extract themes
          const themes = await extractThemes(item.title, item.content, item.type);

          if (themes.length === 0) {
            return;
          }

          // Process each theme
          for (const theme of themes) {
            try {
              // Get or create theme
              const { id: themeId, created } = await getOrCreateTheme(
                supabase,
                input.org_id,
                theme
              );

              if (created) {
                result.themes_created++;
              } else {
                result.themes_updated++;
              }

              // Link content to theme (use interview_themes for interviews)
              let linked: boolean;
              if (item.type === "interview") {
                linked = await linkInterviewToTheme(
                  supabase,
                  input.org_id,
                  themeId,
                  item.id,
                  theme
                );
              } else {
                linked = await linkContentToTheme(
                  supabase,
                  input.org_id,
                  themeId,
                  item.type,
                  item.id,
                  theme
                );
              }

              if (linked) {
                result.links_created++;
              }
            } catch (themeError) {
              console.error(`[theme-scanner] Theme processing error:`, themeError);
              result.errors++;
            }
          }
        } catch (itemError) {
          console.error(`[theme-scanner] Item processing error:`, itemError);
          result.errors++;
        }
      })
    );

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < itemsToScan.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  result.duration_ms = Date.now() - startTime;

  console.log(`[theme-scanner] Complete:`, result);

  return result;
}

/**
 * Get themes with evidence for an org
 */
export async function getThemesWithEvidence(
  orgId: string,
  options?: { limit?: number; category?: string }
): Promise<Array<{ theme: Record<string, unknown>; evidence: Record<string, unknown>[] }>> {
  const supabase = getServiceSupabase();

  let query = supabase
    .from("themes")
    .select(
      `
      *,
      content_themes (*)
    `
    )
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("evidence_count", { ascending: false })
    .limit(options?.limit || 20);

  if (options?.category) {
    query = query.eq("category", options.category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch themes: ${error.message}`);
  }

  return (data || []).map((t) => ({
    theme: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      category: t.category,
      mention_count: t.mention_count,
      evidence_count: t.evidence_count,
      confidence_score: t.confidence_score,
    },
    evidence: t.content_themes || [],
  }));
}
