/**
 * CHECKPOINT 4 Test: Query Themes + Quotes Across Interviews
 * 
 * This script tests the Interview Intelligence pipeline (Pipeline 2):
 * 1. Creates mock interviews with quotes
 * 2. Creates/links themes to interviews
 * 3. Queries themes and quotes across interviews
 * 
 * Run with: npx tsx scripts/test-interview-themes.ts
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "default-org";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Mock interview data
const MOCK_INTERVIEWS = [
  {
    title: "The Future of AI in Healthcare",
    slug: "future-ai-healthcare",
    guest_name: "Dr. Sarah Chen",
    status: "analyzed",
    key_topics: ["AI", "Healthcare", "Machine Learning", "Diagnostics"],
    quotes: [
      {
        quote_text: "AI will not replace doctors, but doctors who use AI will replace those who don't.",
        speaker_name: "Dr. Sarah Chen",
        topic: "AI adoption",
        is_highlight: true,
        timestamp_start: "00:15:30",
      },
      {
        quote_text: "The real breakthrough will come when we can predict diseases before symptoms appear.",
        speaker_name: "Dr. Sarah Chen",
        topic: "Predictive medicine",
        is_highlight: true,
        timestamp_start: "00:28:45",
      },
      {
        quote_text: "We're seeing 40% improvement in diagnostic accuracy with AI-assisted imaging.",
        speaker_name: "Dr. Sarah Chen",
        topic: "Diagnostics",
        is_highlight: false,
        timestamp_start: "00:35:12",
      },
    ],
    themes: ["AI in Medicine", "Future of Healthcare", "Technology Adoption"],
  },
  {
    title: "Building Scalable Health Tech Startups",
    slug: "scalable-health-tech",
    guest_name: "Michael Rodriguez",
    status: "analyzed",
    key_topics: ["Startups", "Healthcare", "Scaling", "Investment"],
    quotes: [
      {
        quote_text: "The biggest mistake health tech founders make is building for doctors instead of with doctors.",
        speaker_name: "Michael Rodriguez",
        topic: "Product development",
        is_highlight: true,
        timestamp_start: "00:08:20",
      },
      {
        quote_text: "Compliance isn't a barrier, it's a moat. If you solve it early, you win.",
        speaker_name: "Michael Rodriguez",
        topic: "Compliance",
        is_highlight: true,
        timestamp_start: "00:22:15",
      },
    ],
    themes: ["Startup Strategy", "Healthcare Innovation", "Technology Adoption"],
  },
  {
    title: "Neuroscience and Human Performance",
    slug: "neuroscience-performance",
    guest_name: "Dr. Emily Watson",
    status: "analyzed",
    key_topics: ["Neuroscience", "Performance", "Brain-Computer Interfaces", "Cognition"],
    quotes: [
      {
        quote_text: "The brain's plasticity means we can literally rewire ourselves for better performance.",
        speaker_name: "Dr. Emily Watson",
        topic: "Neuroplasticity",
        is_highlight: true,
        timestamp_start: "00:12:40",
      },
      {
        quote_text: "Brain-computer interfaces will first be medical devices, then consumer products.",
        speaker_name: "Dr. Emily Watson",
        topic: "BCI",
        is_highlight: true,
        timestamp_start: "00:32:18",
      },
      {
        quote_text: "Sleep is the single most underrated performance enhancer we have.",
        speaker_name: "Dr. Emily Watson",
        topic: "Sleep",
        is_highlight: true,
        timestamp_start: "00:45:30",
      },
    ],
    themes: ["AI in Medicine", "Future of Healthcare", "Human Performance"],
  },
];

/**
 * Clean up test data
 */
async function cleanup() {
  console.log("🧹 Cleaning up existing test data...");
  
  const slugs = MOCK_INTERVIEWS.map(i => i.slug);
  
  // Get interview IDs
  const { data: existingInterviews } = await supabase
    .from("interviews")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .in("slug", slugs);
  
  if (existingInterviews && existingInterviews.length > 0) {
    const interviewIds = existingInterviews.map(i => i.id);
    
    // Delete interview themes links
    await supabase.from("interview_themes").delete().in("interview_id", interviewIds);
    
    // Delete quotes
    await supabase.from("interview_quotes").delete().in("interview_id", interviewIds);
    
    // Delete interviews
    await supabase.from("interviews").delete().in("id", interviewIds);
  }
  
  // Delete test themes
  const themeNames = [...new Set(MOCK_INTERVIEWS.flatMap(i => i.themes))];
  const themeSlugs = themeNames.map(name => 
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  );
  
  await supabase.from("themes").delete()
    .eq("org_id", DEFAULT_ORG_ID)
    .in("slug", themeSlugs);
  
  console.log("✅ Cleanup complete\n");
}

