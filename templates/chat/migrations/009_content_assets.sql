-- Migration: 009_content_assets.sql
-- Pipeline 3: Content Repurposing
--
-- Creates tables for content assets generated from interviews.
-- Supports quote cards, carousel outlines, shortform scripts, audio bite ideas.

-- ============================================================================
-- CONTENT_ASSETS TABLE
-- ============================================================================
-- Stores generated content assets from interviews

CREATE TABLE IF NOT EXISTS content_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Source reference
  interview_id UUID REFERENCES interviews(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES interview_quotes(id) ON DELETE SET NULL,
  
  -- Asset type
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'quote_card',       -- Visual quote card design
    'carousel_slide',   -- Individual carousel slide
    'carousel_outline', -- Full carousel outline
    'shortform_script', -- TikTok/Reels/Shorts script
    'audio_bite',       -- Audiogram/soundbite idea
    'blog_section',     -- Blog post section
    'newsletter_blurb', -- Newsletter snippet
    'social_post',      -- Generic social media post
    'thread',           -- Twitter/X thread
    'linkedin_post',    -- LinkedIn-specific post
    'custom'            -- Other content type
  )),
  
  -- Asset content
  title TEXT NOT NULL,               -- Asset title/headline
  content TEXT NOT NULL,             -- Main content/body
  hook TEXT,                         -- Attention-grabbing opener
  call_to_action TEXT,               -- CTA text
  
  -- Visual/Design specs (for quote cards, carousels)
  design_specs JSONB DEFAULT '{}',   -- { background, font, colors, layout, etc. }
  
  -- Script/Audio specs (for shortform, audio bites)
  script_specs JSONB DEFAULT '{}',   -- { duration_seconds, music_suggestion, visual_cues, etc. }
  
  -- Targeting
  target_platform TEXT,              -- instagram, tiktok, linkedin, twitter, youtube, etc.
  target_audience TEXT,              -- Audience segment this is for
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'idea',       -- Just an idea/suggestion
    'draft',      -- Content drafted
    'review',     -- Pending review
    'approved',   -- Approved for publishing
    'scheduled',  -- Scheduled for publishing
    'published',  -- Already published
    'archived'    -- No longer active
  )),
  
  -- Performance (post-publish)
  published_url TEXT,
  published_at TIMESTAMPTZ,
  performance_metrics JSONB DEFAULT '{}',  -- { views, likes, shares, comments, etc. }
  
  -- AI generation metadata
  generated_by TEXT,                 -- Model used (gpt-4, claude, etc.)
  generation_prompt TEXT,            -- Prompt used to generate
  generation_metadata JSONB DEFAULT '{}',
  
  -- Tags and categorization
  tags TEXT[] DEFAULT '{}',
  themes TEXT[] DEFAULT '{}',        -- Related themes
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- For carousel slides: link to parent outline
  parent_asset_id UUID REFERENCES content_assets(id) ON DELETE CASCADE,
  sequence_order INTEGER             -- Order within parent (for carousels)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary lookups
CREATE INDEX IF NOT EXISTS idx_content_assets_org_id ON content_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_interview_id ON content_assets(interview_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_quote_id ON content_assets(quote_id);

-- Type and status filtering
CREATE INDEX IF NOT EXISTS idx_content_assets_type ON content_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_content_assets_status ON content_assets(status);
CREATE INDEX IF NOT EXISTS idx_content_assets_platform ON content_assets(target_platform);

-- Carousel parent/child
CREATE INDEX IF NOT EXISTS idx_content_assets_parent ON content_assets(parent_asset_id);

-- Tags and themes (GIN for array contains queries)
CREATE INDEX IF NOT EXISTS idx_content_assets_tags ON content_assets USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_content_assets_themes ON content_assets USING GIN (themes);

-- Timestamp ordering
CREATE INDEX IF NOT EXISTS idx_content_assets_created ON content_assets(created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at on change
CREATE OR REPLACE FUNCTION update_content_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_assets_updated_at ON content_assets;
CREATE TRIGGER content_assets_updated_at
  BEFORE UPDATE ON content_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_content_assets_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Create content asset (returns ID)
CREATE OR REPLACE FUNCTION create_content_asset(
  p_org_id TEXT,
  p_asset_type TEXT,
  p_title TEXT,
  p_content TEXT,
  p_interview_id UUID DEFAULT NULL,
  p_quote_id UUID DEFAULT NULL,
  p_hook TEXT DEFAULT NULL,
  p_call_to_action TEXT DEFAULT NULL,
  p_target_platform TEXT DEFAULT NULL,
  p_design_specs JSONB DEFAULT '{}',
  p_script_specs JSONB DEFAULT '{}',
  p_tags TEXT[] DEFAULT '{}',
  p_themes TEXT[] DEFAULT '{}',
  p_generated_by TEXT DEFAULT NULL,
  p_generation_prompt TEXT DEFAULT NULL,
  p_parent_asset_id UUID DEFAULT NULL,
  p_sequence_order INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_asset_id UUID;
BEGIN
  INSERT INTO content_assets (
    org_id, asset_type, title, content,
    interview_id, quote_id,
    hook, call_to_action, target_platform,
    design_specs, script_specs,
    tags, themes,
    generated_by, generation_prompt,
    parent_asset_id, sequence_order
  )
  VALUES (
    p_org_id, p_asset_type, p_title, p_content,
    p_interview_id, p_quote_id,
    p_hook, p_call_to_action, p_target_platform,
    p_design_specs, p_script_specs,
    p_tags, p_themes,
    p_generated_by, p_generation_prompt,
    p_parent_asset_id, p_sequence_order
  )
  RETURNING id INTO v_asset_id;
  
  RETURN v_asset_id;
END;
$$;

-- Get content assets by interview with counts by type
CREATE OR REPLACE FUNCTION get_interview_content_summary(
  p_org_id TEXT,
  p_interview_id UUID
)
RETURNS TABLE (
  asset_type TEXT,
  total_count BIGINT,
  draft_count BIGINT,
  approved_count BIGINT,
  published_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ca.asset_type,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE ca.status = 'draft') AS draft_count,
    COUNT(*) FILTER (WHERE ca.status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE ca.status = 'published') AS published_count
  FROM content_assets ca
  WHERE ca.org_id = p_org_id 
    AND ca.interview_id = p_interview_id
  GROUP BY ca.asset_type
  ORDER BY total_count DESC;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE content_assets IS 'Generated content assets from interviews - Pipeline 3: Content Repurposing';
COMMENT ON COLUMN content_assets.asset_type IS 'Type of content: quote_card, carousel_outline, shortform_script, audio_bite, etc.';
COMMENT ON COLUMN content_assets.design_specs IS 'Visual design specs JSON: { background, font, colors, layout }';
COMMENT ON COLUMN content_assets.script_specs IS 'Script/audio specs JSON: { duration_seconds, music_suggestion, visual_cues }';
COMMENT ON COLUMN content_assets.parent_asset_id IS 'For carousel slides, references the parent carousel_outline asset';
