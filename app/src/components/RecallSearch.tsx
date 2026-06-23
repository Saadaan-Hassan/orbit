import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRecall } from "../hooks/useRecall";
import { useOrbitStore } from "../store/orbitStore";
import { ProjectCards } from "./ProjectCards";

const RECALL_RESPONSE_PROSE_CLASSES =
  "prose prose-sm prose-zinc dark:prose-invert max-w-none " +
  "prose-p:leading-relaxed prose-p:my-1.5 " +
  "prose-headings:font-semibold prose-headings:my-2 " +
  "prose-h1:text-base prose-h2:text-sm prose-h3:text-sm " +
  "prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100 " +
  "prose-code:text-xs prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 " +
  "prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono " +
  "prose-code:before:content-none prose-code:after:content-none " +
  "prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800/80 prose-pre:rounded-lg prose-pre:overflow-x-auto " +
  "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 " +
  "prose-hr:border-zinc-200 dark:prose-hr:border-zinc-700 prose-hr:my-3 " +
  "prose-a:text-blue-600 dark:prose-a:text-blue-400";

export function RecallSearch() {
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

  const { pendingQuery, clearPendingQuery } = useOrbitStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // When Timeline's "Ask Orbit about this" sets a pending query, submit it
  // automatically and clear it so it doesn't fire again on the next render.
  useEffect(() => {
    if (pendingQuery && !isStreaming) {
      const queryToSubmit = pendingQuery;
      clearPendingQuery();
      askOrbit(queryToSubmit);
    }
  }, [pendingQuery]);

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
  // True while the user has text in the input — used to fade out project cards.
  const isTyping = inputValue.length > 0;

  const EXAMPLE_QUERIES = [
    "What was I reading yesterday?",
    "What code was I working on this morning?",
    "What did I search for this week?",
  ];

  function handleChipClick(query: string): void {
    setInputValue(query);
    askOrbit(query);
  }

  return (
    <div className="flex flex-col h-full min-h-0 select-none bg-white dark:bg-black">
      {/* ── Scrollable conversation area ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 min-h-0 py-2">
        {/* Project cards dashboard — shown when no conversation has started.
            Fades out as the user types; hidden entirely once a conversation exists. */}
        {!hasConversation && !isStreaming && (
          <ProjectCards
            isVisible={!isTyping}
            onPrefill={(query) => {
              setInputValue(query);
              inputRef.current?.focus();
            }}
            onSubmit={(query) => {
              setInputValue("");
              askOrbit(query);
            }}
          />
        )}



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
              <div className="max-w-[95%] px-4 py-3 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/30 select-text">
                <div className={RECALL_RESPONSE_PROSE_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
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

        {/* In-progress streaming response — same ReactMarkdown rendering as
            completed messages. Partial markdown syntax (e.g. a lone ** before
            its closing ** arrives) resolves naturally as more tokens stream in. */}
        {isStreaming && currentResponse && (
          <div className="flex justify-start">
            <div className="max-w-[95%] px-4 py-3 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/30 select-text">
              <div className={RECALL_RESPONSE_PROSE_CLASSES}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentResponse}
                </ReactMarkdown>
              </div>
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

        {/* Example chips — only before the first query */}
        {!hasConversation && !isStreaming && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {EXAMPLE_QUERIES.map((query) => (
              <button
                key={query}
                onClick={() => handleChipClick(query)}
                className="px-2.5 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors cursor-pointer font-medium"
              >
                {query}
              </button>
            ))}
          </div>
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
