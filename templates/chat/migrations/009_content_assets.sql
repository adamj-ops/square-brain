-- Migration: 009_content_assets.sql
-- Pipeline 3: Content Repurposing
--
-- Creates table for content assets generated from interviews and quotes.

-- ============================================
-- CONTENT_ASSETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS content_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Source references
  interview_id UUID REFERENCES interviews(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES interview_quotes(id) ON DELETE SET NULL,
  
  -- Asset identity
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  
  -- Asset type
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'quote_card',        -- Visual quote for social media
    'carousel',          -- Multi-slide carousel outline
    'shortform_script',  -- Short video/reel script
    'audio_bite',        -- Audiogram/podcast clip idea
    'thread',            -- Twitter/X thread outline
    'blog_outline',      -- Blog post outline
    'newsletter',        -- Newsletter segment
    'linkedin_post',     -- LinkedIn post draft
    'youtube_short',     -- YouTube Short script
    'tiktok',            -- TikTok script
    'other'
  )),
  
  -- Content
  content JSONB NOT NULL, -- Structured content based on asset_type
  preview_text TEXT,      -- Short preview/summary
  
  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'idea',       -- Just an idea
    'draft',      -- Being drafted
    'ready',      -- Ready for review
    'approved',   -- Approved for use
    'published',  -- Published/used
    'archived'    -- No longer active
  )),
  
  -- Quality and relevance
  quality_score NUMERIC(3,2) DEFAULT 0.5, -- 0-1
  relevance_score NUMERIC(3,2) DEFAULT 0.5, -- 0-1
  
  -- Platform targeting
  target_platform TEXT, -- instagram, twitter, linkedin, youtube, tiktok, etc.
  format_specs JSONB DEFAULT '{}', -- Platform-specific formatting
  
  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  published_url TEXT,
  
  -- Generation metadata
  generated_by TEXT DEFAULT 'ai', -- 'ai', 'manual', 'hybrid'
  generation_prompt TEXT, -- The prompt used to generate
  generation_model TEXT,  -- Model used (gpt-4o, etc.)
  
  -- Tags and categorization
  tags TEXT[] DEFAULT '{}',
  themes TEXT[] DEFAULT '{}', -- Theme slugs
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT content_assets_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_content_assets_org_id ON content_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_type ON content_assets(org_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_content_assets_status ON content_assets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_content_assets_interview ON content_assets(interview_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_quote ON content_assets(quote_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_platform ON content_assets(target_platform);
CREATE INDEX IF NOT EXISTS idx_content_assets_quality ON content_assets(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_content_assets_tags ON content_assets USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_content_assets_themes ON content_assets USING GIN(themes);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update content_assets.updated_at on change
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

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Generate a unique slug for content asset
CREATE OR REPLACE FUNCTION generate_content_asset_slug(
  p_org_id TEXT,
  p_title TEXT,
  p_asset_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_base_slug TEXT;
  v_slug TEXT;
  v_counter INTEGER := 0;
BEGIN
  -- Generate base slug from title and type
  v_base_slug := LOWER(REGEXP_REPLACE(
    p_asset_type || '-' || p_title,
    '[^a-zA-Z0-9]+', '-', 'g'
  ));
  v_base_slug := SUBSTRING(v_base_slug, 1, 50); -- Limit length
  
  v_slug := v_base_slug;
  
  -- Find unique slug
  WHILE EXISTS (
    SELECT 1 FROM content_assets
    WHERE org_id = p_org_id AND slug = v_slug
  ) LOOP
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || v_counter;
  END LOOP;
  
  RETURN v_slug;
END;
$$;
