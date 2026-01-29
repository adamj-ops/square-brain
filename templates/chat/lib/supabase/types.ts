/**
 * Database types for Supabase tables.
 *
 * Tables:
 * - conversations: id, org_id, title, created_at
 * - messages: id, conversation_id, role, content, next_actions (jsonb), created_at
 */

/** Row types for conversations table */
export interface Conversation {
  id: string;
  org_id: string;
  title: string;
  created_at: string;
}

/** Row types for messages table */
export interface DbMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  next_actions: string[] | null;
  created_at: string;
}

/** Insert types */
export interface ConversationInsert {
  id?: string;
  org_id: string;
  title: string;
  created_at?: string;
}

export interface MessageInsert {
  id?: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  next_actions?: string[] | null;
  created_at?: string;
}
