import { useEffect, useState } from "react";

const BACKEND_EVENTS_URL = "http://localhost:47821/events?limit=50";
const REFRESH_INTERVAL_MS = 30_000; // Refresh every 30s to keep timeline active

interface CaptureEvent {
  id: string;
  timestamp: number;
  type: string;
  raw_content: string | null;
  app_name: string | null;
  url: string | null;
  source: string;
}

function eventTypeIcon(eventType: string): React.ReactNode {
  switch (eventType) {
    case "clipboard":
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-zinc-400 dark:stroke-zinc-500 fill-none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="12" height="12" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      );
    case "url":
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-zinc-400 dark:stroke-zinc-500 fill-none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
      );
    case "window":
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-zinc-400 dark:stroke-zinc-500 fill-none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="2" y1="10" x2="22" y2="10"></line>
        </svg>
      );
    default:
      return <span className="text-zinc-400 dark:text-zinc-500 font-bold">•</span>;
  }
}

function formatEventTimestamp(timestampMilliseconds: number): string {
  const eventDate = new Date(timestampMilliseconds);
  const today = new Date();

  const isToday =
    eventDate.getDate() === today.getDate() &&
    eventDate.getMonth() === today.getMonth() &&
    eventDate.getFullYear() === today.getFullYear();

  const timeString = eventDate.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return isToday ? timeString : eventDate.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function truncateContent(content: string | null, maxLength: number = 60): string {
  if (!content) return "";
  return content.length > maxLength
    ? content.slice(0, maxLength) + "…"
    : content;
}

export function ActivityTimeline() {
  const [captureEvents, setCaptureEvents] = useState<CaptureEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchEvents() {
    try {
      const response = await fetch(BACKEND_EVENTS_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const eventsData: CaptureEvent[] = await response.json();
      setCaptureEvents(eventsData);
      setFetchError(null);
    } catch {
      setFetchError("Could not load timeline.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchEvents();
    const refreshTimer = setInterval(fetchEvents, REFRESH_INTERVAL_MS);
    return () => clearInterval(refreshTimer);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[11px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">
        Recent Context
      </h3>

      {isLoading && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 animate-pulse">Loading timeline…</p>
      )}

      {fetchError && (
        <p className="text-xs text-red-400 font-medium">{fetchError}</p>
      )}

      {!isLoading && !fetchError && captureEvents.length === 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No activity captured yet.</p>
      )}

      <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
        {captureEvents.map((captureEvent) => (
          <div
            key={captureEvent.id}
            className="flex items-start gap-2.5 text-xs py-2 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10 px-1 rounded-lg transition-colors duration-150"
          >
            {/* Event Icon */}
            <div className="shrink-0 w-5 h-5 flex items-center justify-center select-none" title={captureEvent.type}>
              {eventTypeIcon(captureEvent.type)}
            </div>

            {/* Event Content Details */}
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                  {captureEvent.app_name ?? "System"}
                </span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium select-none whitespace-nowrap">
                  {formatEventTimestamp(captureEvent.timestamp)}
                </span>
              </div>
              <span className="text-zinc-500 dark:text-zinc-400 truncate leading-normal">
                {truncateContent(captureEvent.raw_content)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
