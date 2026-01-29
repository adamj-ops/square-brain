-- Migration: Create ai_tool_logs table for tool execution auditing
-- Phase 4: Tool Executor + Audit Logging

-- Create ai_tool_logs table
CREATE TABLE IF NOT EXISTS ai_tool_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  session_id text,
  user_id text,
  tool_name text NOT NULL,
  status text NOT NULL, -- started | success | error
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  duration_ms int,
  args jsonb DEFAULT '{}'::jsonb,          -- stored for audits (server-only)
  result jsonb DEFAULT '{}'::jsonb,        -- sanitized result
  explainability jsonb DEFAULT '{}'::jsonb,
  error jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_ai_tool_logs_org_tool 
  ON ai_tool_logs (org_id, tool_name);

CREATE INDEX IF NOT EXISTS idx_ai_tool_logs_org_started 
  ON ai_tool_logs (org_id, started_at);

-- Enable RLS (internal routes use service role to bypass)
ALTER TABLE ai_tool_logs ENABLE ROW LEVEL SECURITY;

-- Add comment for documentation
COMMENT ON TABLE ai_tool_logs IS 'Audit log for all tool executions - Phase 4';
COMMENT ON COLUMN ai_tool_logs.status IS 'Execution status: started, success, or error';
COMMENT ON COLUMN ai_tool_logs.args IS 'Tool input arguments (server-only, never sent to client)';
COMMENT ON COLUMN ai_tool_logs.explainability IS 'Tool explainability metadata for debugging/auditing';
