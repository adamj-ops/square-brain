-- Migration: 011_audience_quiz.sql
-- Pipeline 5: Audience & Quiz Segmentation
--
-- Creates tables for quiz responses, audience segments, segment rules, and CTAs.
-- Supports sliding interdependency scoring and emotion-based CTA assignment.

-- ============================================================================
-- AUDIENCE_SEGMENTS TABLE
-- ============================================================================
-- Define audience segments that users can be assigned to

CREATE TABLE IF NOT EXISTS audience_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Segment identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL,  -- URL-safe identifier
  description TEXT,
  
  -- Segment characteristics
  archetype TEXT,              -- e.g., 'Health Optimizer', 'Skeptic', 'Newbie'
  primary_emotion TEXT,        -- Dominant emotional state
  pain_points TEXT[] DEFAULT '{}',
  goals TEXT[] DEFAULT '{}',
  
  -- Scoring thresholds
  min_score NUMERIC(5,2),      -- Minimum score to qualify
  max_score NUMERIC(5,2),      -- Maximum score for this segment
  
  -- Priority for assignment (higher = checked first)
  priority INTEGER DEFAULT 0,
  
  -- Display
  display_color TEXT,          -- Hex color for UI
  icon TEXT,                   -- Icon identifier
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active',
    'draft',
    'archived'
  )),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT audience_segments_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================================================
-- SEGMENT_RULES TABLE
-- ============================================================================
-- Rules that determine segment assignment based on quiz responses

CREATE TABLE IF NOT EXISTS segment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  segment_id UUID NOT NULL REFERENCES audience_segments(id) ON DELETE CASCADE,
  
  -- Rule identity
  name TEXT NOT NULL,
  description TEXT,
  
  -- Rule definition
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'score_range',        -- Based on total score range
    'question_match',     -- Based on specific question answer
    'pattern_match',      -- Based on answer patterns
    'weighted_sum',       -- Weighted combination of factors
    'boolean_expression', -- Complex boolean logic
    'custom'              -- Custom rule evaluated by code
  )),
  
  -- Rule configuration (structure depends on rule_type)
  config JSONB NOT NULL DEFAULT '{}',
  -- Examples:
  -- score_range: { "min": 60, "max": 80 }
  -- question_match: { "question_id": "q1", "answers": ["a", "b"], "weight": 1.5 }
  -- pattern_match: { "patterns": [{"questions": ["q1","q2"], "answers": [["a"],["b","c"]]}] }
  -- weighted_sum: { "factors": [{"source": "question:q1", "weight": 0.3}, ...] }
  -- boolean_expression: { "expression": "(q1 == 'a' AND q2 IN ['b','c']) OR score > 70" }
  
  -- Rule weight (for combining multiple rules)
  weight NUMERIC(4,2) DEFAULT 1.0,
  
  -- Priority (higher = evaluated first)
  priority INTEGER DEFAULT 0,
  
  -- Status
  active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- CTAS TABLE (Call-to-Actions)
-- ============================================================================
-- CTAs that can be shown to users based on their segment and emotion

CREATE TABLE IF NOT EXISTS ctas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- CTA identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  
  -- Target segment (optional - NULL means any segment)
  segment_id UUID REFERENCES audience_segments(id) ON DELETE SET NULL,
  
  -- Emotional targeting
  target_emotions TEXT[] DEFAULT '{}',  -- Emotions this CTA is designed for
  
  -- CTA content
  headline TEXT NOT NULL,
  subheadline TEXT,
  body_text TEXT,
  button_text TEXT NOT NULL,
  button_url TEXT NOT NULL,
  
  -- Visual
  image_url TEXT,
  background_color TEXT,
  button_color TEXT,
  
  -- CTA type
  cta_type TEXT DEFAULT 'primary' CHECK (cta_type IN (
    'primary',      -- Main conversion action
    'secondary',    -- Alternative action
    'soft',         -- Low-pressure engagement
    'nurture',      -- Long-term nurture
    'exit_intent'   -- Shown on exit
  )),
  
  -- Placement
  placement TEXT[] DEFAULT '{}' CHECK (placement <@ ARRAY[
    'quiz_result',
    'sidebar',
    'popup',
    'banner',
    'inline',
    'email'
  ]::TEXT[]),
  
  -- Scoring/priority
  priority INTEGER DEFAULT 0,
  score_boost NUMERIC(4,2) DEFAULT 0,  -- Boost for certain conditions
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active',
    'draft',
    'paused',
    'archived'
  )),
  
  -- A/B testing
  variant_group TEXT,  -- Group CTAs for A/B testing
  variant_weight NUMERIC(3,2) DEFAULT 1.0,
  
  -- Analytics
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT ctas_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================================================
-- QUIZ_RESPONSES TABLE
-- ============================================================================
-- Store individual quiz responses with scoring

