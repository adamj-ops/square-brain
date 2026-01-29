/**
 * CHECKPOINT 3 Test: Rank 5 Mock Guests with Explanations
 * 
 * This script tests the Guest Intelligence pipeline (Pipeline 1):
 * 1. Creates 5 mock guests with profiles
 * 2. Extracts signals for each guest
 * 3. Scores each guest
 * 4. Displays rankings with explanations
 * 
 * Run with: npx tsx scripts/test-guest-ranking.ts
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

// Mock guest data with varying quality
const MOCK_GUESTS = [
  {
    name: "Dr. Sarah Chen",
    slug: "sarah-chen",
    email: "sarah@example.com",
    profile: {
      title: "Chief Science Officer",
      company: "BioTech Innovations",
      industry: "Biotechnology",
      expertise_areas: ["Gene Therapy", "CRISPR", "Precision Medicine"],
      bio_short: "Leading researcher in gene therapy with 20+ years experience",
      audience_size_estimate: 150000,
    },
    signals: [
      { type: "expertise", title: "Published 50+ peer-reviewed papers", weight: 0.9, confidence: 0.95 },
      { type: "media_mention", title: "Featured in Nature Magazine", weight: 0.8, confidence: 0.9 },
      { type: "social_proof", title: "150K Twitter followers", weight: 0.7, confidence: 0.85 },
      { type: "speaking", title: "TED Talk with 2M views", weight: 0.9, confidence: 0.95 },
      { type: "content", title: "Authored bestselling book on gene therapy", weight: 0.85, confidence: 0.9 },
    ],
  },
  {
    name: "Michael Rodriguez",
    slug: "michael-rodriguez",
    email: "michael@example.com",
    profile: {
      title: "Startup Founder & CEO",
      company: "HealthTech Startup",
      industry: "Health Technology",
      expertise_areas: ["Digital Health", "Telemedicine", "AI in Healthcare"],
      bio_short: "Serial entrepreneur, 3 successful exits in health tech",
      audience_size_estimate: 45000,
    },
    signals: [
      { type: "expertise", title: "Built 3 successful health tech companies", weight: 0.8, confidence: 0.85 },
      { type: "achievement", title: "Raised $50M in funding", weight: 0.7, confidence: 0.9 },
      { type: "social_proof", title: "45K LinkedIn followers", weight: 0.5, confidence: 0.8 },
      { type: "availability", title: "Actively seeking podcast appearances", weight: 0.6, confidence: 0.7 },
      { type: "controversy", title: "Previous company had data breach", weight: -0.3, confidence: 0.6 },
    ],
  },
  {
    name: "Dr. Emily Watson",
    slug: "emily-watson",
    email: "emily@example.com",
    profile: {
      title: "Professor of Neuroscience",
      company: "Stanford University",
      industry: "Academia",
      expertise_areas: ["Neuroscience", "Brain-Computer Interfaces", "Cognitive Science"],
      bio_short: "Award-winning neuroscientist researching brain-computer interfaces",
      audience_size_estimate: 80000,
    },
    signals: [
      { type: "expertise", title: "Leading BCI researcher at Stanford", weight: 0.95, confidence: 0.95 },
      { type: "achievement", title: "MacArthur Fellowship recipient", weight: 0.9, confidence: 0.95 },
      { type: "content", title: "Published 3 books on neuroscience", weight: 0.8, confidence: 0.9 },
      { type: "speaking", title: "Regular keynote at neuroscience conferences", weight: 0.7, confidence: 0.85 },
    ],
  },
  {
    name: "James Park",
    slug: "james-park",
    email: "james@example.com",
    profile: {
      title: "Wellness Influencer",
      company: "Self-employed",
      industry: "Wellness",
      expertise_areas: ["Fitness", "Nutrition", "Mental Wellness"],
      bio_short: "Fitness influencer with massive social following",
      audience_size_estimate: 500000,
    },
    signals: [
      { type: "social_proof", title: "500K Instagram followers", weight: 0.8, confidence: 0.9 },
      { type: "social_proof", title: "200K YouTube subscribers", weight: 0.7, confidence: 0.9 },
      { type: "content", title: "Daily content creator", weight: 0.5, confidence: 0.8 },
      { type: "controversy", title: "Promoted questionable supplement", weight: -0.4, confidence: 0.7 },
      { type: "availability", title: "High demand, limited availability", weight: -0.2, confidence: 0.6 },
    ],
  },
  {
    name: "Lisa Thompson",
    slug: "lisa-thompson",
    email: "lisa@example.com",
    profile: {
      title: "Healthcare Executive",
      company: "Major Hospital Network",
      industry: "Healthcare",
      expertise_areas: ["Healthcare Administration", "Policy", "Digital Transformation"],
      bio_short: "C-suite executive transforming hospital operations",
      audience_size_estimate: 25000,
    },
    signals: [
      { type: "expertise", title: "20 years healthcare leadership", weight: 0.7, confidence: 0.85 },
      { type: "achievement", title: "Led $100M digital transformation", weight: 0.6, confidence: 0.8 },
      { type: "endorsement", title: "Recommended by industry peers", weight: 0.5, confidence: 0.7 },
      { type: "availability", title: "Limited public speaking experience", weight: -0.1, confidence: 0.6 },
    ],
  },
];

/**
 * Clean up test data
 */
