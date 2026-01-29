-- Migration: 008_interviews.sql
-- Pipeline 2: Interview Intelligence
--
-- Creates tables for interview management and quote extraction.
-- Links to existing themes table from migration 006.

-- ============================================
-- INTERVIEWS TABLE (Core interview records)
-- ============================================
CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Guest reference (optional - interviews can exist without guest record)
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  
  -- Interview identity
  title TEXT NOT NULL,
  slug TEXT NOT NULL, -- URL-safe identifier
  
  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft',        -- Being prepared
    'scheduled',    -- Date confirmed
    'recorded',     -- Recording complete
    'processing',   -- Being transcribed/analyzed
    'published',    -- Published
    'archived'      -- No longer active
  )),
  
  -- Dates
  scheduled_date DATE,
  recorded_date DATE,
  published_date DATE,
  
  -- Content references
  transcript_doc_id UUID REFERENCES ai_docs(id), -- Link to RAG document
  audio_url TEXT,
  video_url TEXT,
  published_url TEXT,
  
  -- Interview metadata
  duration_minutes INTEGER,
  episode_number INTEGER,
  season_number INTEGER,
  
  -- Summary and notes
  summary TEXT,
  key_topics TEXT[],
  notes TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT interviews_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================
-- INTERVIEW_QUOTES TABLE (Extracted quotes)
-- ============================================
CREATE TABLE IF NOT EXISTS interview_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  
  -- Quote content
  quote_text TEXT NOT NULL,
  speaker TEXT, -- Who said it (guest name, host, etc.)
  context TEXT, -- Surrounding context
  
  -- Position in interview
  timestamp_start INTEGER, -- Seconds from start
  timestamp_end INTEGER,
  chunk_index INTEGER, -- Reference to transcript chunk
  
  -- Classification
  quote_type TEXT DEFAULT 'general' CHECK (quote_type IN (
    'insight',      -- Key insight or learning
    'story',        -- Personal story or anecdote
    'advice',       -- Actionable advice
    'controversial', -- Provocative or debate-worthy
    'quotable',     -- Good for social media
    'technical',    -- Technical explanation
    'general'
  )),
  
  -- Quality metrics
  impact_score NUMERIC(3,2) DEFAULT 0.5, -- 0-1, how impactful/memorable
  shareability_score NUMERIC(3,2) DEFAULT 0.5, -- 0-1, social media potential
  
  -- Usage tracking
  times_used INTEGER DEFAULT 0, -- How many times used in content
  last_used_at TIMESTAMPTZ,
  
  -- Extraction metadata
  extracted_by TEXT DEFAULT 'manual', -- 'manual', 'ai', 'transcription'
  extraction_confidence NUMERIC(3,2) DEFAULT 0.8,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INTERVIEW_THEMES TABLE (Link interviews to themes)
