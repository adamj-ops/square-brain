-- Migration: 010_outreach_automation.sql
-- Pipeline 4: Outreach Automation (Human-in-the-Loop)
--
-- Creates tables for outreach sequences, messages, and events.
-- Supports multi-channel outreach with human approval requirements.

-- ============================================================================
-- OUTREACH_SEQUENCES TABLE
-- ============================================================================
-- Defines outreach campaigns/sequences

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Sequence identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  
  -- Target
  target_type TEXT NOT NULL DEFAULT 'guest' CHECK (target_type IN (
    'guest',      -- Outreach to potential guests
    'sponsor',    -- Sponsor outreach
    'partner',    -- Partnership outreach
    'audience',   -- Audience engagement
    'custom'
  )),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',      -- Still being designed
    'active',     -- Currently running
    'paused',     -- Temporarily paused
    'completed',  -- Finished
    'archived'    -- No longer active
  )),
  
  -- Sequence configuration
  steps JSONB DEFAULT '[]',  -- Array of { step_number, delay_days, message_template_id, channel }
  max_attempts INTEGER DEFAULT 3,
  cooldown_days INTEGER DEFAULT 30,  -- Days before re-contacting
  
  -- Approval settings
  requires_approval BOOLEAN DEFAULT true,  -- Require human approval before sending
  auto_approve_after_hours INTEGER,        -- Auto-approve if no action in X hours (null = never)
  
  -- Performance tracking
  total_enrolled INTEGER DEFAULT 0,
  total_sent INTEGER DEFAULT 0,
  total_opened INTEGER DEFAULT 0,
  total_replied INTEGER DEFAULT 0,
  total_converted INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT outreach_sequences_org_slug_unique UNIQUE (org_id, slug)
);

-- ============================================================================
-- OUTREACH_MESSAGES TABLE
-- ============================================================================
-- Individual messages in outreach (templates or actual sent messages)

CREATE TABLE IF NOT EXISTS outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- Sequence reference (null for one-off messages)
  sequence_id UUID REFERENCES outreach_sequences(id) ON DELETE SET NULL,
  step_number INTEGER,  -- Step within sequence
  
  -- Recipient
  recipient_type TEXT NOT NULL DEFAULT 'guest' CHECK (recipient_type IN (
    'guest', 'contact', 'email'
  )),
  recipient_id UUID,        -- guest_id if recipient_type = 'guest'
  recipient_email TEXT,     -- Email address
  recipient_name TEXT,      -- Display name
  
  -- Channel
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN (
    'email',
    'linkedin',
    'twitter',
    'instagram',
    'sms',
    'other'
  )),
  
  -- Message content
  subject TEXT,             -- Email subject
  body_text TEXT NOT NULL,  -- Plain text version
  body_html TEXT,           -- HTML version (for email)
  
  -- Personalization
  variables JSONB DEFAULT '{}',  -- Variables used for personalization
  
  -- Status workflow
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',          -- Still being composed
    'pending',        -- Ready, awaiting approval
    'approved',       -- Approved, ready to send
    'scheduled',      -- Scheduled for future send
    'sending',        -- Currently being sent
    'sent',           -- Successfully sent
    'delivered',      -- Confirmed delivery
    'opened',         -- Recipient opened
    'clicked',        -- Link clicked
    'replied',        -- Recipient replied
    'bounced',        -- Delivery failed
    'unsubscribed',   -- Recipient unsubscribed
    'failed',         -- Send failed
    'cancelled'       -- Cancelled before send
  )),
  
  -- Approval tracking
  requires_approval BOOLEAN DEFAULT true,
  approved_by TEXT,         -- User who approved
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  
  -- Scheduling
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  
  -- Delivery tracking
  external_id TEXT,         -- ID from email provider (Resend, SendGrid, etc.)
  delivery_status JSONB DEFAULT '{}',  -- Provider-specific delivery info
  
  -- AI generation metadata
  generated_by TEXT,        -- Model used
  generation_prompt TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- OUTREACH_EVENTS TABLE
-- ============================================================================
-- Event log for all outreach activity

