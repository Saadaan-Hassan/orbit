import { useState } from "react";
import {
  useMemoryData,
  type EventTypeFilter,
  type MemoryEvent,
  type MemorySession,
  type SessionSummaryJson,
} from "../hooks/useMemoryData";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const today = new Date();
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const timeString = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return isToday
    ? `Today ${timeString}`
    : date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

// Returns a plain date string used as a group header, e.g. "Jun 7, 2026".
function formatDateGroup(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(startMs: number, endMs: number): string {
  const totalMinutes = Math.round((endMs - startMs) / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function truncate(text: string | null, maxLength = 80): string {
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

function eventTypeIcon(type: string): string {
  switch (type) {
    case "clipboard": return "📋";
    case "url":       return "🌐";
    case "window":    return "🪟";
    default:          return "•";
  }
}

function parseSummaryJson(rawJson: string | null): SessionSummaryJson | null {
  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson) as SessionSummaryJson;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function TrashButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-gray-300 hover:text-red-500 transition-colors shrink-0
                 text-sm leading-none p-1"
    >
      🗑
    </button>
  );
}

interface DeleteConfirmProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ isOpen, onConfirm, onCancel }: DeleteConfirmProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl p-5 max-w-xs w-full mx-4">
        <p className="text-sm font-semibold text-gray-900 mb-1">
          Delete this session?
        </p>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          The session summary will be deleted. The raw events will be kept but
          unlinked from this session.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200
                       text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white
                       hover:bg-red-700 transition-colors font-medium"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events tab
// ---------------------------------------------------------------------------

interface EventsTabProps {
  events: MemoryEvent[];
  totalEvents: number;
  eventsTypeFilter: EventTypeFilter;
  hasMoreEvents: boolean;
  isLoadingEvents: boolean;
  onFilterChange: (filter: EventTypeFilter) => void;
  onLoadMore: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const EVENT_FILTER_OPTIONS: { label: string; value: EventTypeFilter }[] = [
  { label: "All",       value: "all"       },
  { label: "Clipboard", value: "clipboard" },
  { label: "Window",    value: "window"    },
  { label: "Browser",   value: "url"       },
];

function EventsTab({
  events,
  totalEvents,
  eventsTypeFilter,
  hasMoreEvents,
  isLoadingEvents,
  onFilterChange,
  onLoadMore,
  onDelete,
}: EventsTabProps) {
  const [loadingMore, setLoadingMore] = useState(false);

  async function handleLoadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  }

  // Group events by calendar date for the section headers.
  const eventsByDate = events.reduce<Record<string, MemoryEvent[]>>(
    (accumulator, event) => {
      const dateKey = formatDateGroup(event.timestamp);
      if (!accumulator[dateKey]) accumulator[dateKey] = [];
      accumulator[dateKey].push(event);
      return accumulator;
    },
    {}
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-100 shrink-0">
        {EVENT_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onFilterChange(option.value)}
            className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
              eventsTypeFilter === option.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">
          {totalEvents} total
        </span>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {isLoadingEvents && events.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
        )}
        {!isLoadingEvents && events.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">
            No events found.
          </p>
        )}

        {Object.entries(eventsByDate).map(([dateLabel, dateEvents]) => (
          <div key={dateLabel} className="mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide
                          py-1 sticky top-0 bg-white">
              {dateLabel}
            </p>
            <div className="flex flex-col gap-0.5">
              {dateEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-2 py-1.5 px-2 rounded-lg
                             hover:bg-gray-50 group transition-colors"
                >
                  <span className="text-base shrink-0 mt-0.5">
                    {eventTypeIcon(event.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-medium text-gray-800">
                        {event.app_name ?? "Unknown"}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {truncate(event.raw_content)}
                    </p>
                  </div>
                  <TrashButton
                    onClick={() => onDelete(event.id)}
                    label={`Delete event from ${event.app_name}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        {hasMoreEvents && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full py-2 text-xs text-blue-600 hover:text-blue-800
                       disabled:opacity-50 transition-colors font-medium"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions tab
// ---------------------------------------------------------------------------

interface SessionsTabProps {
  sessions: MemorySession[];
  totalSessions: number;
  hasMoreSessions: boolean;
  isLoadingSessions: boolean;
  onLoadMore: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface SessionRowProps {
  session: MemorySession;
  onDelete: (id: string) => Promise<void>;
}

function SessionRow({ session, onDelete }: SessionRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const parsedSummary = parseSummaryJson(session.ai_summary);

  async function handleConfirmDelete(): Promise<void> {
    setShowDeleteConfirm(false);
    await onDelete(session.id);
  }

  const durationLabel = formatDuration(session.start_time, session.end_time);
  const startLabel = formatTimestamp(session.start_time);

  return (
    <>
      <div className="border border-gray-100 rounded-xl mb-2 overflow-hidden">
        {/* Session header row */}
        <div className="flex items-start gap-2 p-3">
          <button
            onClick={() => setIsExpanded((previous) => !previous)}
            aria-label={isExpanded ? "Collapse session" : "Expand session"}
            className="text-gray-400 hover:text-gray-600 transition-colors
                       text-xs mt-0.5 shrink-0"
          >
            {isExpanded ? "▾" : "▸"}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">
                {session.project_name ?? "Unnamed session"}
              </span>
              {/* Event count badge */}
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5
                               rounded-full font-medium shrink-0">
                {session.event_count} event{session.event_count !== 1 ? "s" : ""}
              </span>
              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5
                               rounded-full font-medium shrink-0">
                {durationLabel}
              </span>
            </div>
            {session.goal && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {session.goal}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{startLabel}</p>
          </div>

          <TrashButton
            onClick={() => setShowDeleteConfirm(true)}
            label={`Delete session ${session.project_name}`}
          />
        </div>

        {/* Expanded summary */}
        {isExpanded && parsedSummary && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3
                          text-xs text-gray-700 space-y-2">
            {parsedSummary.summary && (
              <p className="leading-relaxed">{parsedSummary.summary}</p>
            )}
            {parsedSummary.key_resources &&
              parsedSummary.key_resources.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-500 mb-1">Had open:</p>
                  <ul className="space-y-0.5">
                    {parsedSummary.key_resources.map((resource, index) => (
                      <li key={index} className="flex items-start gap-1">
                        <span className="text-gray-400">→</span>
                        <span className="break-all">{resource}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            {parsedSummary.last_action && (
              <p>
                <span className="font-semibold text-gray-500">Last action: </span>
                {parsedSummary.last_action}
              </p>
            )}
          </div>
        )}

        {/* Raw JSON fallback when summary isn't in the expected shape */}
        {isExpanded && !parsedSummary && session.ai_summary && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
            <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all">
              {session.ai_summary}
            </pre>
          </div>
        )}
      </div>

      <DeleteConfirm
        isOpen={showDeleteConfirm}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}

function SessionsTab({
  sessions,
  totalSessions,
  hasMoreSessions,
  isLoadingSessions,
  onLoadMore,
  onDelete,
}: SessionsTabProps) {
  const [loadingMore, setLoadingMore] = useState(false);

  async function handleLoadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 shrink-0">
        <span className="text-xs text-gray-400">{totalSessions} sessions generated</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoadingSessions && sessions.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
        )}
        {!isLoadingSessions && sessions.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">
            No sessions yet. Sessions are generated every 30 minutes.
          </p>
        )}

        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} onDelete={onDelete} />
        ))}

        {hasMoreSessions && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full py-2 text-xs text-blue-600 hover:text-blue-800
                       disabled:opacity-50 transition-colors font-medium"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback bar
// ---------------------------------------------------------------------------

interface FeedbackBarProps {
  onSubmit: (
    rating: "positive" | "negative",
    comment: string | null,
    context: string | null
  ) => Promise<void>;
}

function FeedbackBar({ onSubmit }: FeedbackBarProps) {
  const [selectedRating, setSelectedRating] = useState<
    "positive" | "negative" | null
  >(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleRatingClick(rating: "positive" | "negative"): void {
    // Second click on the same rating closes the form.
    setSelectedRating((previous) =>
      previous === rating ? null : rating
    );
    setSubmitted(false);
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedRating) return;
    setIsSubmitting(true);
    try {
      await onSubmit(selectedRating, comment.trim() || null, null);
      setSubmitted(true);
      setSelectedRating(null);
      setComment("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="border-t border-gray-100 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">How's Orbit's memory?</span>
        <button
          onClick={() => handleRatingClick("positive")}
          className={`text-base transition-opacity ${
            selectedRating === "positive" ? "opacity-100" : "opacity-40 hover:opacity-80"
          }`}
          aria-label="Positive feedback"
        >
          👍
        </button>
        <button
          onClick={() => handleRatingClick("negative")}
          className={`text-base transition-opacity ${
            selectedRating === "negative" ? "opacity-100" : "opacity-40 hover:opacity-80"
          }`}
          aria-label="Negative feedback"
        >
          👎
        </button>
        {submitted && (
          <span className="text-xs text-green-600 font-medium ml-1">
            Thanks!
          </span>
        )}
      </div>

      {selectedRating !== null && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit();
            }}
            placeholder="Optional comment…"
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5
                       focus:outline-none focus:ring-1 focus:ring-blue-400
                       placeholder-gray-400"
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryViewer — root export
// ---------------------------------------------------------------------------

type MemoryTab = "events" | "sessions";

export function MemoryViewer() {
  const [activeTab, setActiveTab] = useState<MemoryTab>("events");

  const {
    events,
    totalEvents,
    eventsTypeFilter,
    hasMoreEvents,
    isLoadingEvents,
    setEventsTypeFilter,
    loadMoreEvents,
    deleteEvent,
    sessions,
    totalSessions,
    hasMoreSessions,
    isLoadingSessions,
    loadMoreSessions,
    deleteSession,
    submitFeedback,
  } = useMemoryData();

  return (
    <div className="flex flex-col h-screen bg-white font-sans">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">Memory</h2>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 shrink-0">
        {(["events", "sessions"] as MemoryTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 mr-5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content — flex-1 so it fills the remaining space and scrolls internally */}
      <div className="flex-1 min-h-0">
        {activeTab === "events" ? (
          <EventsTab
            events={events}
            totalEvents={totalEvents}
            eventsTypeFilter={eventsTypeFilter}
            hasMoreEvents={hasMoreEvents}
            isLoadingEvents={isLoadingEvents}
            onFilterChange={setEventsTypeFilter}
            onLoadMore={loadMoreEvents}
            onDelete={deleteEvent}
          />
        ) : (
          <SessionsTab
            sessions={sessions}
            totalSessions={totalSessions}
            hasMoreSessions={hasMoreSessions}
            isLoadingSessions={isLoadingSessions}
            onLoadMore={loadMoreSessions}
            onDelete={deleteSession}
          />
        )}
      </div>

      {/* Feedback bar — always visible at the bottom */}
      <FeedbackBar onSubmit={submitFeedback} />
    </div>
  );
}