-- ============================================
CREATE TABLE IF NOT EXISTS interview_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  
  -- Relevance
  relevance_score NUMERIC(3,2) DEFAULT 0.5, -- 0-1
  is_primary BOOLEAN DEFAULT false, -- Is this a primary theme of the interview?
  
  -- Evidence
  evidence_count INTEGER DEFAULT 0, -- Number of quotes supporting this theme
  
  -- Detection metadata
  detected_by TEXT DEFAULT 'manual', -- 'manual', 'scanner', 'ai'
  detection_metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicates
  CONSTRAINT interview_themes_unique UNIQUE (interview_id, theme_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- Interviews
CREATE INDEX IF NOT EXISTS idx_interviews_org_id ON interviews(org_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(org_id, status);
CREATE INDEX IF NOT EXISTS idx_interviews_guest_id ON interviews(guest_id);
CREATE INDEX IF NOT EXISTS idx_interviews_published_date ON interviews(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_key_topics ON interviews USING GIN(key_topics);

-- Interview quotes
CREATE INDEX IF NOT EXISTS idx_interview_quotes_interview_id ON interview_quotes(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_org_id ON interview_quotes(org_id);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_type ON interview_quotes(quote_type);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_impact ON interview_quotes(impact_score DESC);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_shareability ON interview_quotes(shareability_score DESC);

-- Interview themes
CREATE INDEX IF NOT EXISTS idx_interview_themes_interview_id ON interview_themes(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_themes_theme_id ON interview_themes(theme_id);
CREATE INDEX IF NOT EXISTS idx_interview_themes_org_id ON interview_themes(org_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update interviews.updated_at on change
CREATE OR REPLACE FUNCTION update_interviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interviews_updated_at ON interviews;
CREATE TRIGGER interviews_updated_at
  BEFORE UPDATE ON interviews
  FOR EACH ROW
  EXECUTE FUNCTION update_interviews_updated_at();

-- Update theme evidence count when interview_themes changes
CREATE OR REPLACE FUNCTION update_interview_theme_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Count quotes for this interview that relate to this theme
    UPDATE interview_themes
    SET evidence_count = (
      SELECT COUNT(*) FROM interview_quotes
      WHERE interview_id = NEW.interview_id
    )
    WHERE id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_themes_evidence ON interview_themes;
CREATE TRIGGER interview_themes_evidence
  AFTER INSERT ON interview_themes
  FOR EACH ROW
  EXECUTE FUNCTION update_interview_theme_evidence();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get or create an interview by title/slug
CREATE OR REPLACE FUNCTION get_or_create_interview(
  p_org_id TEXT,
  p_title TEXT,
  p_slug TEXT DEFAULT NULL,
  p_guest_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_interview_id UUID;
  v_slug TEXT;
BEGIN
  -- Generate slug if not provided
  v_slug := COALESCE(p_slug, LOWER(REGEXP_REPLACE(p_title, '[^a-zA-Z0-9]+', '-', 'g')));
  
  -- Try to find existing interview by slug
  SELECT id INTO v_interview_id
  FROM interviews
  WHERE org_id = p_org_id AND slug = v_slug;
  
  IF v_interview_id IS NOT NULL THEN
    RETURN v_interview_id;
  END IF;
  
  -- Create new interview
  INSERT INTO interviews (org_id, title, slug, guest_id)
  VALUES (p_org_id, p_title, v_slug, p_guest_id)
  RETURNING id INTO v_interview_id;
  
  RETURN v_interview_id;
END;
$$;

-- Add a quote to an interview
CREATE OR REPLACE FUNCTION add_interview_quote(
  p_interview_id UUID,
  p_org_id TEXT,
  p_quote_text TEXT,
  p_speaker TEXT DEFAULT NULL,
  p_quote_type TEXT DEFAULT 'general',
  p_impact_score NUMERIC DEFAULT 0.5,
  p_shareability_score NUMERIC DEFAULT 0.5,
  p_timestamp_start INTEGER DEFAULT NULL,
  p_context TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_quote_id UUID;
BEGIN
  INSERT INTO interview_quotes (
    interview_id, org_id, quote_text, speaker,
    quote_type, impact_score, shareability_score,
    timestamp_start, context, extracted_by
  )
  VALUES (
    p_interview_id, p_org_id, p_quote_text, p_speaker,
    p_quote_type, p_impact_score, p_shareability_score,
    p_timestamp_start, p_context, 'ai'
  )
  RETURNING id INTO v_quote_id;
  
  RETURN v_quote_id;
END;
$$;

-- Link interview to theme
CREATE OR REPLACE FUNCTION link_interview_to_theme(
  p_interview_id UUID,
  p_theme_id UUID,
  p_org_id TEXT,
  p_relevance_score NUMERIC DEFAULT 0.5,
  p_is_primary BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_link_id UUID;
BEGIN
  INSERT INTO interview_themes (
    interview_id, theme_id, org_id,
    relevance_score, is_primary, detected_by
  )
  VALUES (
    p_interview_id, p_theme_id, p_org_id,
    p_relevance_score, p_is_primary, 'ai'
  )
  ON CONFLICT (interview_id, theme_id) DO UPDATE
  SET relevance_score = EXCLUDED.relevance_score,
      is_primary = EXCLUDED.is_primary
  RETURNING id INTO v_link_id;
  
  RETURN v_link_id;
END;
$$;