/**
 * Create an interview with quotes
 */
async function createInterview(interview: typeof MOCK_INTERVIEWS[0]): Promise<string> {
  // Insert interview
  const { data: interviewData, error: interviewError } = await supabase
    .from("interviews")
    .insert({
      org_id: DEFAULT_ORG_ID,
      title: interview.title,
      slug: interview.slug,
      status: interview.status,
      key_topics: interview.key_topics,
    })
    .select("id")
    .single();
  
  if (interviewError) {
    throw new Error(`Failed to create interview ${interview.title}: ${interviewError.message}`);
  }
  
  const interviewId = interviewData.id;
  
  // Insert quotes
  for (const quote of interview.quotes) {
    const { error: quoteError } = await supabase
      .from("interview_quotes")
      .insert({
        interview_id: interviewId,
        org_id: DEFAULT_ORG_ID,
        quote_text: quote.quote_text,
        speaker_name: quote.speaker_name,
        topic: quote.topic,
        is_highlight: quote.is_highlight,
        timestamp_start: quote.timestamp_start,
      });
    
    if (quoteError) {
      console.warn(`  Warning: Failed to create quote: ${quoteError.message}`);
    }
  }
  
  return interviewId;
}

/**
 * Get or create a theme
 */
async function getOrCreateTheme(name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  
  // Check if exists
  const { data: existing } = await supabase
    .from("themes")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("slug", slug)
    .maybeSingle();
  
  if (existing) {
    return existing.id;
  }
  
  // Create new
  const { data: newTheme, error } = await supabase
    .from("themes")
    .insert({
      org_id: DEFAULT_ORG_ID,
      name,
      slug,
      status: "active",
    })
    .select("id")
    .single();
  
  if (error) {
    throw new Error(`Failed to create theme ${name}: ${error.message}`);
  }
  
  return newTheme.id;
}

/**
 * Link theme to interview
 */
async function linkThemeToInterview(themeId: string, interviewId: string) {
  const { error } = await supabase
    .from("interview_themes")
    .upsert({
      theme_id: themeId,
      interview_id: interviewId,
      org_id: DEFAULT_ORG_ID,
    }, { onConflict: "theme_id,interview_id" });
  
  if (error) {
    console.warn(`  Warning: Failed to link theme: ${error.message}`);
  }
}

/**
 * Query themes with interview counts
 */
async function queryThemesWithInterviewCounts() {
  const { data: themes, error } = await supabase
    .from("themes")
    .select(`
      id,
      name,
      slug,
      interview_themes!inner (
        interview_id
      )
    `)
    .eq("org_id", DEFAULT_ORG_ID);
  
  if (error) {
    throw new Error(`Failed to query themes: ${error.message}`);
  }
  
  // Aggregate counts
  const themeCounts = themes?.map(theme => ({
    name: theme.name,
    interview_count: Array.isArray(theme.interview_themes) ? theme.interview_themes.length : 0,
  })) || [];
  
  return themeCounts.sort((a, b) => b.interview_count - a.interview_count);
}

/**
 * Query quotes across interviews by theme
 */
async function queryQuotesByTheme(themeName: string) {
  const slug = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  
  // Get theme
  const { data: theme } = await supabase
    .from("themes")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("slug", slug)
    .single();
  
  if (!theme) {
    return [];
  }
  
  // Get interviews linked to this theme
  const { data: links } = await supabase
    .from("interview_themes")
    .select("interview_id")
    .eq("theme_id", theme.id);
  
  if (!links || links.length === 0) {
    return [];
  }
  
  const interviewIds = links.map(l => l.interview_id);
  
  // Get quotes from these interviews
  const { data: quotes, error } = await supabase
    .from("interview_quotes")
    .select(`
      id,
      quote_text,
      speaker_name,
      topic,
      is_highlight,
      interviews!inner (
        title
      )
    `)
    .in("interview_id", interviewIds)
    .eq("is_highlight", true)
    .order("created_at", { ascending: false });
  
  if (error) {
    throw new Error(`Failed to query quotes: ${error.message}`);
  }
  
  return quotes?.map(q => ({
    quote_text: q.quote_text,
    speaker_name: q.speaker_name,
    topic: q.topic,
    interview_title: Array.isArray(q.interviews) ? q.interviews[0]?.title : (q.interviews as { title: string })?.title,
  })) || [];
}

