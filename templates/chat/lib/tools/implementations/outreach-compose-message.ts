/**
 * Tool: outreach.compose_message
 *
 * Composes an outreach message for a guest or prospect.
 * Messages require human approval before sending.
 * Pipeline 4: Outreach Automation (Human-in-the-Loop)
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

/**
 * Input args for outreach.compose_message
 */
export interface OutreachComposeMessageArgs {
  /** Guest ID to send to */
  guest_id: string;
  /** Email subject line */
  subject: string;
  /** Plain text body */
  body_text: string;
  /** HTML body (optional) */
  body_html?: string;
  /** Message type */
  message_type?: "email" | "linkedin" | "twitter_dm";
  /** Outreach sequence ID (optional) */
  sequence_id?: string;
  /** Step number in sequence */
  step_number?: number;
  /** Schedule for future send */
  scheduled_for?: string;
  /** Immediately request approval */
  request_approval?: boolean;
}

/**
 * Output from outreach.compose_message
 */
export interface OutreachComposeMessageResult {
  message_id: string;
  guest_id: string;
  guest_name: string;
  recipient_email: string | null;
  subject: string;
  status: string;
  requires_approval: boolean;
  scheduled_for: string | null;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): OutreachComposeMessageArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.guest_id || typeof raw.guest_id !== "string") {
    throw new Error("guest_id is required and must be a string");
  }

  if (!raw.subject || typeof raw.subject !== "string") {
    throw new Error("subject is required and must be a string");
  }

  if (raw.subject.length > 200) {
    throw new Error("subject must be at most 200 characters");
  }

  if (!raw.body_text || typeof raw.body_text !== "string") {
    throw new Error("body_text is required and must be a string");
  }

  if (raw.body_text.length > 10000) {
    throw new Error("body_text must be at most 10000 characters");
  }

  return {
    guest_id: raw.guest_id,
    subject: raw.subject,
    body_text: raw.body_text,
    body_html: raw.body_html as string | undefined,
    message_type: (raw.message_type as "email" | "linkedin" | "twitter_dm") || "email",
    sequence_id: raw.sequence_id as string | undefined,
    step_number: raw.step_number !== undefined ? Number(raw.step_number) : 1,
    scheduled_for: raw.scheduled_for as string | undefined,
    request_approval: raw.request_approval === true,
  };
}

/**
 * Execute the message composition
 */
async function run(
  args: OutreachComposeMessageArgs,
  ctx: ToolContext
): Promise<ToolResponse<OutreachComposeMessageResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  const supabase = getServiceSupabase();

  // Get guest details
  const { data: guest } = await supabase
    .from("guests")
    .select("id, name, email")
    .eq("id", args.guest_id)
    .eq("org_id", orgId)
    .single();

  if (!guest) {
    throw new Error(`Guest not found: ${args.guest_id}`);
  }

  // Verify sequence if provided
  if (args.sequence_id) {
    const { data: sequence } = await supabase
      .from("outreach_sequences")
      .select("id")
      .eq("id", args.sequence_id)
      .eq("org_id", orgId)
      .single();

    if (!sequence) {
      throw new Error(`Sequence not found: ${args.sequence_id}`);
    }
  }

  // Determine initial status
  let status = "draft";
  if (args.request_approval) {
    status = "pending_approval";
  }

  // Parse scheduled_for if provided
  let scheduledFor: string | null = null;
  if (args.scheduled_for) {
    const parsed = new Date(args.scheduled_for);
    if (isNaN(parsed.getTime())) {
      throw new Error("scheduled_for must be a valid date string");
    }
    scheduledFor = parsed.toISOString();
  }

  // Create the message
  const { data: message, error } = await supabase
    .from("outreach_messages")
    .insert({
      org_id: orgId,
      sequence_id: args.sequence_id,
      guest_id: args.guest_id,
      message_type: args.message_type || "email",
      recipient_email: guest.email,
      recipient_name: guest.name,
      subject: args.subject,
      body_text: args.body_text,
      body_html: args.body_html,
      step_number: args.step_number || 1,
      status,
      scheduled_for: scheduledFor,
    })
    .select("id, status")
    .single();

  if (error || !message) {
    throw new Error(`Failed to create message: ${error?.message}`);
  }

  // Log the creation event
  await supabase.from("outreach_events").insert({
    org_id: orgId,
    message_id: message.id,
    sequence_id: args.sequence_id,
    guest_id: args.guest_id,
    event_type: "message_created",
    event_data: {
      subject: args.subject,
      message_type: args.message_type || "email",
      request_approval: args.request_approval,
    },
    actor_type: "system",
  });

  return {
    data: {
      message_id: message.id,
      guest_id: args.guest_id,
      guest_name: guest.name,
      recipient_email: guest.email,
      subject: args.subject,
      status: message.status,
      requires_approval: true, // All messages require approval
      scheduled_for: scheduledFor,
    },
    explainability: {
      message_type: args.message_type || "email",
      has_html: !!args.body_html,
      body_length: args.body_text.length,
      is_scheduled: !!scheduledFor,
      approval_requested: args.request_approval || false,
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
    "Compose an outreach message for a guest or prospect. " +
    "Messages are created as drafts and require human approval before sending. " +
    "Set request_approval=true to immediately queue for approval. " +
    "Use scheduled_for to schedule future sends (still requires approval).",
  writes: true,
  validateArgs,
  run,
};
