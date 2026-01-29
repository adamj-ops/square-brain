-- Migration: 007_guest_intelligence.sql
-- Pipeline 1: Guest Intelligence
--
-- Creates tables for guest tracking, profiles, signals, and scoring.
-- Supports podcast guest research, outreach prioritization, and relationship management.

-- ============================================================================
-- GUESTS TABLE
-- ============================================================================
-- Core table for tracking potential and confirmed podcast guests

CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL,  -- URL-safe identifier
  email TEXT,
  
  -- Social/Professional Links
  linkedin_url TEXT,
  twitter_url TEXT,
  website_url TEXT,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN (
    'prospect',      -- Identified but not contacted
    'researching',   -- Currently gathering intel
    'outreach',      -- In outreach sequence
    'confirmed',     -- Confirmed for interview
    'interviewed',   -- Interview completed
    'declined',      -- Declined to participate
    'inactive'       -- No longer pursuing
  )),
  
  -- Source tracking
  source TEXT,           -- How we found them (referral, search, event, etc.)
  source_url TEXT,       -- Original source URL
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT guests_org_slug_unique UNIQUE (org_id, slug),
  CONSTRAINT guests_org_email_unique UNIQUE (org_id, email)
);

-- ============================================================================
-- GUEST_PROFILES TABLE
-- ============================================================================
-- Extended profile information extracted and compiled from various sources

CREATE TABLE IF NOT EXISTS guest_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,  -- Denormalized for faster queries
  
  -- Professional Info
  title TEXT,            -- Current job title
  company TEXT,          -- Current company
  industry TEXT,         -- Industry sector
  years_experience INTEGER,
  
  -- Expertise & Topics
  expertise_areas TEXT[] DEFAULT '{}',      -- Areas of expertise
  talking_points TEXT[] DEFAULT '{}',       -- Potential interview topics
  notable_achievements TEXT[] DEFAULT '{}', -- Key accomplishments
  
  -- Content & Presence
  books TEXT[] DEFAULT '{}',          -- Authored books
  podcasts_appeared TEXT[] DEFAULT '{}',  -- Previous podcast appearances
  speaking_topics TEXT[] DEFAULT '{}',    -- Conference talk topics
  
  -- Bio & Summary
  bio_short TEXT,        -- 1-2 sentence bio
  bio_long TEXT,         -- Full biography
  llm_summary TEXT,      -- AI-generated summary
  
  -- Audience & Reach
  audience_size_estimate INTEGER,
  audience_description TEXT,
  social_following JSONB DEFAULT '{}',  -- { twitter: 10000, linkedin: 5000, etc. }
  
  -- Fit Assessment
  fit_score NUMERIC(3,2) DEFAULT 0.5,  -- 0-1, how well they fit our audience
  fit_reasoning TEXT,                   -- Why this score
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  sources JSONB DEFAULT '[]',  -- Array of { type, url, fetched_at }
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_enriched_at TIMESTAMPTZ,
  
  -- One profile per guest
  CONSTRAINT guest_profiles_guest_unique UNIQUE (guest_id)
);

-- ============================================================================
-- GUEST_SIGNALS TABLE
-- ============================================================================
-- Individual signals/data points extracted about guests

CREATE TABLE IF NOT EXISTS guest_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,  -- Denormalized for faster queries
  
  -- Signal classification
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'expertise',         -- Demonstrated expertise in a topic
    'achievement',       -- Notable accomplishment
    'mention',           -- Mentioned in media/content
    'appearance',        -- Podcast/speaking appearance
    'publication',       -- Book, article, paper
    'social_activity',   -- Notable social media activity
    'connection',        -- Connection to our network
    'trigger_event',     -- Recent news/event about them
    'sentiment',         -- Sentiment from their content
    'custom'             -- Other signal types
  )),
  
  -- Signal content
  title TEXT NOT NULL,       -- Brief title/description
  description TEXT,          -- Full description
  value TEXT,                -- The actual signal value/data
  
  -- Strength & Confidence
  strength NUMERIC(3,2) DEFAULT 0.5,    -- 0-1, how strong this signal is
  confidence NUMERIC(3,2) DEFAULT 0.5,  -- 0-1, how confident we are in this data
  
  -- Source tracking
  source_type TEXT,      -- 'scraped', 'manual', 'llm_extracted', 'api'
  source_url TEXT,
  source_content_id UUID,  -- Reference to ai_docs/ai_chunks if applicable
  
  -- Timing
  signal_date TIMESTAMPTZ,  -- When the signal occurred (if known)
  expires_at TIMESTAMPTZ,   -- When this signal becomes stale
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent exact duplicate signals
  CONSTRAINT guest_signals_unique UNIQUE (guest_id, signal_type, title, value)
);

-- ============================================================================
-- GUEST_SCORES TABLE
-- ============================================================================
-- Computed scores for guests with full explainability

CREATE TABLE IF NOT EXISTS guest_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,  -- Denormalized for faster queries
  
  -- Score identity
  score_type TEXT NOT NULL DEFAULT 'overall' CHECK (score_type IN (
    'overall',           -- Overall fit score
    'expertise',         -- Expertise relevance score
    'reach',             -- Audience reach score
    'timeliness',        -- How timely/relevant now
    'accessibility',     -- Likelihood to respond/accept
    'custom'             -- Custom scoring dimension
  )),
  
  -- Score value
  score NUMERIC(5,2) NOT NULL,  -- The actual score (0-100)
  
  -- Explainability
  factors JSONB NOT NULL DEFAULT '[]',  -- Array of { factor, weight, value, contribution }
  reasoning TEXT,                        -- Human-readable explanation
  
  -- Versioning
  rules_version TEXT NOT NULL,  -- Version of scoring rules used
  model_version TEXT,           -- LLM model if used
  
  -- Validity
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,  -- When this score should be recomputed
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- One score per type per guest (latest wins)
  CONSTRAINT guest_scores_unique UNIQUE (guest_id, score_type)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Guests indexes
