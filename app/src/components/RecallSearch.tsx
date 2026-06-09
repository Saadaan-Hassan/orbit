import { useState, useRef, useEffect } from "react";
import { useAnalytics } from "../hooks/useAnalytics";

const BACKEND_RECALL_URL = "http://localhost:47821/recall";

type RecallStatus = "idle" | "thinking" | "streaming" | "done" | "error";

// Classify the raw error into a user-facing message.
function classifyRecallError(rawError: unknown): string {
  const message = rawError instanceof Error ? rawError.message.toLowerCase() : "";
  if (
    message.includes("connect") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror")
  ) {
    return "Orbit's AI isn't reachable right now. Check your internet connection.";
  }
  return "Couldn't get an answer. Try again in a moment.";
}

interface RecallSearchProps {
  children?: React.ReactNode;
}

export function RecallSearch({ children }: RecallSearchProps) {
  const [queryInputValue, setQueryInputValue] = useState("");
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState("");
  const [recallResponse, setRecallResponse] = useState("");
  const [recallStatus, setRecallStatus] = useState<RecallStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { captureEvent } = useAnalytics();

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submitQuery(queryOverride?: string) {
    const trimmedQuery = (queryOverride ?? queryInputValue).trim();
    if (!trimmedQuery) return;

    captureEvent("recall_query_submitted"); // no query text — privacy
    setLastSubmittedQuery(trimmedQuery);
    setRecallResponse("");
    setErrorMessage("");
    setRecallStatus("thinking");

    try {
      const response = await fetch(BACKEND_RECALL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuery }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      setRecallStatus("streaming");

      const streamReader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let buffer = "";
      let receivedAnyChunk = false;

      while (true) {
        const { done: streamDone, value: chunk } = await streamReader.read();
        if (streamDone) break;

        buffer += textDecoder.decode(chunk, { stream: true });

        const sseLines = buffer.split("\n\n");
        buffer = sseLines.pop() ?? "";

        for (const sseLine of sseLines) {
          const dataPrefix = "data: ";
          if (!sseLine.startsWith(dataPrefix)) continue;

          const rawJsonPayload = sseLine.slice(dataPrefix.length).trim();
          if (!rawJsonPayload) continue;

          try {
            const parsedEvent = JSON.parse(rawJsonPayload);

            if (parsedEvent.done === true) {
              if (!receivedAnyChunk) {
                // Stream completed but sent no content — no sessions yet
                setRecallStatus("error");
                setErrorMessage(
                  "Orbit is still learning your patterns. Use your computer normally for 30–60 minutes, then ask again."
                );
                return;
              }
              setRecallStatus("done");
              return;
            }

            if (typeof parsedEvent.chunk === "string") {
              receivedAnyChunk = true;
              setRecallResponse((previous) => previous + parsedEvent.chunk);
            }
          } catch {
            // Malformed chunk — skip
          }
        }
      }

      if (!receivedAnyChunk) {
        setRecallStatus("error");
        setErrorMessage(
          "Orbit is still learning your patterns. Use your computer normally for 30–60 minutes, then ask again."
        );
        return;
      }

      setRecallStatus("done");
    } catch (rawError) {
      setRecallStatus("error");
      setErrorMessage(classifyRecallError(rawError));
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") submitQuery();
  }

  function handleRetry() {
    submitQuery(lastSubmittedQuery);
  }

  return (
    <div className="flex flex-col h-full min-h-0 select-none bg-white dark:bg-black">
      {/* Scrollable history and responses */}
      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4 min-h-0">
        {recallStatus === "idle" && children}

        {/* Thinking indicator */}
        {recallStatus === "thinking" && (
          <div className="flex items-center gap-2 px-1 py-4 text-xs text-zinc-400 dark:text-zinc-500 italic">
            <span className="flex h-1.5 w-1.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-400" />
            </span>
            <span>Searching your digital history…</span>
          </div>
        )}

        {/* Results Box */}
        {(recallStatus === "streaming" || recallStatus === "done") && recallResponse && (
          <div className="flex flex-col gap-2 py-2">
            <h3 className="text-[11px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-500">
              Recall Answer
            </h3>
            <div className="p-4 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/30 text-sm whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200 font-light select-text">
              {recallResponse}
            </div>
          </div>
        )}

        {/* Error state */}
        {recallStatus === "error" && (
          <div className="flex flex-col gap-3 py-2">
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 flex flex-col gap-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {errorMessage}
              </p>
            </div>
            <button
              onClick={handleRetry}
              className="self-start px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-all cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        {/* Show timeline under results when search is complete */}
        {recallStatus !== "idle" && recallStatus !== "thinking" && (
          <div className="mt-4 pt-4">
            {children}
          </div>
        )}
      </div>

      {/* Input region always at the bottom */}
      <div className="pt-3 bg-white dark:bg-black shrink-0">
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={queryInputValue}
            onChange={(e) => setQueryInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What was I working on before lunch?"
            disabled={recallStatus === "thinking" || recallStatus === "streaming"}
            className="w-full h-11 pl-4 pr-10 bg-zinc-100 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400/20 dark:focus:ring-zinc-500/10 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500 disabled:opacity-50 border-0"
          />
          <button
            onClick={() => submitQuery()}
            disabled={
              !queryInputValue.trim() ||
              recallStatus === "thinking" ||
              recallStatus === "streaming"
            }
            className="absolute right-2 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-500 cursor-pointer transition-colors"
            title="Send query"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
