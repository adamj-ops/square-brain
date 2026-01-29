-- Migration: 004_ai_docs_chunks
-- Phase 5.1: RAG Semantic Search
-- 
-- Creates ai_docs and ai_chunks tables for document storage and vector search.
-- Requires pgvector extension to be enabled.

-- Enable pgvector extension (run once per database)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- ai_docs: Parent documents/sources
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  
  -- Source identification
  source_type TEXT NOT NULL CHECK (source_type IN ('brain_item', 'upload', 'url', 'manual')),
  source_id TEXT, -- e.g., brain_item UUID, URL, filename
  
  -- Document metadata
  title TEXT NOT NULL,
  content_md TEXT NOT NULL, -- Full original content (markdown)
  content_hash TEXT NOT NULL, -- SHA-256 for dedup
  
  -- Status and versioning
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'failed', 'archived')),
  chunk_count INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT ai_docs_source_unique UNIQUE (org_id, source_type, source_id)
);

-- Index for org queries
CREATE INDEX IF NOT EXISTS idx_ai_docs_org_id ON ai_docs(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_docs_source ON ai_docs(org_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_docs_content_hash ON ai_docs(content_hash);

-- ============================================================================
-- ai_chunks: Embedded chunks for vector search
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES ai_docs(id) ON DELETE CASCADE,
  org_id UUID NOT NULL, -- Denormalized for faster queries
  
  -- Chunk content
  chunk_index INTEGER NOT NULL, -- Position in document (0-based)
  content TEXT NOT NULL, -- Chunk text
  
  -- Vector embedding (OpenAI text-embedding-3-small = 1536 dimensions)
  embedding vector(1536),
  
  -- Metadata for context
  metadata JSONB DEFAULT '{}', -- Can store: section_title, page_number, etc.
  
  -- Token count for context budget
  token_count INTEGER,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique chunk per document position
  CONSTRAINT ai_chunks_doc_index_unique UNIQUE (doc_id, chunk_index)
);

-- Index for doc queries
CREATE INDEX IF NOT EXISTS idx_ai_chunks_doc_id ON ai_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_ai_chunks_org_id ON ai_chunks(org_id);

-- HNSW index for fast vector similarity search
-- Using cosine distance (OpenAI embeddings are normalized, so cosine ≈ inner product)
CREATE INDEX IF NOT EXISTS idx_ai_chunks_embedding ON ai_chunks 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- RPC: semantic_search
-- Searches chunks by vector similarity within an org
-- Security: SECURITY INVOKER (uses caller's permissions) + explicit search_path
-- ============================================================================
CREATE OR REPLACE FUNCTION semantic_search(
  query_embedding vector(1536),
  match_org_id UUID,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  doc_id UUID,
  content TEXT,
  similarity FLOAT,
  metadata JSONB,
  doc_title TEXT,
  doc_source_type TEXT,
  doc_source_id TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.doc_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    c.metadata,
    d.title AS doc_title,
    d.source_type AS doc_source_type,
    d.source_id AS doc_source_id
  FROM ai_chunks c
  JOIN ai_docs d ON d.id = c.doc_id
  WHERE 
    c.org_id = match_org_id
    AND d.status = 'active'
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- RPC: hybrid_search
-- Combines vector similarity with keyword matching for better recall
-- Security: SECURITY INVOKER (uses caller's permissions) + explicit search_path
-- ============================================================================
CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding vector(1536),
  query_text TEXT,
  match_org_id UUID,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  doc_id UUID,
  content TEXT,
  similarity FLOAT,
  keyword_match BOOLEAN,
  metadata JSONB,
  doc_title TEXT,
  doc_source_type TEXT,
  doc_source_id TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.doc_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    (c.content ILIKE '%' || query_text || '%') AS keyword_match,
    c.metadata,
    d.title AS doc_title,
    d.source_type AS doc_source_type,
    d.source_id AS doc_source_id
  FROM ai_chunks c
  JOIN ai_docs d ON d.id = c.doc_id
  WHERE 
    c.org_id = match_org_id
    AND d.status = 'active'
    AND c.embedding IS NOT NULL
    AND (
      1 - (c.embedding <=> query_embedding) > match_threshold
      OR c.content ILIKE '%' || query_text || '%'
    )
  ORDER BY 
    -- Boost keyword matches, then sort by similarity
    (CASE WHEN c.content ILIKE '%' || query_text || '%' THEN 0.1 ELSE 0 END) +
    (1 - (c.embedding <=> query_embedding)) DESC
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- Trigger: Update ai_docs.updated_at on change
-- ============================================================================
CREATE OR REPLACE FUNCTION update_ai_docs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_docs_updated_at ON ai_docs;
CREATE TRIGGER ai_docs_updated_at
  BEFORE UPDATE ON ai_docs
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_docs_updated_at();

-- ============================================================================
-- RLS Policies (if using Row Level Security)
-- ============================================================================
-- ALTER TABLE ai_docs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_chunks ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view own org docs" ON ai_docs
--   FOR SELECT USING (org_id = current_setting('app.current_org_id')::uuid);

-- CREATE POLICY "Users can view own org chunks" ON ai_chunks
--   FOR SELECT USING (org_id = current_setting('app.current_org_id')::uuid);
