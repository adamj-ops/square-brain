export type HubEvent =
  | { type: "delta"; content: string }
  | {
      type: "final";
      payload: {
        agent: "Brain";
        content: string;
        next_actions: string[];
      };
    };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