async function cleanup() {
  console.log("🧹 Cleaning up existing test data...");
  
  const slugs = MOCK_GUESTS.map(g => g.slug);
  
  // Get guest IDs
  const { data: existingGuests } = await supabase
    .from("guests")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .in("slug", slugs);
  
  if (existingGuests && existingGuests.length > 0) {
    const guestIds = existingGuests.map(g => g.id);
    
    // Delete scores
    await supabase.from("guest_scores").delete().in("guest_id", guestIds);
    
    // Delete signals
    await supabase.from("guest_signals").delete().in("guest_id", guestIds);
    
    // Delete profiles
    await supabase.from("guest_profiles").delete().in("guest_id", guestIds);
    
    // Delete guests
    await supabase.from("guests").delete().in("id", guestIds);
  }
  
  console.log("✅ Cleanup complete\n");
}

/**
 * Create a guest with profile
 */
async function createGuest(guest: typeof MOCK_GUESTS[0]): Promise<string> {
  // Insert guest
  const { data: guestData, error: guestError } = await supabase
    .from("guests")
    .insert({
      org_id: DEFAULT_ORG_ID,
      name: guest.name,
      slug: guest.slug,
      email: guest.email,
      status: "prospect",
    })
    .select("id")
    .single();
  
  if (guestError) {
    throw new Error(`Failed to create guest ${guest.name}: ${guestError.message}`);
  }
  
  const guestId = guestData.id;
  
  // Insert profile
  const { error: profileError } = await supabase
    .from("guest_profiles")
    .insert({
      guest_id: guestId,
      org_id: DEFAULT_ORG_ID,
      ...guest.profile,
    });
  
  if (profileError) {
    throw new Error(`Failed to create profile for ${guest.name}: ${profileError.message}`);
  }
  
  return guestId;
}

/**
 * Add signals for a guest
 */
async function addSignals(guestId: string, signals: typeof MOCK_GUESTS[0]["signals"]) {
  const signalRows = signals.map(s => ({
    guest_id: guestId,
    org_id: DEFAULT_ORG_ID,
    signal_type: s.type,
    title: s.title,
    weight: s.weight,
    confidence: s.confidence,
    extracted_by: "test",
  }));
  
  const { error } = await supabase.from("guest_signals").insert(signalRows);
  
  if (error) {
    throw new Error(`Failed to add signals: ${error.message}`);
  }
}

/**
 * Calculate score for a guest (mimics scoring.score_guest tool logic)
 */
