import { create } from "zustand";
import { runAssistant, type HubEvent } from "@/lib/brain/stream";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** Suggested follow-up actions from final.payload */
  next_actions?: string[];
  /** Assumptions made during generation from final.payload */
  assumptions?: string[];
  isStreaming?: boolean;
}

export interface Chat {
  id: string;
  /** Database UUID (null for local-only chats before first save) */
  dbId: string | null;
  title: string;
  icon: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  isArchived: boolean;
}

interface ChatState {
  chats: Chat[];
  selectedChatId: string | null;
  isGenerating: boolean;
  abortController: AbortController | null;
  isLoading: boolean;

  // Actions
  selectChat: (chatId: string) => void;
  createNewChat: () => string;
  archiveChat: (chatId: string) => void;
  unarchiveChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;

  // Messaging
  sendMessage: (chatId: string, content: string) => Promise<void>;
  stopGeneration: () => void;

  // Persistence
  loadConversations: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;

  // Internal helpers
  appendMessage: (chatId: string, message: Message) => void;
  updateMessage: (
    chatId: string,
    messageId: string,
    updates: Partial<Message>
  ) => void;
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
}

/**
 * Create a conversation in the database
 */
async function createConversationInDB(title: string): Promise<string | null> {
  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.conversation?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Save a message to the database
 */
async function saveMessageToDB(
  conversationId: string,
  message: { role: "user" | "assistant"; content: string; next_actions?: string[] }
): Promise<void> {
  try {
    await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (err) {
    console.error("Failed to save message:", err);
  }
}

/**
 * Fetch messages for a conversation from the database
 */
async function fetchMessagesFromDB(
  conversationId: string
): Promise<Message[]> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.messages ?? []).map(
      (m: {
        id: string;
        role: "user" | "assistant";
        content: string;
        next_actions: string[] | null;
        created_at: string;
      }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at),
        next_actions: m.next_actions ?? undefined,
      })
    );
  } catch {
    return [];
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  selectedChatId: null,
  isGenerating: false,
  abortController: null,
  isLoading: false,

  selectChat: async (chatId) => {
    set({ selectedChatId: chatId });
    // Load messages if we have a dbId and no messages yet
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat?.dbId && chat.messages.length === 0) {
      await get().loadMessages(chatId);
      // Guard: if user switched away during load, don't update state further
      if (get().selectedChatId !== chatId) return;
    }
  },

  createNewChat: () => {
    const newChat: Chat = {
      id: `chat-${Date.now()}`,
      dbId: null, // Not persisted yet
      title: "New Conversation",
      icon: "message-circle-dashed",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isArchived: false,
    };
    set((state) => ({
      chats: [newChat, ...state.chats],
      selectedChatId: newChat.id,
    }));
    return newChat.id;
  },

  archiveChat: (chatId) =>
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, isArchived: true } : chat
      ),
    })),

  unarchiveChat: (chatId) =>
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, isArchived: false } : chat
      ),
    })),

  deleteChat: (chatId) =>
    set((state) => ({
      chats: state.chats.filter((chat) => chat.id !== chatId),
      selectedChatId:
        state.selectedChatId === chatId ? null : state.selectedChatId,
    })),

  appendMessage: (chatId, message) =>
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [...chat.messages, message],
              updatedAt: new Date(),
            }
          : chat
      ),
    })),

  updateMessage: (chatId, messageId, updates) =>
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: chat.messages.map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg
              ),
              updatedAt: new Date(),
            }
          : chat
      ),
    })),

  updateChat: (chatId, updates) =>
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, ...updates } : chat
      ),
    })),

  loadConversations: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      const conversations = data.conversations ?? [];

      const chats: Chat[] = conversations.map(
        (c: { id: string; title: string; created_at: string }) => ({
          id: `db-${c.id}`,
          dbId: c.id,
          title: c.title,
          icon: "message-circle",
          messages: [], // Load lazily
          createdAt: new Date(c.created_at),
          updatedAt: new Date(c.created_at),
          isArchived: false,
        })
      );

      set({ chats });
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  loadMessages: async (chatId) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat?.dbId) return;

    const messages = await fetchMessagesFromDB(chat.dbId);
    get().updateChat(chatId, { messages });
  },

  sendMessage: async (chatId, content) => {
    const { appendMessage, updateMessage, updateChat, chats } = get();

    // Find or verify chat exists
    let chat = chats.find((c) => c.id === chatId);
    if (!chat) return;

    // Add user message immediately
    const userMessage: Message = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    appendMessage(chatId, userMessage);

    // If this is the first message, create conversation in DB
    let dbId = chat.dbId;
    if (!dbId) {
      // Generate title from first message (truncate to 50 chars)
      const title =
        content.length > 50 ? content.substring(0, 47) + "..." : content;
      dbId = await createConversationInDB(title);
      if (dbId) {
        updateChat(chatId, { dbId, title });
      }
    }

    // Save user message to DB
    if (dbId) {
      await saveMessageToDB(dbId, { role: "user", content });
    }

    // Add pending assistant message
    const assistantMessageId = `msg-${Date.now()}-assistant`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };
    appendMessage(chatId, assistantMessage);

    // Create abort controller
    const abortController = new AbortController();
    set({ isGenerating: true, abortController });

    // Build messages for API
    const updatedChat = get().chats.find((c) => c.id === chatId);
    const apiMessages =
      updatedChat?.messages
        .filter((m) => !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content })) || [];

    let streamedContent = "";
    let finalContent = "";
    let finalNextActions: string[] | undefined;

    try {
      await runAssistant(
        apiMessages,
        (event: HubEvent) => {
          if (event.type === "delta") {
            streamedContent += event.content;
            updateMessage(chatId, assistantMessageId, {
              content: streamedContent,
            });
          } else if (event.type === "final") {
            // Read ALL data from final.payload (canonical contract)
            finalContent = event.payload.content;
            finalNextActions = event.payload.next_actions;
            updateMessage(chatId, assistantMessageId, {
              content: event.payload.content,
              next_actions: event.payload.next_actions,
              assumptions: event.payload.assumptions,
              isStreaming: false,
            });
          }
        },
        abortController.signal
      );

      // Save assistant message to DB after completion
      const currentChat = get().chats.find((c) => c.id === chatId);
      if (currentChat?.dbId && finalContent) {
        await saveMessageToDB(currentChat.dbId, {
          role: "assistant",
          content: finalContent,
          next_actions: finalNextActions,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled - keep partial content
        updateMessage(chatId, assistantMessageId, {
          isStreaming: false,
        });
        // Still save partial response
        const currentChat = get().chats.find((c) => c.id === chatId);
        if (currentChat?.dbId && streamedContent) {
          await saveMessageToDB(currentChat.dbId, {
            role: "assistant",
            content: streamedContent,
          });
        }
      } else {
        // Real error - show error message
        updateMessage(chatId, assistantMessageId, {
          content: "Sorry, something went wrong. Please try again.",
          isStreaming: false,
        });
        console.error("Stream error:", err);
      }
    } finally {
      set({ isGenerating: false, abortController: null });
    }
  },

  stopGeneration: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ isGenerating: false, abortController: null });
    }
  },
}));
