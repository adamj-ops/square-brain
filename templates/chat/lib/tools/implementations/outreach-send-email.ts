/**
 * Tool: outreach.send_email
 *
 * Sends an approved outreach email via Resend.
 * REQUIRES: allowWrites=true AND message must be approved.
 * Pipeline 4: Outreach Automation (Human-in-the-Loop)
 */

import type { ToolDefinition, ToolContext, ToolResponse } from "@/lib/tools/types";
import { getServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@liferx.ai";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "LifeRX Brain";

/**
 * Input args for outreach.send_email
 */
export interface OutreachSendEmailArgs {
  /** Message ID to send */
  message_id: string;
  /** Explicit approval flag - must be true to send */
  approved: boolean;
  /** Optional override recipient (for testing) */
  test_recipient?: string;
}

/**
 * Output from outreach.send_email
 */
export interface OutreachSendEmailResult {
  message_id: string;
  recipient_email: string;
  subject: string;
  status: "sent" | "failed";
  external_id?: string;
  error?: string;
  sent_at?: string;
}

/**
 * Validate input args
 */
function validateArgs(args: unknown): OutreachSendEmailArgs {
  if (!args || typeof args !== "object") {
    throw new Error("args must be an object");
  }

  const raw = args as Record<string, unknown>;

  if (!raw.message_id || typeof raw.message_id !== "string") {
    throw new Error("message_id is required and must be a string");
  }

  if (raw.approved !== true) {
    throw new Error(
      "approved must be explicitly set to true. " +
        "This is a safety check to prevent accidental sends. " +
        "Ensure the message has been reviewed before setting approved=true."
    );
  }

  return {
    message_id: raw.message_id,
    approved: true,
    test_recipient: raw.test_recipient as string | undefined,
  };
}

/**
 * Send email via Resend API
 */
async function sendViaResend(
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml?: string | null
): Promise<{ id: string } | { error: string }> {
  if (!RESEND_API_KEY) {
    return { error: "RESEND_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: [to],
        subject,
        text: bodyText,
        html: bodyHtml || undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        error: `Resend API error: ${response.status} - ${errorData.message || response.statusText}`,
      };
    }

    const data = await response.json();
    return { id: data.id };
  } catch (err) {
    return {
      error: `Network error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Execute the email send
 */
async function run(
  args: OutreachSendEmailArgs,
  ctx: ToolContext
): Promise<ToolResponse<OutreachSendEmailResult>> {
  const orgId = ctx.org_id || DEFAULT_ORG_ID;

  if (!orgId) {
    throw new Error("org_id is required");
  }

  // SAFETY CHECK: allowWrites must be enabled
  if (!ctx.allowWrites) {
    throw new Error(
      "outreach.send_email requires allowWrites=true in the context. " +
        "This is a safety check to prevent accidental sends."
    );
  }

  const supabase = getServiceSupabase();

  // Get the message
  const { data: message, error: fetchError } = await supabase
    .from("outreach_messages")
    .select("*")
    .eq("id", args.message_id)
    .eq("org_id", orgId)
    .single();

  if (fetchError || !message) {
    throw new Error(`Message not found: ${args.message_id}`);
  }

  // SAFETY CHECK: Message must be approved or pending_approval
  const allowedStatuses = ["approved", "pending_approval"];
  if (!allowedStatuses.includes(message.status)) {
    throw new Error(
      `Message status is "${message.status}". ` +
        `Only messages with status "approved" or "pending_approval" can be sent. ` +
        `Status must be one of: ${allowedStatuses.join(", ")}`
    );
  }

  // SAFETY CHECK: Must have recipient
  const recipientEmail = args.test_recipient || message.recipient_email;
  if (!recipientEmail) {
    throw new Error("No recipient email address. Set recipient_email on the message or provide test_recipient.");
  }

  // SAFETY CHECK: Must be email type
  if (message.message_type !== "email") {
    throw new Error(
      `This tool only sends emails. Message type is "${message.message_type}". ` +
        `Use a different method for ${message.message_type} messages.`
    );
  }

  // Update message to "sending" status
  await supabase
    .from("outreach_messages")
    .update({
      status: "sending",
      approved_at: message.approved_at || new Date().toISOString(),
    })
    .eq("id", args.message_id);

  // Send the email
  const sendResult = await sendViaResend(
    recipientEmail,
    message.subject,
    message.body_text,
    message.body_html
  );

  const sentAt = new Date().toISOString();

  if ("error" in sendResult) {
    // Update message to failed status
    await supabase
      .from("outreach_messages")
      .update({
        status: "failed",
        error_message: sendResult.error,
        retry_count: (message.retry_count || 0) + 1,
      })
      .eq("id", args.message_id);

    // Log the failure event
    await supabase.from("outreach_events").insert({
      org_id: orgId,
      message_id: args.message_id,
      sequence_id: message.sequence_id,
      guest_id: message.guest_id,
      event_type: "failed",
      event_data: {
        error: sendResult.error,
        recipient: recipientEmail,
        was_test: !!args.test_recipient,
      },
      actor_type: "system",
    });

    return {
      data: {
        message_id: args.message_id,
        recipient_email: recipientEmail,
        subject: message.subject,
        status: "failed",
        error: sendResult.error,
      },
      explainability: {
        reason: "Email send failed",
        error: sendResult.error,
        recipient: recipientEmail,
        was_test: !!args.test_recipient,
      },
    };
  }

  // Update message to sent status
  await supabase
    .from("outreach_messages")
    .update({
      status: "sent",
      sent_at: sentAt,
      sent_via: "resend",
      external_id: sendResult.id,
    })
    .eq("id", args.message_id);

  // Log the sent event
  await supabase.from("outreach_events").insert({
    org_id: orgId,
    message_id: args.message_id,
    sequence_id: message.sequence_id,
    guest_id: message.guest_id,
    event_type: "sent",
    event_data: {
      external_id: sendResult.id,
      recipient: recipientEmail,
      sent_via: "resend",
      was_test: !!args.test_recipient,
    },
    actor_type: "system",
  });

  // Update guest last_contact_at if this was a real send (not test)
  if (!args.test_recipient && message.guest_id) {
    await supabase
      .from("guests")
      .update({ last_contact_at: sentAt })
      .eq("id", message.guest_id);
  }

  return {
    data: {
      message_id: args.message_id,
      recipient_email: recipientEmail,
      subject: message.subject,
      status: "sent",
      external_id: sendResult.id,
      sent_at: sentAt,
    },
    explainability: {
      reason: "Email sent successfully via Resend",
      external_id: sendResult.id,
      recipient: recipientEmail,
      was_test: !!args.test_recipient,
      sent_via: "resend",
    },
  };
}

/**
 * Tool definition for outreach.send_email
 */
export const outreachSendEmailTool: ToolDefinition<
  OutreachSendEmailArgs,
  OutreachSendEmailResult
> = {
  name: "outreach.send_email",
  description:
    "Send an approved outreach email via Resend. " +
    "SAFETY REQUIREMENTS: " +
    "1) The 'approved' argument must be explicitly set to true. " +
    "2) The tool context must have allowWrites=true. " +
    "3) The message must have status 'approved' or 'pending_approval'. " +
    "Use test_recipient to send to a safe address for testing.",
  writes: true,
  validateArgs,
  run,
};
