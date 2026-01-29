-- Migration: 008_interview_intelligence.sql
-- Pipeline 2: Interview Intelligence
--
-- Creates tables for interview tracking, quotes extraction, and theme linking.
-- Supports interview analysis, content repurposing, and knowledge extraction.

-- ============================================================================
-- INTERVIEWS TABLE
-- ============================================================================
-- Core table for tracking podcast interviews

CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Guest reference (optional - can track interviews without a guest record)
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  
  -- Interview identity
  title TEXT NOT NULL,
  slug TEXT NOT NULL,  -- URL-safe identifier
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled',    -- Interview is scheduled
    'recorded',     -- Recording complete, pending processing
    'transcribed',  -- Transcript available
    'analyzed',     -- Quotes/themes extracted
    'published',    -- Content published
    'archived'      -- No longer active
  )),
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  
  -- Content
  transcript_url TEXT,       -- Link to transcript file
  recording_url TEXT,        -- Link to recording
  transcript_text TEXT,      -- Full transcript (for search/analysis)
  
  -- Episode info (if published)
  episode_number INTEGER,
  episode_title TEXT,
  episode_url TEXT,
  published_at TIMESTAMPTZ,
  
  -- Analysis metadata
  key_topics TEXT[] DEFAULT '{}',     -- Main topics discussed
  expertise_tags TEXT[] DEFAULT '{}', -- Expertise demonstrated
  sentiment_summary TEXT,             -- Overall sentiment analysis
  
  -- AI-generated content
  summary TEXT,              -- LLM-generated summary
  highlights TEXT[] DEFAULT '{}',  -- Key highlights/moments
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  analyzed_at TIMESTAMPTZ,  -- When quotes/themes were extracted
  
  -- Constraints
  CONSTRAINT interviews_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================================================
-- INTERVIEW_QUOTES TABLE
-- ============================================================================
-- Notable quotes extracted from interviews for content repurposing

CREATE TABLE IF NOT EXISTS interview_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,  -- Denormalized for faster queries
  
  -- Quote content
  quote_text TEXT NOT NULL,       -- The actual quote
  speaker TEXT NOT NULL,          -- Who said it (guest name, host, etc.)
  speaker_type TEXT NOT NULL DEFAULT 'guest' CHECK (speaker_type IN ('guest', 'host', 'other')),
  
  -- Context
  context TEXT,                   -- Surrounding context
  timestamp_start INTEGER,        -- Start time in seconds (if available)
  timestamp_end INTEGER,          -- End time in seconds
  
  -- Classification
  quote_type TEXT NOT NULL DEFAULT 'insight' CHECK (quote_type IN (
    'insight',      -- Valuable insight/wisdom
    'story',        -- Personal story/anecdote
    'tip',          -- Actionable tip/advice
    'opinion',      -- Strong opinion/stance
    'data',         -- Statistics/data point
    'question',     -- Great question asked
    'humor',        -- Funny moment
    'controversy',  -- Controversial statement
    'soundbite',    -- Great for social media
    'other'
  )),
  
  -- Quality metrics
  impact_score NUMERIC(3,2) DEFAULT 0.5,    -- 0-1, how impactful
  shareability_score NUMERIC(3,2) DEFAULT 0.5,  -- 0-1, how shareable
  is_featured BOOLEAN DEFAULT FALSE,         -- Featured quote
  
  -- Repurposing status
  repurposed_count INTEGER DEFAULT 0,        -- Times used in content
  repurposed_as JSONB DEFAULT '[]',          -- Array of { type, url, created_at }
  
  -- Extraction metadata
  extracted_by TEXT DEFAULT 'manual',        -- 'manual', 'ai', 'transcript'
  extraction_metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INTERVIEW_THEMES TABLE
-- ============================================================================
-- Links interviews to themes with interview-specific metadata

