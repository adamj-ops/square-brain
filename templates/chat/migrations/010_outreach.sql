-- Migration: 010_outreach.sql
-- Pipeline 4: Outreach Automation (Human-in-the-Loop)
--
-- Creates tables for outreach sequences, messages, and event tracking.
-- All sending requires human approval.

-- ============================================
-- OUTREACH_SEQUENCES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Sequence identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  
  -- Target
  target_type TEXT DEFAULT 'guest' CHECK (target_type IN (
    'guest',        -- Podcast guest outreach
    'sponsor',      -- Sponsorship outreach
    'collaborator', -- Collaboration requests
    'newsletter',   -- Newsletter subscribers
    'custom'
  )),
  
  -- Sequence configuration
  steps JSONB DEFAULT '[]', -- Array of step definitions
  default_delay_days INTEGER DEFAULT 3,
  max_attempts INTEGER DEFAULT 3,
  
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft',    -- Being designed
    'active',   -- In use
    'paused',   -- Temporarily stopped
    'archived'  -- No longer used
  )),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT outreach_sequences_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================
-- OUTREACH_MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Sequence and target
  sequence_id UUID REFERENCES outreach_sequences(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  
  -- Message details
  message_type TEXT DEFAULT 'email' CHECK (message_type IN (
    'email',
    'linkedin',
    'twitter_dm',
    'sms',
    'other'
  )),
  
  -- Recipient
  recipient_email TEXT,
  recipient_name TEXT,
  
  -- Content
  subject TEXT,
  body_text TEXT NOT NULL,
  body_html TEXT,
  
  -- Step tracking
  step_number INTEGER DEFAULT 1,
  
  -- Approval workflow (Human-in-the-Loop)
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft',        -- Being composed
    'pending_approval', -- Waiting for human approval
    'approved',     -- Approved for sending
    'scheduled',    -- Scheduled for future send
    'sending',      -- Being sent
    'sent',         -- Successfully sent
    'failed',       -- Send failed
    'cancelled',    -- Cancelled by user
    'bounced',      -- Email bounced
    'replied'       -- Recipient replied
  )),
  
  -- Approval details
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  
  -- Scheduling
  scheduled_for TIMESTAMPTZ,
  
  -- Sending details
  sent_at TIMESTAMPTZ,
  sent_via TEXT, -- 'resend', 'manual', etc.
  external_id TEXT, -- ID from email service
  
  -- Response tracking
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- OUTREACH_EVENTS TABLE (Event log)
-- ============================================
CREATE TABLE IF NOT EXISTS outreach_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- References
  message_id UUID REFERENCES outreach_messages(id) ON DELETE CASCADE,
  sequence_id UUID REFERENCES outreach_sequences(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  
  -- Event details
  event_type TEXT NOT NULL CHECK (event_type IN (
    'message_created',
    'message_edited',
    'approval_requested',
    'approved',
    'rejected',
    'scheduled',
    'sent',
    'delivered',
    'opened',
    'clicked',
    'replied',
    'bounced',
    'failed',
    'cancelled',
    'unsubscribed'
  )),
  
  -- Event data
  event_data JSONB DEFAULT '{}',
  
  -- Actor
  actor_type TEXT DEFAULT 'system' CHECK (actor_type IN (
    'system',     -- Automated
    'user',       -- Human user
    'webhook',    -- External webhook
    'recipient'   -- Email recipient action
  )),
  actor_id TEXT,
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Outreach sequences
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_org_id ON outreach_sequences(org_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_status ON outreach_sequences(org_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_type ON outreach_sequences(target_type);

-- Outreach messages
CREATE INDEX IF NOT EXISTS idx_outreach_messages_org_id ON outreach_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_status ON outreach_messages(org_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_sequence ON outreach_messages(sequence_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_guest ON outreach_messages(guest_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_scheduled ON outreach_messages(scheduled_for) 
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_outreach_messages_pending ON outreach_messages(org_id) 
  WHERE status = 'pending_approval';

-- Outreach events
CREATE INDEX IF NOT EXISTS idx_outreach_events_message ON outreach_events(message_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_sequence ON outreach_events(sequence_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_guest ON outreach_events(guest_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_type ON outreach_events(event_type);
CREATE INDEX IF NOT EXISTS idx_outreach_events_created ON outreach_events(created_at DESC);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update outreach_sequences.updated_at on change
CREATE OR REPLACE FUNCTION update_outreach_sequences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outreach_sequences_updated_at ON outreach_sequences;
CREATE TRIGGER outreach_sequences_updated_at
  BEFORE UPDATE ON outreach_sequences
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_sequences_updated_at();

-- Update outreach_messages.updated_at on change
DROP TRIGGER IF EXISTS outreach_messages_updated_at ON outreach_messages;
CREATE TRIGGER outreach_messages_updated_at
  BEFORE UPDATE ON outreach_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_sequences_updated_at();

-- Log events when message status changes
CREATE OR REPLACE FUNCTION log_outreach_message_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log on status change
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO outreach_events (
      org_id, message_id, sequence_id, guest_id,
      event_type, event_data, actor_type
    )
    VALUES (
      NEW.org_id,
      NEW.id,
      NEW.sequence_id,
      NEW.guest_id,
      CASE NEW.status
        WHEN 'pending_approval' THEN 'approval_requested'
        WHEN 'approved' THEN 'approved'
        WHEN 'scheduled' THEN 'scheduled'
        WHEN 'sent' THEN 'sent'
        WHEN 'failed' THEN 'failed'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'bounced' THEN 'bounced'
        WHEN 'replied' THEN 'replied'
        ELSE 'message_edited'
      END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      ),
      'system'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outreach_messages_event_log ON outreach_messages;
CREATE TRIGGER outreach_messages_event_log
  AFTER UPDATE ON outreach_messages
  FOR EACH ROW
  EXECUTE FUNCTION log_outreach_message_event();
