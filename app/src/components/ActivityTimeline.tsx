import { useEffect, useState } from "react";

const BACKEND_EVENTS_URL = "http://localhost:8000/events?limit=50";
const REFRESH_INTERVAL_MS = 60_000;

interface CaptureEvent {
  id: string;
  timestamp: number;
  type: string;
  raw_content: string | null;
  app_name: string | null;
  url: string | null;
  source: string;
}

function eventTypeIcon(eventType: string): string {
  switch (eventType) {
    case "clipboard": return "📋";
    case "url":       return "🌐";
    case "window":    return "🪟";
    default:          return "•";
  }
}

function formatEventTimestamp(timestampMilliseconds: number): string {
  const eventDate = new Date(timestampMilliseconds);
  const today = new Date();

  const isToday =
    eventDate.getDate()     === today.getDate()     &&
    eventDate.getMonth()    === today.getMonth()    &&
    eventDate.getFullYear() === today.getFullYear();

  const timeString = eventDate.toLocaleTimeString([], {
    hour:   "2-digit",
    minute: "2-digit",
  });

  return isToday ? `Today ${timeString}` : eventDate.toLocaleDateString([], {
    month: "short",
    day:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

function truncateContent(content: string | null, maxLength: number = 80): string {
  if (!content) return "";
  return content.length > maxLength
    ? content.slice(0, maxLength) + "…"
    : content;
}

export function ActivityTimeline() {
  const [captureEvents, setCaptureEvents] = useState<CaptureEvent[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [fetchError, setFetchError]       = useState<string | null>(null);

  async function fetchEvents() {
    try {
      const response = await fetch(BACKEND_EVENTS_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const eventsData: CaptureEvent[] = await response.json();
      setCaptureEvents(eventsData);
      setFetchError(null);
    } catch (error) {
      setFetchError("Could not reach Orbit backend.");
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
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>

      {isLoading && (
        <p className="text-sm text-gray-500">Loading…</p>
      )}

      {fetchError && (
        <p className="text-sm text-red-500">{fetchError}</p>
      )}

      {!isLoading && !fetchError && captureEvents.length === 0 && (
        <p className="text-sm text-gray-500">No activity captured yet.</p>
      )}

      <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
        {captureEvents.map((captureEvent) => (
          <div
            key={captureEvent.id}
            className="flex items-start gap-2 text-sm py-1 border-b border-gray-100"
          >
            <span className="shrink-0 text-base">
              {eventTypeIcon(captureEvent.type)}
            </span>
            <div className="min-w-0">
              <span className="text-gray-400 text-xs mr-2">
                {formatEventTimestamp(captureEvent.timestamp)}
              </span>
              <span className="font-medium mr-2">
                {captureEvent.app_name ?? "Unknown"}
              </span>
              <span className="text-gray-600">
                {truncateContent(captureEvent.raw_content)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
