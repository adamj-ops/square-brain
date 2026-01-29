-- Migration: 006_themes.sql
-- Phase 5.3: Background compounding job (themes scanner)
--
-- Creates themes table for extracted themes and
-- content_themes for evidence linking (many-to-many)

-- ============================================
-- THEMES TABLE
-- ============================================
-- Stores extracted themes from content analysis

CREATE TABLE IF NOT EXISTS themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Theme identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL,  -- URL-safe identifier
  description TEXT,    -- LLM-generated description
  
  -- Classification
  category TEXT,       -- e.g., "product", "culture", "process", "strategy"
  
  -- Strength metrics
  mention_count INTEGER DEFAULT 0,      -- How many times mentioned
  evidence_count INTEGER DEFAULT 0,     -- Number of linked evidence items
  confidence_score NUMERIC(3,2) DEFAULT 0.5,  -- 0-1, based on evidence quality
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'merged', 'archived')),
  merged_into_id UUID REFERENCES themes(id),  -- If merged, points to canonical theme
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),  -- Last time theme was detected
  
  -- Constraints
  CONSTRAINT themes_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================
-- CONTENT_THEMES TABLE (Evidence Linking)
-- ============================================
-- Links themes to source content (brain_items, ai_docs, etc.)

CREATE TABLE IF NOT EXISTS content_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Theme reference
  theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  
  -- Content reference (polymorphic)
  content_type TEXT NOT NULL,  -- 'brain_item', 'ai_doc', 'ai_chunk'
  content_id UUID NOT NULL,    -- ID in the source table
  
  -- Evidence details
  relevance_score NUMERIC(3,2) DEFAULT 0.5,  -- 0-1, how relevant this evidence is
  excerpt TEXT,                               -- Relevant quote/snippet
  context TEXT,                               -- Surrounding context
  
  -- Detection metadata
  detected_by TEXT DEFAULT 'scanner',  -- 'scanner', 'manual', 'agent'
  detection_metadata JSONB DEFAULT '{}',  -- Model used, confidence, etc.
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate links
  CONSTRAINT content_themes_unique UNIQUE (theme_id, content_type, content_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- Themes lookups
CREATE INDEX IF NOT EXISTS idx_themes_org_id ON themes(org_id);
CREATE INDEX IF NOT EXISTS idx_themes_org_status ON themes(org_id, status);
CREATE INDEX IF NOT EXISTS idx_themes_slug ON themes(slug);
CREATE INDEX IF NOT EXISTS idx_themes_category ON themes(category);
CREATE INDEX IF NOT EXISTS idx_themes_confidence ON themes(confidence_score DESC);

-- Content themes lookups
CREATE INDEX IF NOT EXISTS idx_content_themes_theme_id ON content_themes(theme_id);
CREATE INDEX IF NOT EXISTS idx_content_themes_content ON content_themes(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_themes_org_id ON content_themes(org_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update themes.updated_at on change
CREATE OR REPLACE FUNCTION update_themes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS themes_updated_at ON themes;
CREATE TRIGGER themes_updated_at
  BEFORE UPDATE ON themes
  FOR EACH ROW
  EXECUTE FUNCTION update_themes_updated_at();

-- Update evidence_count on content_themes changes
CREATE OR REPLACE FUNCTION update_theme_evidence_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE themes 
    SET evidence_count = evidence_count + 1,
        last_seen_at = NOW()
    WHERE id = NEW.theme_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE themes 
    SET evidence_count = evidence_count - 1
    WHERE id = OLD.theme_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_themes_count ON content_themes;
CREATE TRIGGER content_themes_count
  AFTER INSERT OR DELETE ON content_themes
  FOR EACH ROW
  EXECUTE FUNCTION update_theme_evidence_count();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get or create a theme by slug
CREATE OR REPLACE FUNCTION get_or_create_theme(
  p_org_id TEXT,
  p_name TEXT,
  p_slug TEXT,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_theme_id UUID;
BEGIN
  -- Try to find existing theme
  SELECT id INTO v_theme_id
  FROM themes
  WHERE org_id = p_org_id AND slug = p_slug AND status = 'active';
  
  -- Create if not found
  IF v_theme_id IS NULL THEN
    INSERT INTO themes (org_id, name, slug, description, category)
    VALUES (p_org_id, p_name, p_slug, p_description, p_category)
    RETURNING id INTO v_theme_id;
  ELSE
    -- Update last_seen_at and mention_count
    UPDATE themes
    SET last_seen_at = NOW(),
        mention_count = mention_count + 1
    WHERE id = v_theme_id;
  END IF;
  
  RETURN v_theme_id;
END;
$$;

-- Link content to theme (idempotent)
CREATE OR REPLACE FUNCTION link_content_to_theme(
  p_org_id TEXT,
  p_theme_id UUID,
  p_content_type TEXT,
  p_content_id UUID,
  p_relevance_score NUMERIC DEFAULT 0.5,
  p_excerpt TEXT DEFAULT NULL,
  p_context TEXT DEFAULT NULL,
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
  -- Upsert the link
  INSERT INTO content_themes (
    org_id, theme_id, content_type, content_id,
    relevance_score, excerpt, context,
    detected_by, detection_metadata
  )
  VALUES (
    p_org_id, p_theme_id, p_content_type, p_content_id,
    p_relevance_score, p_excerpt, p_context,
    p_detected_by, p_detection_metadata
  )
  ON CONFLICT (theme_id, content_type, content_id) DO UPDATE
  SET relevance_score = EXCLUDED.relevance_score,
      excerpt = COALESCE(EXCLUDED.excerpt, content_themes.excerpt),
      context = COALESCE(EXCLUDED.context, content_themes.context),
      detection_metadata = content_themes.detection_metadata || EXCLUDED.detection_metadata
  RETURNING id INTO v_link_id;
  
  RETURN v_link_id;
END;
$$;