CREATE TABLE IF NOT EXISTS outreach_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  
  -- References
  message_id UUID REFERENCES outreach_messages(id) ON DELETE CASCADE,
  sequence_id UUID REFERENCES outreach_sequences(id) ON DELETE SET NULL,
  
  -- Event type
  event_type TEXT NOT NULL CHECK (event_type IN (
    -- Lifecycle events
    'created',
    'updated',
    'approved',
    'scheduled',
    'sent',
    -- Delivery events
    'delivered',
    'bounced',
    'deferred',
    -- Engagement events
    'opened',
    'clicked',
    'replied',
    'forwarded',
    -- Negative events
    'unsubscribed',
    'complained',
    'blocked',
    -- System events
    'failed',
    'retried',
    'cancelled'
  )),
  
  -- Event details
  event_data JSONB DEFAULT '{}',  -- Event-specific data (link clicked, etc.)
  
  -- Source
  source TEXT,              -- 'webhook', 'api', 'manual', 'system'
  source_ip TEXT,
  user_agent TEXT,
  
  -- Timestamp
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Outreach sequences
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_org_id ON outreach_sequences(org_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_status ON outreach_sequences(status);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_target ON outreach_sequences(target_type);

-- Outreach messages
CREATE INDEX IF NOT EXISTS idx_outreach_messages_org_id ON outreach_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_sequence ON outreach_messages(sequence_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_recipient ON outreach_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_email ON outreach_messages(recipient_email);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_status ON outreach_messages(status);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_scheduled ON outreach_messages(scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_messages_approval ON outreach_messages(status) WHERE status = 'pending' AND requires_approval = true;

-- Outreach events
CREATE INDEX IF NOT EXISTS idx_outreach_events_message ON outreach_events(message_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_sequence ON outreach_events(sequence_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_type ON outreach_events(event_type);
CREATE INDEX IF NOT EXISTS idx_outreach_events_time ON outreach_events(occurred_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update sequences.updated_at on change
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

-- Update messages.updated_at on change
CREATE OR REPLACE FUNCTION update_outreach_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outreach_messages_updated_at ON outreach_messages;
CREATE TRIGGER outreach_messages_updated_at
  BEFORE UPDATE ON outreach_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_messages_updated_at();

-- Log events on message status changes
CREATE OR REPLACE FUNCTION log_outreach_message_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO outreach_events (
      org_id, message_id, sequence_id, event_type, event_data, source
    )
    VALUES (
      NEW.org_id,
      NEW.id,
      NEW.sequence_id,
      CASE NEW.status
        WHEN 'approved' THEN 'approved'
        WHEN 'scheduled' THEN 'scheduled'
        WHEN 'sent' THEN 'sent'
        WHEN 'delivered' THEN 'delivered'
        WHEN 'bounced' THEN 'bounced'
        WHEN 'opened' THEN 'opened'
        WHEN 'clicked' THEN 'clicked'
        WHEN 'replied' THEN 'replied'
        WHEN 'unsubscribed' THEN 'unsubscribed'
        WHEN 'failed' THEN 'failed'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'updated'
      END,
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status),
      'system'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outreach_messages_status_log ON outreach_messages;
CREATE TRIGGER outreach_messages_status_log
  AFTER UPDATE ON outreach_messages
  FOR EACH ROW
  EXECUTE FUNCTION log_outreach_message_status_change();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Create outreach message
CREATE OR REPLACE FUNCTION create_outreach_message(
  p_org_id TEXT,
  p_recipient_email TEXT,
  p_recipient_name TEXT,
  p_subject TEXT,
  p_body_text TEXT,
  p_body_html TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT 'email',
  p_sequence_id UUID DEFAULT NULL,
  p_step_number INTEGER DEFAULT NULL,
  p_recipient_id UUID DEFAULT NULL,
  p_requires_approval BOOLEAN DEFAULT true,
  p_variables JSONB DEFAULT '{}',
  p_generated_by TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_status TEXT;
BEGIN
  -- Set initial status based on approval requirement
  v_status := CASE WHEN p_requires_approval THEN 'pending' ELSE 'approved' END;
  
  INSERT INTO outreach_messages (
    org_id, recipient_email, recipient_name, subject,
    body_text, body_html, channel,
    sequence_id, step_number, recipient_id,
    requires_approval, status, variables, generated_by
  )
  VALUES (
    p_org_id, p_recipient_email, p_recipient_name, p_subject,
    p_body_text, p_body_html, p_channel,
    p_sequence_id, p_step_number, p_recipient_id,
    p_requires_approval, v_status, p_variables, p_generated_by
  )
  RETURNING id INTO v_message_id;
  
  -- Log creation event
  INSERT INTO outreach_events (org_id, message_id, event_type, source)
  VALUES (p_org_id, v_message_id, 'created', 'system');
  
  RETURN v_message_id;
END;
$$;

-- Approve outreach message
CREATE OR REPLACE FUNCTION approve_outreach_message(
  p_message_id UUID,
  p_approved_by TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE outreach_messages
  SET status = 'approved',
      approved_by = p_approved_by,
      approved_at = NOW(),
      approval_notes = p_notes
  WHERE id = p_message_id
    AND status = 'pending';
  
  RETURN FOUND;
END;
$$;

-- Get pending messages for approval
CREATE OR REPLACE FUNCTION get_pending_outreach_messages(
  p_org_id TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  message_id UUID,
  recipient_name TEXT,
  recipient_email TEXT,
  subject TEXT,
  body_preview TEXT,
  created_at TIMESTAMPTZ,
  sequence_name TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id AS message_id,
    m.recipient_name,
    m.recipient_email,
    m.subject,
    LEFT(m.body_text, 200) AS body_preview,
    m.created_at,
    s.name AS sequence_name
  FROM outreach_messages m
  LEFT JOIN outreach_sequences s ON s.id = m.sequence_id
  WHERE m.org_id = p_org_id
    AND m.status = 'pending'
    AND m.requires_approval = true
  ORDER BY m.created_at ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE outreach_sequences IS 'Outreach campaigns/sequences - Pipeline 4: Outreach Automation';
COMMENT ON TABLE outreach_messages IS 'Individual outreach messages with approval workflow';
COMMENT ON TABLE outreach_events IS 'Event log for outreach activity tracking';

COMMENT ON COLUMN outreach_messages.status IS 'Message lifecycle: draft → pending → approved → scheduled → sent → delivered/bounced';
COMMENT ON COLUMN outreach_messages.requires_approval IS 'If true, message must be approved before sending (human-in-the-loop)';