CREATE TABLE IF NOT EXISTS interview_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- References
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  
  -- Interview-specific context
  relevance_score NUMERIC(3,2) DEFAULT 0.5,  -- 0-1, how central to this interview
  discussion_depth TEXT DEFAULT 'mentioned' CHECK (discussion_depth IN (
    'mentioned',     -- Briefly mentioned
    'discussed',     -- Substantively discussed
    'deep_dive',     -- Major focus of interview
    'expert_insight' -- Guest provided expert-level insight
  )),
  
  -- Evidence
  supporting_quotes UUID[] DEFAULT '{}',  -- References to interview_quotes.id
  excerpt TEXT,                           -- Key excerpt about this theme
  
  -- Time in interview
  first_mentioned_at INTEGER,    -- Timestamp in seconds
  total_duration_seconds INTEGER, -- Total time spent on theme
  
  -- Detection metadata
  detected_by TEXT DEFAULT 'scanner',  -- 'scanner', 'manual', 'agent'
  detection_metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate links
  CONSTRAINT interview_themes_unique UNIQUE (interview_id, theme_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Interviews indexes
CREATE INDEX IF NOT EXISTS idx_interviews_org_id ON interviews(org_id);
CREATE INDEX IF NOT EXISTS idx_interviews_org_status ON interviews(org_id, status);
CREATE INDEX IF NOT EXISTS idx_interviews_slug ON interviews(slug);
CREATE INDEX IF NOT EXISTS idx_interviews_guest_id ON interviews(guest_id);
CREATE INDEX IF NOT EXISTS idx_interviews_scheduled_at ON interviews(scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_recorded_at ON interviews(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_published_at ON interviews(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_key_topics ON interviews USING GIN (key_topics);
CREATE INDEX IF NOT EXISTS idx_interviews_expertise_tags ON interviews USING GIN (expertise_tags);
CREATE INDEX IF NOT EXISTS idx_interviews_tags ON interviews USING GIN (tags);

-- Interview quotes indexes
CREATE INDEX IF NOT EXISTS idx_interview_quotes_interview_id ON interview_quotes(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_org_id ON interview_quotes(org_id);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_speaker_type ON interview_quotes(speaker_type);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_quote_type ON interview_quotes(quote_type);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_impact ON interview_quotes(impact_score DESC);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_shareability ON interview_quotes(shareability_score DESC);
CREATE INDEX IF NOT EXISTS idx_interview_quotes_featured ON interview_quotes(is_featured) WHERE is_featured = TRUE;

-- Interview themes indexes
CREATE INDEX IF NOT EXISTS idx_interview_themes_interview_id ON interview_themes(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_themes_theme_id ON interview_themes(theme_id);
CREATE INDEX IF NOT EXISTS idx_interview_themes_org_id ON interview_themes(org_id);
CREATE INDEX IF NOT EXISTS idx_interview_themes_depth ON interview_themes(discussion_depth);
CREATE INDEX IF NOT EXISTS idx_interview_themes_relevance ON interview_themes(relevance_score DESC);

-- Full-text search on quotes
CREATE INDEX IF NOT EXISTS idx_interview_quotes_text ON interview_quotes USING GIN (to_tsvector('english', quote_text));

-- ============================================================================
-- TRIGGERS
-- ============================================================================

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

-- Update interview analyzed_at when quotes/themes are added
CREATE OR REPLACE FUNCTION update_interview_analyzed_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE interviews 
  SET analyzed_at = NOW(),
      status = CASE 
        WHEN status = 'transcribed' THEN 'analyzed'
        ELSE status 
      END
  WHERE id = NEW.interview_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_quotes_analyzed ON interview_quotes;
CREATE TRIGGER interview_quotes_analyzed
  AFTER INSERT ON interview_quotes
  FOR EACH ROW
  EXECUTE FUNCTION update_interview_analyzed_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Upsert an interview by slug (idempotent)
CREATE OR REPLACE FUNCTION upsert_interview(
  p_org_id TEXT,
  p_title TEXT,
  p_slug TEXT,
  p_guest_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'scheduled',
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_interview_id UUID;
BEGIN
  INSERT INTO interviews (org_id, title, slug, guest_id, status, scheduled_at, metadata)
  VALUES (p_org_id, p_title, p_slug, p_guest_id, p_status, p_scheduled_at, p_metadata)
  ON CONFLICT (org_id, slug) DO UPDATE
  SET title = EXCLUDED.title,
      guest_id = COALESCE(EXCLUDED.guest_id, interviews.guest_id),
      status = EXCLUDED.status,
      scheduled_at = COALESCE(EXCLUDED.scheduled_at, interviews.scheduled_at),
      metadata = interviews.metadata || EXCLUDED.metadata
  RETURNING id INTO v_interview_id;
  
  RETURN v_interview_id;
END;
$$;

-- Add a quote to an interview
CREATE OR REPLACE FUNCTION add_interview_quote(
  p_org_id TEXT,
  p_interview_id UUID,
  p_quote_text TEXT,
  p_speaker TEXT,
  p_speaker_type TEXT DEFAULT 'guest',
  p_quote_type TEXT DEFAULT 'insight',
  p_context TEXT DEFAULT NULL,
  p_impact_score NUMERIC DEFAULT 0.5,
  p_shareability_score NUMERIC DEFAULT 0.5,
  p_timestamp_start INTEGER DEFAULT NULL,
  p_timestamp_end INTEGER DEFAULT NULL,
  p_extracted_by TEXT DEFAULT 'manual'
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
    org_id, interview_id, quote_text, speaker, speaker_type, quote_type,
    context, impact_score, shareability_score, timestamp_start, timestamp_end,
    extracted_by
  )
  VALUES (
    p_org_id, p_interview_id, p_quote_text, p_speaker, p_speaker_type, p_quote_type,
    p_context, p_impact_score, p_shareability_score, p_timestamp_start, p_timestamp_end,
    p_extracted_by
  )
  RETURNING id INTO v_quote_id;
  
  RETURN v_quote_id;
END;
$$;

-- Link interview to theme
CREATE OR REPLACE FUNCTION link_interview_to_theme(
  p_org_id TEXT,
  p_interview_id UUID,
  p_theme_id UUID,
  p_relevance_score NUMERIC DEFAULT 0.5,
  p_discussion_depth TEXT DEFAULT 'discussed',
  p_excerpt TEXT DEFAULT NULL,
  p_detected_by TEXT DEFAULT 'scanner',
  p_detection_metadata JSONB DEFAULT '{}'
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
    org_id, interview_id, theme_id, relevance_score, discussion_depth,
    excerpt, detected_by, detection_metadata
  )
  VALUES (
    p_org_id, p_interview_id, p_theme_id, p_relevance_score, p_discussion_depth,
    p_excerpt, p_detected_by, p_detection_metadata
  )
  ON CONFLICT (interview_id, theme_id) DO UPDATE
  SET relevance_score = GREATEST(interview_themes.relevance_score, EXCLUDED.relevance_score),
      discussion_depth = CASE
        WHEN EXCLUDED.relevance_score > interview_themes.relevance_score THEN EXCLUDED.discussion_depth
        ELSE interview_themes.discussion_depth
      END,
      excerpt = COALESCE(EXCLUDED.excerpt, interview_themes.excerpt),
      detection_metadata = interview_themes.detection_metadata || EXCLUDED.detection_metadata
  RETURNING id INTO v_link_id;
  
  RETURN v_link_id;
END;
$$;

-- Get interview with all quotes and themes
CREATE OR REPLACE FUNCTION get_interview_full(
  p_org_id TEXT,
  p_interview_id UUID
)
RETURNS TABLE (
  interview_data JSONB,
  quotes JSONB,
  themes JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    to_jsonb(i.*) AS interview_data,
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(q.*) ORDER BY q.timestamp_start NULLS LAST, q.created_at)
       FROM interview_quotes q WHERE q.interview_id = i.id),
      '[]'::jsonb
    ) AS quotes,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'link', to_jsonb(it.*),
          'theme', to_jsonb(t.*)
        ) ORDER BY it.relevance_score DESC
       )
       FROM interview_themes it
       JOIN themes t ON t.id = it.theme_id
       WHERE it.interview_id = i.id AND t.status = 'active'),
      '[]'::jsonb
    ) AS themes
  FROM interviews i
  WHERE i.org_id = p_org_id AND i.id = p_interview_id;
END;
$$;

-- Search quotes across interviews
CREATE OR REPLACE FUNCTION search_interview_quotes(
  p_org_id TEXT,
  p_query TEXT,
  p_limit INTEGER DEFAULT 20,
  p_quote_type TEXT DEFAULT NULL,
  p_min_impact NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  quote_id UUID,
  interview_id UUID,
  interview_title TEXT,
  quote_text TEXT,
  speaker TEXT,
  quote_type TEXT,
  impact_score NUMERIC,
  rank REAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    q.id AS quote_id,
    q.interview_id,
    i.title AS interview_title,
    q.quote_text,
    q.speaker,
    q.quote_type,
    q.impact_score,
    ts_rank(to_tsvector('english', q.quote_text), plainto_tsquery('english', p_query)) AS rank
  FROM interview_quotes q
  JOIN interviews i ON i.id = q.interview_id
  WHERE q.org_id = p_org_id
    AND to_tsvector('english', q.quote_text) @@ plainto_tsquery('english', p_query)
    AND (p_quote_type IS NULL OR q.quote_type = p_quote_type)
    AND (p_min_impact IS NULL OR q.impact_score >= p_min_impact)
  ORDER BY rank DESC, q.impact_score DESC
  LIMIT p_limit;
END;
$$;

-- Get themes across all interviews (aggregated view)
CREATE OR REPLACE FUNCTION get_interview_themes_summary(
  p_org_id TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  theme_id UUID,
  theme_name TEXT,
  theme_slug TEXT,
  theme_category TEXT,
  interview_count BIGINT,
  avg_relevance NUMERIC,
  deep_dive_count BIGINT,
  expert_insight_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id AS theme_id,
    t.name AS theme_name,
    t.slug AS theme_slug,
    t.category AS theme_category,
    COUNT(DISTINCT it.interview_id) AS interview_count,
    ROUND(AVG(it.relevance_score), 2) AS avg_relevance,
    COUNT(*) FILTER (WHERE it.discussion_depth = 'deep_dive') AS deep_dive_count,
    COUNT(*) FILTER (WHERE it.discussion_depth = 'expert_insight') AS expert_insight_count
  FROM themes t
  JOIN interview_themes it ON it.theme_id = t.id
  WHERE t.org_id = p_org_id AND t.status = 'active'
  GROUP BY t.id, t.name, t.slug, t.category
  ORDER BY interview_count DESC, avg_relevance DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE interviews IS 'Pipeline 2: Interview tracking and management';
COMMENT ON TABLE interview_quotes IS 'Notable quotes extracted from interviews for repurposing';
COMMENT ON TABLE interview_themes IS 'Links interviews to themes with depth analysis';

COMMENT ON COLUMN interviews.status IS 'Lifecycle: scheduled → recorded → transcribed → analyzed → published';
COMMENT ON COLUMN interview_quotes.quote_type IS 'Classification for content repurposing targeting';
COMMENT ON COLUMN interview_themes.discussion_depth IS 'How deeply the theme was explored in the interview';
