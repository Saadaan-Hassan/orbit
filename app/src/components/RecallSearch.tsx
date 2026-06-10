import { useState, useRef, useEffect } from "react";
import { useRecall } from "../hooks/useRecall";

interface RecallSearchProps {
  children?: React.ReactNode;
}

export function RecallSearch({ children }: RecallSearchProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    askOrbit,
    isStreaming,
    currentResponse,
    conversationHistory,
    clearConversation,
    errorMessage,
  } = useRecall();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to the bottom when new content arrives.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory.length, currentResponse]);

  function handleSubmit() {
    const query = inputValue.trim();
    if (!query || isStreaming) return;
    setInputValue("");
    askOrbit(query);
  }

  const hasConversation = conversationHistory.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0 select-none bg-white dark:bg-black">
      {/* ── Scrollable conversation area ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 min-h-0 py-2">
        {/* Show the timeline slot when there is no conversation yet */}
        {!hasConversation && !isStreaming && children}

        {/* Full conversation history rendered as a chat */}
        {conversationHistory.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm leading-relaxed">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={index} className="flex justify-start">
              <div className="max-w-[95%] p-4 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/30 text-sm whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200 font-light select-text">
                {message.content}
              </div>
            </div>
          )
        )}

        {/* Thinking indicator — waiting for the first token */}
        {isStreaming && !currentResponse && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-zinc-400 dark:text-zinc-500 italic">
            <span className="flex h-1.5 w-1.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-400" />
            </span>
            <span>Searching your digital history…</span>
          </div>
        )}

        {/* In-progress streaming response */}
        {isStreaming && currentResponse && (
          <div className="flex justify-start">
            <div className="max-w-[95%] p-4 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/30 text-sm whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200 font-light select-text">
              {currentResponse}
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && !isStreaming && (
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              {errorMessage}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Bottom controls ────────────────────────────────────────────────── */}
      <div className="shrink-0 pt-3 bg-white dark:bg-black flex flex-col gap-2">
        {hasConversation && !isStreaming && (
          <button
            onClick={clearConversation}
            className="self-start text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
          >
            ↺ New conversation
          </button>
        )}

        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="What was I working on before lunch?"
            disabled={isStreaming}
            className="w-full h-11 pl-4 pr-10 bg-zinc-100 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400/20 dark:focus:ring-zinc-500/10 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500 disabled:opacity-50 border-0"
          />
          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isStreaming}
            className="absolute right-2 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-500 cursor-pointer transition-colors"
            title="Send"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
