import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  /** From final.payload.next_actions */
  next_actions?: string[];
  /** From final.payload.assumptions */
  assumptions?: string[];
  isStreaming?: boolean;
}

interface ChatMessageProps {
  message: Message;
  onActionClick?: (action: string) => void;
}

export function ChatMessage({ message, onActionClick }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "flex gap-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {isAssistant && (
        <div className="shrink-0">
          <div className="size-8 rounded-full bg-secondary flex items-center justify-center">
            <Logo className="size-6" />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 max-w-[80%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-secondary"
          )}
        >
          {message.content ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
          ) : message.isStreaming ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          ) : null}
        </div>

        {/* Next Actions */}
        {isAssistant && message.next_actions && message.next_actions.length > 0 && !message.isStreaming && (
          <div className="flex flex-col gap-1.5 pl-1">
            <span className="text-xs text-muted-foreground font-medium">
              Suggested follow-ups:
            </span>
            <ul className="space-y-1">
              {message.next_actions.map((action, index) => (
                <li key={index}>
                  <button
                    onClick={() => onActionClick?.(action)}
                    className="text-sm text-primary hover:underline text-left"
                  >
                    • {action}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {isUser && (
        <div className="shrink-0">
          <Avatar className="size-8">
            <AvatarImage src="/ln.png" alt="User" />
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
        </div>
      )}
    </div>
  );
}