CREATE TABLE IF NOT EXISTS quiz_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Respondent identification
  session_id TEXT NOT NULL,  -- Anonymous session ID
  user_id TEXT,              -- If logged in
  email TEXT,                -- If provided
  
  -- Quiz identification
  quiz_id TEXT NOT NULL,     -- Which quiz was taken
  quiz_version TEXT,         -- Version of the quiz
  
  -- Response data
  answers JSONB NOT NULL DEFAULT '{}',
  -- Structure: { "q1": "answer1", "q2": ["multi", "choice"], ... }
  
  -- Raw question responses with metadata
  responses JSONB DEFAULT '[]',
  -- Structure: [{ "question_id": "q1", "answer": "a", "time_spent_ms": 3500 }, ...]
  
  -- Computed scores
  raw_score NUMERIC(5,2),           -- Unweighted sum
  weighted_score NUMERIC(5,2),      -- Weighted sum
  normalized_score NUMERIC(5,2),    -- 0-100 normalized
  
  -- Interdependency scores (sliding scoring based on answer combinations)
  interdependency_scores JSONB DEFAULT '{}',
  -- Structure: { "health_awareness": 75, "motivation": 60, "readiness": 80 }
  
  -- Dimension scores
  dimension_scores JSONB DEFAULT '{}',
  -- Structure: { "knowledge": 45, "motivation": 80, "barriers": 30 }
  
  -- Emotional profile
  detected_emotions JSONB DEFAULT '{}',
  -- Structure: { "primary": "curious", "secondary": "anxious", "confidence": 0.75 }
  
  -- Assigned segment
  segment_id UUID REFERENCES audience_segments(id) ON DELETE SET NULL,
  segment_assigned_at TIMESTAMPTZ,
  segment_confidence NUMERIC(3,2),  -- 0-1 confidence in assignment
  segment_reasoning TEXT,           -- Why this segment was assigned
  
  -- Suggested CTAs
  suggested_ctas UUID[] DEFAULT '{}',
  primary_cta_id UUID REFERENCES ctas(id) ON DELETE SET NULL,
  
  -- Completion status
  status TEXT DEFAULT 'in_progress' CHECK (status IN (
    'in_progress',   -- Still taking the quiz
    'completed',     -- Finished all questions
    'abandoned',     -- Started but didn't finish
    'scored',        -- Completed and scored
    'segmented'      -- Scored and assigned to segment
  )),
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,
  
  -- Source tracking
  source TEXT,          -- utm_source or referrer
  source_url TEXT,      -- Full URL
  device_type TEXT,     -- mobile, tablet, desktop
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Audience segments indexes
CREATE INDEX IF NOT EXISTS idx_audience_segments_org_id ON audience_segments(org_id);
CREATE INDEX IF NOT EXISTS idx_audience_segments_status ON audience_segments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_audience_segments_slug ON audience_segments(slug);
CREATE INDEX IF NOT EXISTS idx_audience_segments_priority ON audience_segments(priority DESC);

