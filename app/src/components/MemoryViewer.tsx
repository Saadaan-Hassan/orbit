import { useState } from "react";
import { useAnalytics } from "../hooks/useAnalytics";
import { useMemoryData } from "../hooks/useMemoryData";
import type { EventTypeFilter, MemoryEvent, MemorySession } from "../types";

// ─── Formatting Helpers ───────────────────────────────────────────────────────
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
    ? timeString
    : date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

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

function truncate(text: string | null, maxLength = 60): string {
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

function eventTypeIcon(type: string): React.ReactNode {
  switch (type) {
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

// ─── Trash Button (Inline SVG) ───────────────────────────────────────────────
function TrashButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-zinc-400 hover:text-red-500 transition-colors shrink-0 p-1.5 rounded-lg hover:bg-red-500/10 cursor-pointer"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
    </button>
  );
}

// ─── Dialog Confirmation ─────────────────────────────────────────────────────
interface DeleteConfirmProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ isOpen, onConfirm, onCancel }: DeleteConfirmProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-black rounded-xl shadow-2xl p-5 max-w-[280px] w-full animate-in zoom-in-95 duration-200">
        <p className="text-sm font-bold text-zinc-900 dark:text-white mb-1.5">
          Delete this session?
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed font-light">
          The summary will be deleted. The raw captured events will remain intact but unlinked.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] rounded-lg text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-semibold cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Events Tab ──────────────────────────────────────────────────────────────
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
  { label: "All",         value: "all"           },
  { label: "Clipboard",   value: "clipboard"     },
  { label: "Window",      value: "window"        },
  { label: "Browser",     value: "url"           },
  { label: "Page",        value: "page_content"  },
  { label: "Search",      value: "search_query"  },
  { label: "Link",        value: "link_click"    },
  { label: "File",        value: "file_activity" },
  { label: "System",      value: "system_state"  },
  { label: "App",         value: "app_lifecycle" },
  { label: "Screen",      value: "screen_content"},
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
  const { captureEvent } = useAnalytics();

  async function handleLoadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  }

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
    <div className="flex flex-col h-full bg-transparent">
      {/* Filter capsule bar */}
      <div className="flex gap-1 py-2 shrink-0">
        {EVENT_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onFilterChange(option.value)}
            className={`px-2.5 py-1 text-[10px] rounded-full font-medium transition-colors cursor-pointer ${
              eventsTypeFilter === option.value
                ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-sm"
                : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800"
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500 self-center font-medium">
          {totalEvents} items recorded
        </span>
      </div>

      {/* Scrollable event lists */}
      <div className="flex-1 overflow-y-auto py-3">
        {isLoadingEvents && events.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-4 text-center">Loading events…</p>
        )}
        {!isLoadingEvents && events.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-4 text-center">
            {eventsTypeFilter !== "all"
              ? `No ${eventsTypeFilter.replace("_", " ")} activity found.`
              : "Nothing captured yet — keep working and I'll fill this in."}
          </p>
        )}

        {Object.entries(eventsByDate).map(([dateLabel, dateEvents]) => (
          <div key={dateLabel} className="mb-4">
            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1 px-1">
              {dateLabel}
            </p>
            <div className="flex flex-col gap-0.5">
              {dateEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-2.5 py-1.5 px-2 rounded-xl hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10 group transition-colors"
                >
                  <div className="shrink-0 w-5 h-5 flex items-center justify-center select-none mt-0.5">
                    {eventTypeIcon(event.type)}
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                        {event.app_name ?? "System"}
                      </span>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate font-light leading-relaxed">
                      {truncate(event.raw_content)}
                    </p>
                  </div>
                  <TrashButton
                    onClick={() => {
                      captureEvent("memory_item_deleted", { item_type: "event" });
                      onDelete(event.id);
                    }}
                    label={`Delete event`}
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
            className="w-full py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white disabled:opacity-50 transition-colors cursor-pointer mt-1"
          >
            {loadingMore ? "Loading…" : "Load older events"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Sessions Tab ────────────────────────────────────────────────────────────
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
  const { captureEvent } = useAnalytics();

  async function handleConfirmDelete(): Promise<void> {
    setShowDeleteConfirm(false);
    captureEvent("memory_item_deleted", { item_type: "session" });
    await onDelete(session.id);
  }

  const durationLabel = formatDuration(session.start_time, session.end_time);
  const startLabel = formatTimestamp(session.start_time);

  // Parse key_resources JSON array — stored as a JSON string from Claude.
  let parsedResources: string[] = [];
  if (session.key_resources) {
    try {
      const parsed = JSON.parse(session.key_resources);
      if (Array.isArray(parsed)) parsedResources = parsed;
    } catch {
      // Malformed JSON — skip the resources block.
    }
  }

  // Decide whether the expansion has any Phase 2.9 content to render.
  const hasRichContent = Boolean(
    session.activity || session.next_step || session.goal ||
    session.blockers || session.last_action || parsedResources.length > 0
  );

  return (
    <>
      <div className="rounded-2xl mb-2 overflow-hidden bg-zinc-50/10 dark:bg-zinc-900/10">
        {/* Header summary info */}
        <div className="flex items-start gap-2.5 p-3.5">
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors mt-0.5 shrink-0 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transform transition-transform ${isExpanded ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {session.project_name ?? "Unnamed Session"}
              </span>
              <span className="text-[9px] bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                {session.event_count} item{session.event_count !== 1 ? "s" : ""}
              </span>
              <span className="text-[9px] bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                {durationLabel}
              </span>
              {session.active_minutes != null && session.active_minutes > 0 && (
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium">
                  {session.active_minutes}m active
                </span>
              )}
            </div>
            {session.goal && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light truncate leading-relaxed">
                {session.goal}
              </p>
            )}
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">{startLabel}</p>
          </div>

          <TrashButton
            onClick={() => setShowDeleteConfirm(true)}
            label={`Delete session`}
          />
        </div>

        {/* Expanded detail — Phase 2.9 rich fields */}
        {isExpanded && hasRichContent && (
          <div className="bg-zinc-50/50 dark:bg-zinc-900/20 px-4 py-3 space-y-3 text-xs leading-relaxed">
            {/* next_step is the product's core value — most prominent */}
            {session.next_step && (
              <div className="bg-zinc-900 dark:bg-white rounded-xl px-3.5 py-2.5">
                <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  Continue →
                </p>
                <p className="font-semibold text-white dark:text-zinc-950 leading-snug">
                  {session.next_step}
                </p>
              </div>
            )}

            {session.activity && (
              <div>
                <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">
                  What you were doing
                </p>
                <p className="text-zinc-600 dark:text-zinc-300 font-light">{session.activity}</p>
              </div>
            )}

            {session.blockers && (
              <div>
                <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">
                  Stuck on
                </p>
                <p className="text-zinc-500 dark:text-zinc-400 font-light">{session.blockers}</p>
              </div>
            )}

            {session.last_action && (
              <div>
                <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">
                  Last action
                </p>
                <p className="text-zinc-500 dark:text-zinc-400 font-light">{session.last_action}</p>
              </div>
            )}

            {parsedResources.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  Resources
                </p>
                <ul className="space-y-1">
                  {parsedResources.map((resource, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-zinc-400 dark:text-zinc-500 shrink-0 font-medium">→</span>
                      <span className="break-all text-zinc-500 dark:text-zinc-400">{resource}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Fallback for pre-Phase-2.9 sessions that only have ai_summary */}
        {isExpanded && !hasRichContent && session.ai_summary && (
          <div className="bg-zinc-50/50 dark:bg-zinc-900/20 px-4 py-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
              {session.ai_summary}
            </p>
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
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex items-center justify-between py-2 shrink-0">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">
          {totalSessions} work summaries
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        {isLoadingSessions && sessions.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-4 text-center">Loading sessions…</p>
        )}
        {!isLoadingSessions && sessions.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-4 text-center italic">
            I'll create a summary every 30 minutes as you work.
          </p>
        )}

        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} onDelete={onDelete} />
        ))}

        {hasMoreSessions && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white disabled:opacity-50 transition-colors cursor-pointer mt-1"
          >
            {loadingMore ? "Loading…" : "Load older sessions"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Feedback Bar ────────────────────────────────────────────────────────────
interface FeedbackBarProps {
  onSubmit: (
    rating: "positive" | "negative",
    comment: string | null,
    context: string | null
  ) => Promise<void>;
}

function FeedbackBar({ onSubmit }: FeedbackBarProps) {
  const [selectedRating, setSelectedRating] = useState<"positive" | "negative" | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleRatingClick(rating: "positive" | "negative"): void {
    setSelectedRating((prev) => (prev === rating ? null : rating));
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
    <div className="pt-3 pb-1 shrink-0 bg-transparent flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">How is Orbit's memory?</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleRatingClick("positive")}
            className={`text-sm p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-950 transition-colors cursor-pointer ${
              selectedRating === "positive" ? "opacity-100" : "opacity-40 hover:opacity-85"
            }`}
            aria-label="Thumbs up"
          >
            👍
          </button>
          <button
            onClick={() => handleRatingClick("negative")}
            className={`text-sm p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-950 transition-colors cursor-pointer ${
              selectedRating === "negative" ? "opacity-100" : "opacity-40 hover:opacity-85"
            }`}
            aria-label="Thumbs down"
          >
            👎
          </button>
        </div>
        {submitted && (
          <span className="text-xs text-emerald-500 font-semibold ml-1 animate-in fade-in duration-200">
            Received!
          </span>
        )}
      </div>

      {selectedRating !== null && (
        <div className="flex gap-2 animate-in slide-in-from-bottom-2 duration-200">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Add optional comment…"
            className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-900 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-400/20 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border-0"
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MemoryViewer Root ───────────────────────────────────────────────────────
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
    <div className="flex flex-col h-full bg-transparent font-sans">
      {/* Sub-tab selection bar */}
      <div className="flex shrink-0">
        {(["events", "sessions"] as MemoryTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2.5 mr-5 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer relative ${
              activeTab === tab
                ? "text-zinc-900 dark:text-white"
                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-white rounded-full animate-in fade-in zoom-in duration-200" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content view frame */}
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

      {/* Feedbacks */}
      <FeedbackBar onSubmit={submitFeedback} />
    </div>
  );
}
