import { useState } from "react";

const BACKEND_RECALL_URL = "http://localhost:8000/recall";

type RecallStatus = "idle" | "thinking" | "streaming" | "done" | "error";

export function RecallSearch() {
  const [queryInputValue, setQueryInputValue]   = useState("");
  const [recallResponse, setRecallResponse]     = useState("");
  const [recallStatus, setRecallStatus]         = useState<RecallStatus>("idle");

  async function submitQuery() {
    const trimmedQuery = queryInputValue.trim();
    if (!trimmedQuery) return;

    // Reset state for the new query before anything async starts.
    setRecallResponse("");
    setRecallStatus("thinking");

    try {
      const response = await fetch(BACKEND_RECALL_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ query: trimmedQuery }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      setRecallStatus("streaming");

      const streamReader = response.body.getReader();
      const textDecoder  = new TextDecoder();
      let   buffer       = "";

      while (true) {
        const { done: streamDone, value: chunk } = await streamReader.read();
        if (streamDone) break;

        buffer += textDecoder.decode(chunk, { stream: true });

        // SSE lines are separated by double newlines. Process all complete
        // events in the buffer and leave any incomplete line for the next chunk.
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
              setRecallStatus("done");
              return;
            }

            if (typeof parsedEvent.chunk === "string") {
              setRecallResponse((previous) => previous + parsedEvent.chunk);
            }
          } catch {
            // Malformed SSE payload — skip and continue.
          }
        }
      }

      setRecallStatus("done");
    } catch {
      setRecallStatus("error");
      setRecallResponse("Could not reach Orbit backend.");
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") submitQuery();
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Ask Orbit</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={queryInputValue}
          onChange={(e) => setQueryInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What was I working on before lunch?"
          disabled={recallStatus === "thinking" || recallStatus === "streaming"}
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400
                     disabled:opacity-50"
        />
        <button
          onClick={submitQuery}
          disabled={
            !queryInputValue.trim() ||
            recallStatus === "thinking"   ||
            recallStatus === "streaming"
          }
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Ask Orbit
        </button>
      </div>

      {recallStatus === "thinking" && (
        <p className="text-sm text-gray-500 italic">Thinking…</p>
      )}

      {(recallStatus === "streaming" || recallStatus === "done") &&
        recallResponse && (
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-gray-800">
            {recallResponse}
          </div>
        )}

      {recallStatus === "error" && (
        <p className="text-sm text-red-500">{recallResponse}</p>
      )}
    </div>
  );
}
