-- Migration: 005_messages_assumptions
-- Phase 5.1: Add assumptions column to messages table
-- 
-- This column stores the assumptions made by the AI during generation,
-- mirroring the final.payload.assumptions from the assistant response.

-- Add assumptions column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'assumptions'
  ) THEN
    ALTER TABLE messages ADD COLUMN assumptions JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN messages.assumptions IS 'AI assumptions made during generation (from final.payload.assumptions)';
