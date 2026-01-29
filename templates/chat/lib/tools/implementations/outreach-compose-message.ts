/**
 * Tool: outreach.compose_message
 *
 * Composes and stores an outreach message for approval.
 * This is a write tool - requires allowWrites=true.
 * Messages require human approval before sending.
 *
 * Pipeline 4: Outreach Automation (Human-in-the-Loop)
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Input args for outreach.compose_message
 */
export interface OutreachComposeMessageArgs {
  // Recipient (required)
  recipient_email: string;
  recipient_name: string;

  // Message content (required)
  subject: string;
  body_text: string;
  body_html?: string;

  // Channel
  channel?: 'email' | 'linkedin' | 'twitter' | 'instagram' | 'sms' | 'other';

  // Optional references
  guest_id?: string;
  sequence_id?: string;
  step_number?: number;

  // Personalization variables used
  variables?: Record<string, string>;

  // Scheduling
  scheduled_for?: string;  // ISO date string

  // Whether to require approval (default true for safety)
  requires_approval?: boolean;
}

/**
 * Output from outreach.compose_message
 */
export interface OutreachComposeMessageResult {
  message_id: string;
  status: string;
  requires_approval: boolean;
  recipient_email: string;
  subject: string;
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate input args - throws on invalid
 */
function validateArgs(args: unknown): OutreachComposeMessageArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('Args must be an object');
  }

  const input = args as Record<string, unknown>;

  // Required: recipient_email
  if (!input.recipient_email || typeof input.recipient_email !== 'string') {
    throw new Error('recipient_email is required');
  }
  if (!isValidEmail(input.recipient_email)) {
    throw new Error('recipient_email must be a valid email address');
  }

  // Required: recipient_name
  if (!input.recipient_name || typeof input.recipient_name !== 'string') {
    throw new Error('recipient_name is required');
  }

  // Required: subject
  if (!input.subject || typeof input.subject !== 'string') {
    throw new Error('subject is required');
  }
  if (input.subject.length > 200) {
    throw new Error('subject must be 200 characters or less');
  }

  // Required: body_text
  if (!input.body_text || typeof input.body_text !== 'string') {
    throw new Error('body_text is required');
  }
  if (input.body_text.length > 10000) {
    throw new Error('body_text must be 10000 characters or less');
  }

  // Validate channel if provided
  const validChannels = ['email', 'linkedin', 'twitter', 'instagram', 'sms', 'other'];
  if (input.channel && !validChannels.includes(input.channel as string)) {
    throw new Error(`channel must be one of: ${validChannels.join(', ')}`);
  }

  // Validate scheduled_for if provided
  if (input.scheduled_for) {
    const scheduledDate = new Date(input.scheduled_for as string);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error('scheduled_for must be a valid ISO date string');
    }
    if (scheduledDate < new Date()) {
      throw new Error('scheduled_for must be in the future');
    }
  }

  return {
    recipient_email: (input.recipient_email as string).trim().toLowerCase(),
    recipient_name: (input.recipient_name as string).trim(),
    subject: (input.subject as string).trim(),
    body_text: (input.body_text as string).trim(),
    body_html: input.body_html as string | undefined,
    channel: (input.channel as OutreachComposeMessageArgs['channel']) || 'email',
    guest_id: input.guest_id as string | undefined,
    sequence_id: input.sequence_id as string | undefined,
    step_number: input.step_number as number | undefined,
    variables: input.variables as Record<string, string> | undefined,
    scheduled_for: input.scheduled_for as string | undefined,
    requires_approval: input.requires_approval !== false, // Default true
  };
}

/**
 * Execute the message composition
 */
async function run(
  args: OutreachComposeMessageArgs,
  ctx: ToolContext
): Promise<ToolResponse<OutreachComposeMessageResult>> {
  const supabase = getServiceSupabase();
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  // Determine initial status
  const status = args.requires_approval ? 'pending' : 'approved';

  // If guest_id provided, verify it exists
  if (args.guest_id) {
    const { data: guest } = await supabase
      .from('guests')
      .select('id, name')
      .eq('id', args.guest_id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!guest) {
      throw new Error(`Guest not found: ${args.guest_id}`);
    }
  }

  // If sequence_id provided, verify it exists
  if (args.sequence_id) {
    const { data: sequence } = await supabase
      .from('outreach_sequences')
      .select('id, name')
      .eq('id', args.sequence_id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!sequence) {
      throw new Error(`Outreach sequence not found: ${args.sequence_id}`);
    }
  }

  // Insert the message
  const { data: message, error } = await supabase
    .from('outreach_messages')
    .insert({
      org_id: orgId,
      recipient_email: args.recipient_email,
      recipient_name: args.recipient_name,
      recipient_id: args.guest_id || null,
      recipient_type: args.guest_id ? 'guest' : 'email',
      subject: args.subject,
      body_text: args.body_text,
      body_html: args.body_html || null,
      channel: args.channel || 'email',
      sequence_id: args.sequence_id || null,
      step_number: args.step_number || null,
      variables: args.variables || {},
      status,
      requires_approval: args.requires_approval,
      scheduled_for: args.scheduled_for || null,
      generated_by: 'ai',
    })
    .select('id, status')
    .single();

  if (error) {
    throw new Error(`Failed to create message: ${error.message}`);
  }

  // Log the creation event
  await supabase.from('outreach_events').insert({
    org_id: orgId,
    message_id: message.id,
    sequence_id: args.sequence_id || null,
    event_type: 'created',
    event_data: {
      channel: args.channel || 'email',
      has_html: !!args.body_html,
      scheduled: !!args.scheduled_for,
    },
    source: 'ai',
  });

  return {
    data: {
      message_id: message.id,
      status: message.status,
      requires_approval: args.requires_approval,
      recipient_email: args.recipient_email,
      subject: args.subject,
    },
    explainability: {
      reason: args.requires_approval
        ? 'Message composed and awaiting human approval before sending'
        : 'Message composed and approved (approval not required)',
      org_id: orgId,
      channel: args.channel || 'email',
      has_guest_link: !!args.guest_id,
      has_sequence_link: !!args.sequence_id,
      scheduled: !!args.scheduled_for,
      body_length: args.body_text.length,
    },
  };
}

/**
 * Tool definition for outreach.compose_message
 */
export const outreachComposeMessageTool: ToolDefinition<
  OutreachComposeMessageArgs,
  OutreachComposeMessageResult
> = {
  name: "outreach.compose_message",
  description:
    "Compose an outreach message (email, LinkedIn, etc.) for a recipient. " +
    "By default, messages require human approval before sending (human-in-the-loop). " +
    "Returns the message ID and status. Use outreach.send_email to actually send after approval.",
  writes: true,
  validateArgs,
  run,
};
