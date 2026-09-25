import { afterEach, describe, expect, it } from "vitest";

import { useOrbitStore } from "./orbitStore";
import { ConversationMessage } from "../types";

const initialState = useOrbitStore.getState();

afterEach(() => {
  useOrbitStore.setState(initialState, true);
});

function message(role: "user" | "assistant", content: string): ConversationMessage {
  // Fixed timestamp — avoids flakiness from Date.now() differing between two
  // calls made microseconds apart when a test builds an "expected" value.
  return { role, content, timestamp: 0 };
}

describe("useOrbitStore.addMessage", () => {
  it("appends messages in order", () => {
    useOrbitStore.getState().addMessage(message("user", "hello"));
    useOrbitStore.getState().addMessage(message("assistant", "hi there"));

    expect(useOrbitStore.getState().conversationHistory).toEqual([
      message("user", "hello"),
      message("assistant", "hi there"),
    ]);
  });

  it("caps history at 8 messages (4 turns) — AGENTS.md: never pass more than 4 turns", () => {
    for (let i = 0; i < 10; i++) {
      useOrbitStore.getState().addMessage(message(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }

    expect(useOrbitStore.getState().conversationHistory).toHaveLength(8);
  });

  it("drops the oldest messages first, keeping the most recent 8", () => {
    for (let i = 0; i < 10; i++) {
      useOrbitStore.getState().addMessage(message(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }

    const contents = useOrbitStore.getState().conversationHistory.map((m) => m.content);
    expect(contents).toEqual(["msg 2", "msg 3", "msg 4", "msg 5", "msg 6", "msg 7", "msg 8", "msg 9"]);
  });
});

describe("useOrbitStore.clearConversation", () => {
  it("empties the conversation history", () => {
    useOrbitStore.getState().addMessage(message("user", "hello"));
    useOrbitStore.getState().clearConversation();

    expect(useOrbitStore.getState().conversationHistory).toEqual([]);
  });
});

describe("useOrbitStore pendingQuery", () => {
  it("sets and clears the pending query", () => {
    useOrbitStore.getState().setPendingQuery("what did I work on yesterday?");
    expect(useOrbitStore.getState().pendingQuery).toBe("what did I work on yesterday?");

    useOrbitStore.getState().clearPendingQuery();
    expect(useOrbitStore.getState().pendingQuery).toBeNull();
  });
});