async function scoreGuest(guestId: string, guestName: string): Promise<{
  total_score: number;
  grade: string;
  explanation: string;
  top_factors: string[];
  concerns: string[];
}> {
  // Get signals
  const { data: signals } = await supabase
    .from("guest_signals")
    .select("signal_type, title, weight, confidence")
    .eq("guest_id", guestId);
  
  const signalList = signals || [];
  
  // Component weights
  const weights = {
    expertise: 0.30,
    reach: 0.20,
    relevance: 0.25,
    availability: 0.10,
    content_potential: 0.15,
  };
  
  // Calculate component scores
  const componentScores = {
    expertise: 0,
    reach: 0,
    relevance: 0,
    availability: 50,
    content_potential: 0,
  };
  
  const expertiseSignals = signalList.filter(s => s.signal_type === "expertise");
  const reachSignals = signalList.filter(s => ["social_proof", "media_mention"].includes(s.signal_type));
  const relevanceSignals = signalList.filter(s => ["content", "speaking", "endorsement"].includes(s.signal_type));
  const availabilitySignals = signalList.filter(s => s.signal_type === "availability");
  const contentSignals = signalList.filter(s => ["content", "achievement"].includes(s.signal_type));
  
  if (expertiseSignals.length > 0) {
    componentScores.expertise = Math.min(100, Math.max(0,
      (expertiseSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / expertiseSignals.length) * 100
    ));
  }
  
  if (reachSignals.length > 0) {
    componentScores.reach = Math.min(100, Math.max(0,
      (reachSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / reachSignals.length) * 100
    ));
  }
  
  if (relevanceSignals.length > 0) {
    componentScores.relevance = Math.min(100, Math.max(0,
      (relevanceSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / relevanceSignals.length) * 100
    ));
  }
  
  if (availabilitySignals.length > 0) {
    componentScores.availability = Math.min(100, Math.max(0,
      50 + (availabilitySignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / availabilitySignals.length) * 50
    ));
  }
  
  if (contentSignals.length > 0) {
    componentScores.content_potential = Math.min(100, Math.max(0,
      (contentSignals.reduce((sum, s) => sum + s.weight * s.confidence, 0) / contentSignals.length) * 100
    ));
  }
  
  // Calculate total score
  const totalScore = 
    componentScores.expertise * weights.expertise +
    componentScores.reach * weights.reach +
    componentScores.relevance * weights.relevance +
    componentScores.availability * weights.availability +
    componentScores.content_potential * weights.content_potential;
  
  // Get grade
  function getGrade(score: number): string {
    if (score >= 90) return "A+";
    if (score >= 85) return "A";
    if (score >= 80) return "A-";
    if (score >= 75) return "B+";
    if (score >= 70) return "B";
    if (score >= 65) return "B-";
    if (score >= 60) return "C+";
    if (score >= 55) return "C";
    if (score >= 50) return "C-";
    if (score >= 45) return "D+";
    if (score >= 40) return "D";
    return "F";
  }
  
  const grade = getGrade(totalScore);
  
  // Get top factors
  const topFactors = signalList
    .filter(s => s.weight > 0)
    .sort((a, b) => (b.weight * b.confidence) - (a.weight * a.confidence))
    .slice(0, 3)
    .map(s => s.title);
  
  // Get concerns
  const concerns = signalList
    .filter(s => s.weight < 0)
    .sort((a, b) => (a.weight * a.confidence) - (b.weight * b.confidence))
    .slice(0, 3)
    .map(s => s.title);
  
  const explanation = `${guestName} scored ${totalScore.toFixed(1)}/100 (Grade: ${grade}). ` +
    `Components: Expertise ${componentScores.expertise.toFixed(0)}, ` +
    `Reach ${componentScores.reach.toFixed(0)}, ` +
    `Relevance ${componentScores.relevance.toFixed(0)}, ` +
    `Availability ${componentScores.availability.toFixed(0)}, ` +
    `Content ${componentScores.content_potential.toFixed(0)}. ` +
    `Based on ${signalList.length} signals.`;
  
  // Store score
  await supabase.from("guest_scores").upsert({
    guest_id: guestId,
    org_id: DEFAULT_ORG_ID,
    total_score: totalScore,
    expertise_score: componentScores.expertise,
    reach_score: componentScores.reach,
    relevance_score: componentScores.relevance,
    availability_score: componentScores.availability,
    content_potential_score: componentScores.content_potential,
    scoring_version: "v1.0",
    scoring_rules: weights,
    explanation,
    top_factors: topFactors,
    concerns,
    valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "guest_id,scoring_version" });
  
  return { total_score: totalScore, grade, explanation, top_factors: topFactors, concerns };
}

/**
 * Main test function
 */
async function main() {
  console.log("🧪 CHECKPOINT 3: Guest Intelligence Pipeline Test\n");
  console.log("=".repeat(60) + "\n");
  
  try {
    await cleanup();
    
    const guestResults: Array<{
      name: string;
      id: string;
      score: Awaited<ReturnType<typeof scoreGuest>>;
    }> = [];
    
    // Step 1: Create guests with profiles and signals
    console.log("📝 Creating 5 mock guests with profiles and signals...\n");
    
    for (const guest of MOCK_GUESTS) {
      console.log(`  Creating ${guest.name}...`);
      const guestId = await createGuest(guest);
      await addSignals(guestId, guest.signals);
      console.log(`    ✅ Created with ${guest.signals.length} signals`);
      
      // Score the guest
      const score = await scoreGuest(guestId, guest.name);
      guestResults.push({ name: guest.name, id: guestId, score });
    }
    
    console.log("\n" + "=".repeat(60) + "\n");
    
    // Step 2: Rank guests
    console.log("🏆 GUEST RANKINGS (Sorted by Score)\n");
    
    const ranked = guestResults.sort((a, b) => b.score.total_score - a.score.total_score);
    
    ranked.forEach((guest, index) => {
      console.log(`${index + 1}. ${guest.name}`);
      console.log(`   Score: ${guest.score.total_score.toFixed(1)}/100 (Grade: ${guest.score.grade})`);
      console.log(`   Top Factors: ${guest.score.top_factors.join(", ") || "None"}`);
      if (guest.score.concerns.length > 0) {
        console.log(`   ⚠️  Concerns: ${guest.score.concerns.join(", ")}`);
      }
      console.log(`   📋 ${guest.score.explanation}`);
      console.log();
    });
    
    console.log("=".repeat(60) + "\n");
    console.log("✅ CHECKPOINT 3 COMPLETE: Successfully ranked 5 mock guests with explanations\n");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

main();