CREATE INDEX IF NOT EXISTS idx_guests_org_id ON guests(org_id);
CREATE INDEX IF NOT EXISTS idx_guests_org_status ON guests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_guests_slug ON guests(slug);
CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guests_tags ON guests USING GIN (tags);

-- Guest profiles indexes
CREATE INDEX IF NOT EXISTS idx_guest_profiles_guest_id ON guest_profiles(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_org_id ON guest_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_expertise ON guest_profiles USING GIN (expertise_areas);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_fit_score ON guest_profiles(fit_score DESC);

-- Guest signals indexes
CREATE INDEX IF NOT EXISTS idx_guest_signals_guest_id ON guest_signals(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_signals_org_id ON guest_signals(org_id);
CREATE INDEX IF NOT EXISTS idx_guest_signals_type ON guest_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_guest_signals_date ON guest_signals(signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_guest_signals_strength ON guest_signals(strength DESC);

-- Guest scores indexes
CREATE INDEX IF NOT EXISTS idx_guest_scores_guest_id ON guest_scores(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_scores_org_id ON guest_scores(org_id);
CREATE INDEX IF NOT EXISTS idx_guest_scores_type_score ON guest_scores(score_type, score DESC);
CREATE INDEX IF NOT EXISTS idx_guest_scores_computed ON guest_scores(computed_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update guests.updated_at on change
CREATE OR REPLACE FUNCTION update_guests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guests_updated_at ON guests;
CREATE TRIGGER guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW
  EXECUTE FUNCTION update_guests_updated_at();

-- Update guest_profiles.updated_at on change
CREATE OR REPLACE FUNCTION update_guest_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guest_profiles_updated_at ON guest_profiles;
CREATE TRIGGER guest_profiles_updated_at
  BEFORE UPDATE ON guest_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_guest_profiles_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Upsert a guest by slug (idempotent)
CREATE OR REPLACE FUNCTION upsert_guest(
  p_org_id TEXT,
  p_name TEXT,
  p_slug TEXT,
  p_email TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'prospect',
  p_source TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_guest_id UUID;
BEGIN
  INSERT INTO guests (org_id, name, slug, email, status, source, metadata)
  VALUES (p_org_id, p_name, p_slug, p_email, p_status, p_source, p_metadata)
  ON CONFLICT (org_id, slug) DO UPDATE
  SET name = EXCLUDED.name,
      email = COALESCE(EXCLUDED.email, guests.email),
      status = EXCLUDED.status,
      source = COALESCE(EXCLUDED.source, guests.source),
      metadata = guests.metadata || EXCLUDED.metadata
  RETURNING id INTO v_guest_id;
  
  RETURN v_guest_id;
END;
$$;

-- Get guest with latest scores
CREATE OR REPLACE FUNCTION get_guest_with_scores(
  p_org_id TEXT,
  p_guest_id UUID
)
RETURNS TABLE (
  guest_id UUID,
  name TEXT,
  email TEXT,
  status TEXT,
  overall_score NUMERIC,
  expertise_score NUMERIC,
  reach_score NUMERIC,
  timeliness_score NUMERIC,
  accessibility_score NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.id AS guest_id,
    g.name,
    g.email,
    g.status,
    (SELECT score FROM guest_scores WHERE guest_id = g.id AND score_type = 'overall') AS overall_score,
    (SELECT score FROM guest_scores WHERE guest_id = g.id AND score_type = 'expertise') AS expertise_score,
    (SELECT score FROM guest_scores WHERE guest_id = g.id AND score_type = 'reach') AS reach_score,
    (SELECT score FROM guest_scores WHERE guest_id = g.id AND score_type = 'timeliness') AS timeliness_score,
    (SELECT score FROM guest_scores WHERE guest_id = g.id AND score_type = 'accessibility') AS accessibility_score
  FROM guests g
  WHERE g.org_id = p_org_id AND g.id = p_guest_id;
END;
$$;

-- Rank guests by score type
CREATE OR REPLACE FUNCTION rank_guests_by_score(
  p_org_id TEXT,
  p_score_type TEXT DEFAULT 'overall',
  p_limit INT DEFAULT 10,
  p_status_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  guest_id UUID,
  name TEXT,
  email TEXT,
  status TEXT,
  score NUMERIC,
  reasoning TEXT,
  rank BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.id AS guest_id,
    g.name,
    g.email,
    g.status,
    gs.score,
    gs.reasoning,
    ROW_NUMBER() OVER (ORDER BY gs.score DESC) AS rank
  FROM guests g
  JOIN guest_scores gs ON gs.guest_id = g.id AND gs.score_type = p_score_type
  WHERE g.org_id = p_org_id
    AND (p_status_filter IS NULL OR g.status = ANY(p_status_filter))
  ORDER BY gs.score DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE guests IS 'Core guest tracking for Pipeline 1: Guest Intelligence';
COMMENT ON TABLE guest_profiles IS 'Extended profile data enriched from multiple sources';
COMMENT ON TABLE guest_signals IS 'Individual data points/signals extracted about guests';
COMMENT ON TABLE guest_scores IS 'Computed scores with full explainability';

COMMENT ON COLUMN guests.status IS 'Guest lifecycle: prospect → researching → outreach → confirmed → interviewed';
COMMENT ON COLUMN guest_scores.factors IS 'Array of scoring factors: { factor, weight, value, contribution }';
COMMENT ON COLUMN guest_scores.rules_version IS 'Version identifier for scoring rules (for reproducibility)';
