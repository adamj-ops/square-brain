/**
 * Tool: guests.upsert_profile
 *
 * Creates or updates a guest and their profile in one operation.
 * This is a write tool - requires allowWrites=true.
 *
 * Pipeline 1: Guest Intelligence
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Input args for guests.upsert_profile
 */
export interface GuestsUpsertProfileArgs {
  // Guest identity (required)
  name: string;
  slug?: string; // Auto-generated from name if not provided
  email?: string;

  // Links
  linkedin_url?: string;
  twitter_url?: string;
  website_url?: string;

  // Status
  status?: 'prospect' | 'researching' | 'outreach' | 'confirmed' | 'interviewed' | 'declined' | 'inactive';
  source?: string;
  source_url?: string;

  // Guest metadata
  tags?: string[];
  metadata?: Record<string, unknown>;

  // Profile fields
  profile?: {
    title?: string;
    company?: string;
    industry?: string;
    years_experience?: number;
    expertise_areas?: string[];
    talking_points?: string[];
    notable_achievements?: string[];
    books?: string[];
    podcasts_appeared?: string[];
    speaking_topics?: string[];
    bio_short?: string;
    bio_long?: string;
    llm_summary?: string;
    audience_size_estimate?: number;
    audience_description?: string;
    social_following?: Record<string, number>;
    fit_score?: number;
    fit_reasoning?: string;
    sources?: Array<{ type: string; url: string; fetched_at?: string }>;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Output from guests.upsert_profile
 */
export interface GuestsUpsertProfileResult {
  guest_id: string;
  profile_id: string | null;
  is_new_guest: boolean;
  is_new_profile: boolean;
}

/**
 * Generate a URL-safe slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): GuestsUpsertProfileArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('Args must be an object');
  }

  const input = args as Record<string, unknown>;

  // Required: name
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('name is required and must be a non-empty string');
  }

  // Validate status if provided
  const validStatuses = ['prospect', 'researching', 'outreach', 'confirmed', 'interviewed', 'declined', 'inactive'];
  if (input.status && !validStatuses.includes(input.status as string)) {
    throw new Error(`status must be one of: ${validStatuses.join(', ')}`);
  }

  // Validate tags if provided
  if (input.tags && (!Array.isArray(input.tags) || !input.tags.every(t => typeof t === 'string'))) {
    throw new Error('tags must be an array of strings');
  }

  // Validate profile if provided
  if (input.profile && typeof input.profile !== 'object') {
    throw new Error('profile must be an object');
  }

  const profile = input.profile as Record<string, unknown> | undefined;

  // Validate profile arrays
  const profileArrayFields = [
    'expertise_areas', 'talking_points', 'notable_achievements',
    'books', 'podcasts_appeared', 'speaking_topics'
  ];

  if (profile) {
    for (const field of profileArrayFields) {
      if (profile[field] && (!Array.isArray(profile[field]) || !(profile[field] as unknown[]).every(t => typeof t === 'string'))) {
        throw new Error(`profile.${field} must be an array of strings`);
      }
    }

    // Validate fit_score range
    if (profile.fit_score !== undefined) {
      const score = Number(profile.fit_score);
      if (isNaN(score) || score < 0 || score > 1) {
        throw new Error('profile.fit_score must be a number between 0 and 1');
      }
    }
  }

  return {
    name: (input.name as string).trim(),
    slug: input.slug ? (input.slug as string).trim() : undefined,
    email: input.email ? (input.email as string).trim() : undefined,
    linkedin_url: input.linkedin_url as string | undefined,
    twitter_url: input.twitter_url as string | undefined,
    website_url: input.website_url as string | undefined,
    status: input.status as GuestsUpsertProfileArgs['status'],
    source: input.source as string | undefined,
    source_url: input.source_url as string | undefined,
    tags: input.tags as string[] | undefined,
    metadata: input.metadata as Record<string, unknown> | undefined,
    profile: profile as GuestsUpsertProfileArgs['profile'],
  };
}

/**
 * Execute the upsert operation
 */
async function run(
  args: GuestsUpsertProfileArgs,
  ctx: ToolContext
): Promise<ToolResponse<GuestsUpsertProfileResult>> {
  const supabase = getServiceSupabase();
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const slug = args.slug || generateSlug(args.name);
  let guestId: string;
  let isNewGuest = false;
  let profileId: string | null = null;
  let isNewProfile = false;

  // Step 1: Upsert guest
  const { data: existingGuest, error: selectError } = await supabase
    .from('guests')
    .select('id')
    .eq('org_id', orgId)
    .eq('slug', slug)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to check existing guest: ${selectError.message}`);
  }

  if (existingGuest) {
    // Update existing guest
    guestId = existingGuest.id;

    const updateData: Record<string, unknown> = {
      name: args.name,
    };

    // Only update fields that are provided
    if (args.email !== undefined) updateData.email = args.email;
    if (args.linkedin_url !== undefined) updateData.linkedin_url = args.linkedin_url;
    if (args.twitter_url !== undefined) updateData.twitter_url = args.twitter_url;
    if (args.website_url !== undefined) updateData.website_url = args.website_url;
    if (args.status !== undefined) updateData.status = args.status;
    if (args.source !== undefined) updateData.source = args.source;
    if (args.source_url !== undefined) updateData.source_url = args.source_url;
    if (args.tags !== undefined) updateData.tags = args.tags;
    if (args.metadata !== undefined) updateData.metadata = args.metadata;

    const { error: updateError } = await supabase
      .from('guests')
      .update(updateData)
      .eq('id', guestId);

    if (updateError) {
      throw new Error(`Failed to update guest: ${updateError.message}`);
    }
  } else {
    // Insert new guest
    isNewGuest = true;

    const { data: newGuest, error: insertError } = await supabase
      .from('guests')
      .insert({
        org_id: orgId,
        name: args.name,
        slug,
        email: args.email || null,
        linkedin_url: args.linkedin_url || null,
        twitter_url: args.twitter_url || null,
        website_url: args.website_url || null,
        status: args.status || 'prospect',
        source: args.source || null,
        source_url: args.source_url || null,
        tags: args.tags || [],
        metadata: args.metadata || {},
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Failed to insert guest: ${insertError.message}`);
    }

