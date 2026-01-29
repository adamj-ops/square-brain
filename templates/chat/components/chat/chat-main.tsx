"use client";

import { useState, useEffect } from "react";
import { ChatWelcomeScreen } from "./chat-welcome-screen";
import { ChatConversationView } from "./chat-conversation-view";
import { useChatStore } from "@/store/chat-store";

export function ChatMain() {
  const [message, setMessage] = useState("");
  const [selectedMode, setSelectedMode] = useState("fast");
  const [selectedModel, setSelectedModel] = useState("brain-standard");

  const {
    chats,
    selectedChatId,
    isGenerating,
    createNewChat,
    sendMessage,
    stopGeneration,
  } = useChatStore();

  const currentChat = chats.find((c) => c.id === selectedChatId);
  const messages = currentChat?.messages || [];
  const isConversationStarted = messages.length > 0;

  const handleSend = async () => {
    if (!message.trim()) return;

    let chatId = selectedChatId;
    
    // Create new chat if none selected
    if (!chatId) {
      chatId = createNewChat();
    }

    const content = message;
    setMessage("");
    
    await sendMessage(chatId, content);
  };

  const handleReset = () => {
    useChatStore.setState({ selectedChatId: null });
    setMessage("");
  };

  const handleSendMessage = async (content: string) => {
    if (!selectedChatId) return;
    setMessage("");
    await sendMessage(selectedChatId, content);
  };

  const handleActionClick = async (action: string) => {
    if (!selectedChatId) return;
    await sendMessage(selectedChatId, action);
  };

  // Map messages to the format expected by ChatConversationView
  // All payload fields from final.payload are passed through
  const mappedMessages = messages.map((m) => ({
    id: m.id,
    content: m.content,
    sender: m.role === "user" ? "user" as const : "ai" as const,
    timestamp: m.timestamp,
    next_actions: m.next_actions,
    assumptions: m.assumptions,
    isStreaming: m.isStreaming,
  }));

  if (isConversationStarted) {
    return (
      <ChatConversationView
        messages={mappedMessages}
        message={message}
        onMessageChange={setMessage}
        onSend={handleSendMessage}
        onReset={handleReset}
        onActionClick={handleActionClick}
        isGenerating={isGenerating}
        onStopGeneration={stopGeneration}
      />
    );
  }

  return (
    <ChatWelcomeScreen
      message={message}
      onMessageChange={setMessage}
      onSend={handleSend}
      selectedMode={selectedMode}
      onModeChange={setSelectedMode}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
    />
  );
}
