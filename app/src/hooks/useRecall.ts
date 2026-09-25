import { useState } from "react";
import { useOrbitStore } from "../store/orbitStore";

import { orbitApiFetch } from "@/lib/local-api";

function classifyNetworkError(rawError: unknown): string {
  const message = rawError instanceof Error ? rawError.message.toLowerCase() : "";
  const isNetworkFailure =
    message.includes("connect") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror");
  return isNetworkFailure
    ? "Orbit's AI isn't reachable right now. Check your internet connection."
    : "Couldn't get an answer. Try again in a moment.";
}

export function useRecall() {
  const [currentResponse, setCurrentResponse] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const { conversationHistory, addMessage, clearConversation: clearStore } = useOrbitStore();

  // Exposed clearConversation also resets local streaming state so the UI
  // returns to a clean idle after the user starts a new topic.
  function clearConversation() {
    clearStore();
    setCurrentResponse("");
    setIsStreaming(false);
    setErrorMessage("");
  }

  async function askOrbit(query: string): Promise<void> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isStreaming) return;

    // Snapshot prior turns BEFORE adding the new user message so we don't
    // send the current question twice (it also arrives in the query field).
    // Strip timestamp — Claude's messages API only accepts {role, content}.
    const historySnapshot = conversationHistory.map(({ role, content }) => ({
      role,
      content,
    }));

    // Step 1: add the user turn immediately so it renders before the stream starts.
    addMessage({ role: "user", content: trimmedQuery, timestamp: Date.now() });

    setCurrentResponse("");
    setErrorMessage("");
    setIsStreaming(true);

    try {
      const fetchResponse = await orbitApiFetch("/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmedQuery,
          conversation_history: historySnapshot,
        }),
      });

      if (!fetchResponse.ok || !fetchResponse.body) {
        throw new Error(`HTTP ${fetchResponse.status}`);
      }

      const streamReader = fetchResponse.body.getReader();
      const textDecoder = new TextDecoder();
      let sseBuffer = "";
      let receivedAnyChunk = false;
      let fullAssistantResponse = "";

      while (true) {
        const { done: streamDone, value: chunk } = await streamReader.read();
        if (streamDone) break;

        sseBuffer += textDecoder.decode(chunk, { stream: true });

        const sseLines = sseBuffer.split("\n\n");
        sseBuffer = sseLines.pop() ?? "";

        for (const sseLine of sseLines) {
          if (!sseLine.startsWith("data: ")) continue;

          const rawJson = sseLine.slice("data: ".length).trim();
          if (!rawJson) continue;

          try {
            const event = JSON.parse(rawJson);

            if (event.done === true) {
              if (!receivedAnyChunk) {
                setErrorMessage(
                  "Orbit is still learning your patterns. Use your computer normally for 30–60 minutes, then ask again."
                );
                setIsStreaming(false);
                return;
              }
              // Step 4: persist the completed assistant turn.
              addMessage({
                role: "assistant",
                content: fullAssistantResponse,
                timestamp: Date.now(),
              });
              setCurrentResponse("");
              setIsStreaming(false);
              return;
            }

            if (typeof event.chunk === "string") {
              receivedAnyChunk = true;
              fullAssistantResponse += event.chunk;
              setCurrentResponse((prev) => prev + event.chunk);
            }
          } catch {
            // Malformed SSE chunk — skip silently
          }
        }
      }

      // Stream ended without the sentinel — treat as completion if we got tokens.
      if (receivedAnyChunk) {
        addMessage({
          role: "assistant",
          content: fullAssistantResponse,
          timestamp: Date.now(),
        });
        setCurrentResponse("");
        setIsStreaming(false);
      } else {
        setErrorMessage(
          "Orbit is still learning your patterns. Use your computer normally for 30–60 minutes, then ask again."
        );
        setIsStreaming(false);
      }
    } catch (rawError) {
      setErrorMessage(classifyNetworkError(rawError));
      setIsStreaming(false);
    }
  }

  return {
    askOrbit,
    isStreaming,
    currentResponse,
    conversationHistory,
    clearConversation,
    errorMessage,
  };
}
