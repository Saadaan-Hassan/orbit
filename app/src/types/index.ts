export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number; // Unix ms — used for display and ordering
};