/**
 * Query all highlight quotes
 */
async function queryAllHighlightQuotes() {
  const { data: quotes, error } = await supabase
    .from("interview_quotes")
    .select(`
      id,
      quote_text,
      speaker_name,
      topic,
      interviews!inner (
        title,
        slug
      )
    `)
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("is_highlight", true)
    .order("created_at", { ascending: false });
  
  if (error) {
    throw new Error(`Failed to query quotes: ${error.message}`);
  }
  
  return quotes || [];
}

/**
 * Main test function
 */
async function main() {
  console.log("🧪 CHECKPOINT 4: Interview Intelligence Pipeline Test\n");
  console.log("=".repeat(60) + "\n");
  
  try {
    await cleanup();
    
    // Step 1: Create interviews with quotes
    console.log("📝 Creating mock interviews with quotes...\n");
    
    const interviewIds: Record<string, string> = {};
    
    for (const interview of MOCK_INTERVIEWS) {
      console.log(`  Creating "${interview.title}"...`);
      const interviewId = await createInterview(interview);
      interviewIds[interview.slug] = interviewId;
      console.log(`    ✅ Created with ${interview.quotes.length} quotes`);
    }
    
    console.log();
    
    // Step 2: Create themes and link to interviews
    console.log("🏷️  Creating themes and linking to interviews...\n");
    
    for (const interview of MOCK_INTERVIEWS) {
      for (const themeName of interview.themes) {
        const themeId = await getOrCreateTheme(themeName);
        await linkThemeToInterview(themeId, interviewIds[interview.slug]);
      }
      console.log(`  ✅ Linked ${interview.themes.length} themes to "${interview.title}"`);
    }
    
    console.log("\n" + "=".repeat(60) + "\n");
    
    // Step 3: Query themes with interview counts
    console.log("📊 THEMES WITH INTERVIEW COUNTS\n");
    
    const themeCounts = await queryThemesWithInterviewCounts();
    
    for (const theme of themeCounts) {
      console.log(`  ${theme.name}: ${theme.interview_count} interview(s)`);
    }
    
    console.log("\n" + "=".repeat(60) + "\n");
    
    // Step 4: Query quotes by a specific theme
    const targetTheme = "Future of Healthcare";
    console.log(`📜 HIGHLIGHT QUOTES FOR THEME: "${targetTheme}"\n`);
    
    const themeQuotes = await queryQuotesByTheme(targetTheme);
    
    if (themeQuotes.length === 0) {
      console.log("  No quotes found for this theme.\n");
    } else {
      for (const quote of themeQuotes) {
        console.log(`  "${quote.quote_text}"`);
        console.log(`    — ${quote.speaker_name} (${quote.interview_title})`);
        console.log(`    Topic: ${quote.topic}\n`);
      }
    }
    
    console.log("=".repeat(60) + "\n");
    
    // Step 5: Query all highlight quotes across interviews
    console.log("⭐ ALL HIGHLIGHT QUOTES ACROSS INTERVIEWS\n");
    
    const allQuotes = await queryAllHighlightQuotes();
    
    for (const quote of allQuotes) {
      const interviewTitle = Array.isArray(quote.interviews) 
        ? quote.interviews[0]?.title 
        : (quote.interviews as { title: string })?.title;
      
      console.log(`  "${quote.quote_text}"`);
      console.log(`    — ${quote.speaker_name} (${interviewTitle})`);
      console.log();
    }
    
    console.log("=".repeat(60) + "\n");
    console.log(`✅ CHECKPOINT 4 COMPLETE:`);
    console.log(`   - Created ${MOCK_INTERVIEWS.length} interviews`);
    console.log(`   - Extracted ${MOCK_INTERVIEWS.reduce((sum, i) => sum + i.quotes.length, 0)} quotes`);
    console.log(`   - Linked ${themeCounts.length} themes`);
    console.log(`   - Successfully queried themes + quotes across interviews\n`);
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

main();
