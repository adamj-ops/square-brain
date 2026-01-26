import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { XIcon, PaperclipIcon, Square } from "lucide-react";
import { ChatMessage } from "./chat-message";

interface Message {
  id: string;
  content: string;
  sender: "user" | "ai";
  timestamp: Date;
  next_actions?: string[];
  isStreaming?: boolean;
}

interface ChatConversationViewProps {
  messages: Message[];
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (content: string) => void;
  onReset: () => void;
  onActionClick?: (action: string) => void;
  isGenerating?: boolean;
  onStopGeneration?: () => void;
}

export function ChatConversationView({
  messages,
  message,
  onMessageChange,
  onSend,
  onReset,
  onActionClick,
  isGenerating,
  onStopGeneration,
}: ChatConversationViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-8">
        <div className="max-w-[640px] mx-auto space-y-6">
          <div className="flex justify-end mb-2">
            <Button
              variant="secondary"
              size="icon-sm"
              onClick={onReset}
              className="size-8 rounded-full border"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
          {messages.map((msg) => (
            <ChatMessage 
              key={msg.id} 
              message={{
                ...msg,
                role: msg.sender === "user" ? "user" : "assistant",
              }} 
              onActionClick={onActionClick}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border px-4 md:px-8 py-[17px]">
        <div className="max-w-[640px] mx-auto">
          <div className="rounded-2xl border border-border bg-secondary dark:bg-card p-1">
            <div className="rounded-xl border border-border dark:border-transparent bg-card dark:bg-secondary">
              <Textarea
                placeholder="Continue the conversation..."
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                disabled={isGenerating}
                className="min-h-[80px] resize-none border-0 bg-transparent px-4 py-3 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !isGenerating) {
                    e.preventDefault();
                    if (message.trim()) {
                      onSend(message);
                    }
                  }
                }}
              />

              <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full border border-border dark:border-input bg-card dark:bg-secondary hover:bg-accent"
                  >
                    <PaperclipIcon className="size-4 text-muted-foreground" />
                  </Button>
                </div>

                {isGenerating ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={onStopGeneration}
                    className="h-7 px-4 gap-2"
                  >
                    <Square className="size-3 fill-current" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (message.trim()) {
                        onSend(message);
                      }
                    }}
                    className="h-7 px-4"
                  >
                    Send
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
