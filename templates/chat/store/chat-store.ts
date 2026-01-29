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

  // Actions
  selectChat: (chatId: string) => void;
  createNewChat: () => string;
  archiveChat: (chatId: string) => void;
  unarchiveChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  
  // Messaging
  sendMessage: (chatId: string, content: string) => Promise<void>;
  stopGeneration: () => void;
  
  // Internal helpers
  appendMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  selectedChatId: null,
  isGenerating: false,
  abortController: null,

  selectChat: (chatId) => set({ selectedChatId: chatId }),

  createNewChat: () => {
    const newChat: Chat = {
      id: `chat-${Date.now()}`,
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
      selectedChatId: state.selectedChatId === chatId ? null : state.selectedChatId,
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

  sendMessage: async (chatId, content) => {
    const { appendMessage, updateMessage, chats } = get();

    // Find or verify chat exists
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return;

    // Add user message immediately
    const userMessage: Message = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    appendMessage(chatId, userMessage);

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
    const apiMessages = updatedChat?.messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content })) || [];

    let streamedContent = "";

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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled - keep partial content
        updateMessage(chatId, assistantMessageId, {
          isStreaming: false,
        });
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
