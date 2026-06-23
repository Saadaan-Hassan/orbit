import { create } from "zustand";
import { ConversationMessage } from "../types";

// 4 turns = 8 messages (1 user + 1 assistant per turn).
// Older messages are dropped from the front to keep the token cost bounded.
const MAX_MESSAGES = 8;

interface OrbitState {
  conversationHistory: ConversationMessage[];
  addMessage: (message: ConversationMessage) => void;
  clearConversation: () => void;
  // Set by Timeline "Ask Orbit about this" button; cleared by RecallSearch after submission.
  pendingQuery: string | null;
  setPendingQuery: (query: string) => void;
  clearPendingQuery: () => void;
}

export const useOrbitStore = create<OrbitState>((set) => ({
  conversationHistory: [],

  addMessage: (message) =>
    set((state) => {
      const updated = [...state.conversationHistory, message];
      const trimmed =
        updated.length > MAX_MESSAGES
          ? updated.slice(updated.length - MAX_MESSAGES)
          : updated;
      return { conversationHistory: trimmed };
    }),

  clearConversation: () => set({ conversationHistory: [] }),

  pendingQuery: null,
  setPendingQuery: (query) => set({ pendingQuery: query }),
  clearPendingQuery: () => set({ pendingQuery: null }),
}));