    guestId = newGuest.id;
  }

  // Step 2: Upsert profile if provided
  if (args.profile) {
    const { data: existingProfile, error: profileSelectError } = await supabase
      .from('guest_profiles')
      .select('id')
      .eq('guest_id', guestId)
      .maybeSingle();

    if (profileSelectError) {
      throw new Error(`Failed to check existing profile: ${profileSelectError.message}`);
    }

    const profileData: Record<string, unknown> = {
      guest_id: guestId,
      org_id: orgId,
    };

    // Map profile fields
    const profileFields = [
      'title', 'company', 'industry', 'years_experience',
      'expertise_areas', 'talking_points', 'notable_achievements',
      'books', 'podcasts_appeared', 'speaking_topics',
      'bio_short', 'bio_long', 'llm_summary',
      'audience_size_estimate', 'audience_description', 'social_following',
      'fit_score', 'fit_reasoning', 'sources', 'metadata'
    ];

    for (const field of profileFields) {
      const value = (args.profile as Record<string, unknown>)[field];
      if (value !== undefined) {
        profileData[field] = value;
      }
    }

    if (existingProfile) {
      // Update existing profile
      profileId = existingProfile.id;
      profileData.last_enriched_at = new Date().toISOString();

      const { error: profileUpdateError } = await supabase
        .from('guest_profiles')
        .update(profileData)
        .eq('id', profileId);

      if (profileUpdateError) {
        throw new Error(`Failed to update profile: ${profileUpdateError.message}`);
      }
    } else {
      // Insert new profile
      isNewProfile = true;

      const { data: newProfile, error: profileInsertError } = await supabase
        .from('guest_profiles')
        .insert(profileData)
        .select('id')
        .single();

      if (profileInsertError) {
        throw new Error(`Failed to insert profile: ${profileInsertError.message}`);
      }

      profileId = newProfile.id;
    }
  }

  return {
    data: {
      guest_id: guestId,
      profile_id: profileId,
      is_new_guest: isNewGuest,
      is_new_profile: isNewProfile,
    },
    explainability: {
      reason: isNewGuest
        ? 'Created new guest record with profile'
        : 'Updated existing guest record',
      guest_slug: slug,
      org_id: orgId,
      profile_updated: !!args.profile,
      fields_updated: Object.keys(args).filter(k => k !== 'profile' && args[k as keyof GuestsUpsertProfileArgs] !== undefined),
      profile_fields_updated: args.profile ? Object.keys(args.profile) : [],
    },
  };
}

/**
 * Tool definition for guests.upsert_profile
 */
export const guestsUpsertProfileTool: ToolDefinition<
  GuestsUpsertProfileArgs,
  GuestsUpsertProfileResult
> = {
  name: "guests.upsert_profile",
  description:
    "Creates or updates a guest and their profile. " +
    "If a guest with the same slug (or auto-generated from name) exists, updates it. " +
    "Otherwise creates a new guest. Profile data is optional and upserted alongside the guest.",
  writes: true,
  validateArgs,
  run,
};