-- Segment rules indexes
CREATE INDEX IF NOT EXISTS idx_segment_rules_org_id ON segment_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_segment_rules_segment ON segment_rules(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_rules_type ON segment_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_segment_rules_active ON segment_rules(org_id) 
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_segment_rules_priority ON segment_rules(priority DESC);

-- CTAs indexes
CREATE INDEX IF NOT EXISTS idx_ctas_org_id ON ctas(org_id);
CREATE INDEX IF NOT EXISTS idx_ctas_segment ON ctas(segment_id);
CREATE INDEX IF NOT EXISTS idx_ctas_status ON ctas(org_id, status);
CREATE INDEX IF NOT EXISTS idx_ctas_type ON ctas(cta_type);
CREATE INDEX IF NOT EXISTS idx_ctas_emotions ON ctas USING GIN (target_emotions);
CREATE INDEX IF NOT EXISTS idx_ctas_placement ON ctas USING GIN (placement);
CREATE INDEX IF NOT EXISTS idx_ctas_priority ON ctas(priority DESC);

-- Quiz responses indexes
CREATE INDEX IF NOT EXISTS idx_quiz_responses_org_id ON quiz_responses(org_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_session ON quiz_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_user ON quiz_responses(user_id) 
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_responses_email ON quiz_responses(email) 
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_responses_quiz ON quiz_responses(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_segment ON quiz_responses(segment_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_status ON quiz_responses(org_id, status);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_score ON quiz_responses(normalized_score DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_created ON quiz_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_completed ON quiz_responses(completed_at DESC)
  WHERE status = 'completed' OR status = 'scored' OR status = 'segmented';

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update audience_segments.updated_at on change
CREATE OR REPLACE FUNCTION update_audience_segments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audience_segments_updated_at ON audience_segments;
CREATE TRIGGER audience_segments_updated_at
  BEFORE UPDATE ON audience_segments
  FOR EACH ROW
  EXECUTE FUNCTION update_audience_segments_updated_at();

-- Update segment_rules.updated_at on change
CREATE OR REPLACE FUNCTION update_segment_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS segment_rules_updated_at ON segment_rules;
CREATE TRIGGER segment_rules_updated_at
  BEFORE UPDATE ON segment_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_segment_rules_updated_at();

-- Update ctas.updated_at on change
CREATE OR REPLACE FUNCTION update_ctas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ctas_updated_at ON ctas;
CREATE TRIGGER ctas_updated_at
  BEFORE UPDATE ON ctas
  FOR EACH ROW
  EXECUTE FUNCTION update_ctas_updated_at();

-- Update quiz_responses.updated_at on change
CREATE OR REPLACE FUNCTION update_quiz_responses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quiz_responses_updated_at ON quiz_responses;
CREATE TRIGGER quiz_responses_updated_at
  BEFORE UPDATE ON quiz_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_quiz_responses_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Upsert audience segment by slug (idempotent)
CREATE OR REPLACE FUNCTION upsert_audience_segment(
  p_org_id TEXT,
  p_name TEXT,
  p_slug TEXT,
  p_description TEXT DEFAULT NULL,
  p_archetype TEXT DEFAULT NULL,
  p_primary_emotion TEXT DEFAULT NULL,
  p_min_score NUMERIC DEFAULT NULL,
  p_max_score NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_segment_id UUID;
BEGIN
  INSERT INTO audience_segments (
    org_id, name, slug, description, archetype, 
    primary_emotion, min_score, max_score, metadata
  )
  VALUES (
    p_org_id, p_name, p_slug, p_description, p_archetype,
    p_primary_emotion, p_min_score, p_max_score, p_metadata
  )
  ON CONFLICT (org_id, slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = COALESCE(EXCLUDED.description, audience_segments.description),
      archetype = COALESCE(EXCLUDED.archetype, audience_segments.archetype),
      primary_emotion = COALESCE(EXCLUDED.primary_emotion, audience_segments.primary_emotion),
      min_score = COALESCE(EXCLUDED.min_score, audience_segments.min_score),
      max_score = COALESCE(EXCLUDED.max_score, audience_segments.max_score),
      metadata = audience_segments.metadata || EXCLUDED.metadata
  RETURNING id INTO v_segment_id;
  
  RETURN v_segment_id;
END;
$$;

-- Get segments ordered by priority for scoring
CREATE OR REPLACE FUNCTION get_active_segments(
  p_org_id TEXT
)
RETURNS TABLE (
  segment_id UUID,
  name TEXT,
  slug TEXT,
  archetype TEXT,
  primary_emotion TEXT,
  min_score NUMERIC,
  max_score NUMERIC,
  priority INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS segment_id,
    s.name,
    s.slug,
    s.archetype,
    s.primary_emotion,
    s.min_score,
    s.max_score,
    s.priority
  FROM audience_segments s
  WHERE s.org_id = p_org_id
    AND s.status = 'active'
  ORDER BY s.priority DESC, s.min_score DESC;
END;
$$;

-- Get CTAs for a segment and emotion
CREATE OR REPLACE FUNCTION get_segment_ctas(
  p_org_id TEXT,
  p_segment_id UUID,
  p_emotion TEXT DEFAULT NULL,
  p_placement TEXT DEFAULT NULL,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  cta_id UUID,
  name TEXT,
  slug TEXT,
  headline TEXT,
  button_text TEXT,
  button_url TEXT,
  cta_type TEXT,
  priority INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS cta_id,
    c.name,
    c.slug,
    c.headline,
    c.button_text,
    c.button_url,
    c.cta_type,
    c.priority + CASE 
      WHEN p_emotion IS NOT NULL AND p_emotion = ANY(c.target_emotions) THEN 10
      ELSE 0
    END AS priority
  FROM ctas c
  WHERE c.org_id = p_org_id
    AND c.status = 'active'
    AND (c.segment_id IS NULL OR c.segment_id = p_segment_id)
    AND (p_emotion IS NULL OR c.target_emotions = '{}' OR p_emotion = ANY(c.target_emotions))
    AND (p_placement IS NULL OR p_placement = ANY(c.placement))
  ORDER BY priority DESC
  LIMIT p_limit;
END;
$$;

-- Get quiz response statistics
CREATE OR REPLACE FUNCTION get_quiz_stats(
  p_org_id TEXT,
  p_quiz_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_responses BIGINT,
  completed_responses BIGINT,
  avg_score NUMERIC,
  avg_time_seconds NUMERIC,
  segment_distribution JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) AS total_responses,
    COUNT(*) FILTER (WHERE status IN ('completed', 'scored', 'segmented')) AS completed_responses,
    AVG(normalized_score) FILTER (WHERE normalized_score IS NOT NULL) AS avg_score,
    AVG(time_spent_seconds) FILTER (WHERE time_spent_seconds IS NOT NULL) AS avg_time_seconds,
    COALESCE(
      jsonb_object_agg(
        COALESCE(s.name, 'Unassigned'),
        segment_count
      ),
      '{}'::jsonb
    ) AS segment_distribution
  FROM quiz_responses qr
  LEFT JOIN (
    SELECT segment_id, COUNT(*) as segment_count
    FROM quiz_responses
    WHERE org_id = p_org_id
      AND (p_quiz_id IS NULL OR quiz_id = p_quiz_id)
    GROUP BY segment_id
  ) sc ON sc.segment_id = qr.segment_id
  LEFT JOIN audience_segments s ON s.id = qr.segment_id
  WHERE qr.org_id = p_org_id
    AND (p_quiz_id IS NULL OR qr.quiz_id = p_quiz_id);
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE audience_segments IS 'Pipeline 5: Define audience segments for quiz segmentation';
COMMENT ON TABLE segment_rules IS 'Rules that determine which segment a user belongs to';
COMMENT ON TABLE ctas IS 'Calls-to-action tied to segments and emotions';
COMMENT ON TABLE quiz_responses IS 'Individual quiz responses with scoring and segment assignment';

COMMENT ON COLUMN quiz_responses.interdependency_scores IS 'Sliding scores that account for answer combination effects';
COMMENT ON COLUMN quiz_responses.detected_emotions IS 'AI-detected emotional profile from responses';
COMMENT ON COLUMN ctas.target_emotions IS 'Emotions this CTA is optimized for';
COMMENT ON COLUMN segment_rules.config IS 'Rule configuration - structure depends on rule_type';
