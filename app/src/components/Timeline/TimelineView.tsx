import { useState } from "react";
import { useTimeline } from "../../hooks/useTimeline";
import type { TimelineSession } from "../../types";

// ─── Project color palette ────────────────────────────────────────────────────
// 8 distinct colors. Color is derived deterministically from the
// project name so the same project always gets the same color across sessions.
const PROJECT_COLOR_PALETTE: string[] = [
  "#E8A87C", // warm orange
  "#85C1E9", // soft blue
  "#82E0AA", // sage green
  "#F1948A", // coral
  "#BB8FCE", // lavender
  "#F8C471", // amber
  "#76D7C4", // teal
  "#AEB6BF", // neutral slate
];

function getProjectColor(projectName: string | null): string {
  if (!projectName) return PROJECT_COLOR_PALETTE[7];
  let hash = 0;
  for (let i = 0; i < projectName.length; i++) {
    hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return PROJECT_COLOR_PALETTE[Math.abs(hash) % PROJECT_COLOR_PALETTE.length];
}

// ─── Resource Parsing Helpers ─────────────────────────────────────────────────
interface FormattedResource {
  name: string;
  type: "file" | "url" | "generic";
  value: string;
}

function parseResources(resourcesStr: string | null): FormattedResource[] {
  if (!resourcesStr) return [];
  try {
    const arr = JSON.parse(resourcesStr);
    if (!Array.isArray(arr)) return [];
    return arr.map((res: string) => {
      const trimmed = res.trim();
      if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("www.")
      ) {
        let hostname = trimmed;
        try {
          const urlObj = new URL(trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed);
          hostname = urlObj.hostname.replace("www.", "");
        } catch {
          // ignore parsing error
        }
        return {
          name: hostname,
          type: "url" as const,
          value: trimmed,
        };
      } else if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(".")) {
        const parts = trimmed.split(/[/\\]/);
        const name = parts[parts.length - 1] || trimmed;
        return {
          name,
          type: "file" as const,
          value: trimmed,
        };
      }
      return {
        name: trimmed,
        type: "generic" as const,
        value: trimmed,
      };
    });
  } catch {
    return [];
  }
}

// ─── Date / time helpers ──────────────────────────────────────────────────────
function buildTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0");
  const day = String(yesterday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateString: string): string {
  const today = buildTodayDateString();
  const yesterday = buildYesterdayDateString();
  const localDate = new Date(`${dateString}T00:00:00`);
  const monthAndDay = localDate.toLocaleDateString([], { month: "long", day: "numeric" });

  if (dateString === today) return `Today, ${monthAndDay}`;
  if (dateString === yesterday) return `Yesterday, ${monthAndDay}`;
  return localDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function formatSessionTimeRange(startMs: number, endMs: number): string {
  const startLabel = new Date(startMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const endLabel = new Date(endMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${startLabel} – ${endLabel}`;
}

function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

// ─── Icon components ─────────────────────────────────────────────────────────
const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 shrink-0">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 shrink-0">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

// ─── Timeline strip ───────────────────────────────────────────────────────────
interface TimelineStripProps {
  sessions: TimelineSession[];
  selectedDate: string;
  hoveredSessionId: string | null;
  setHoveredSessionId: (id: string | null) => void;
}

function TimelineStrip({
  sessions,
  selectedDate,
  hoveredSessionId,
  setHoveredSessionId,
}: TimelineStripProps) {
  const defaultRangeStartMs = new Date(`${selectedDate}T08:00:00`).getTime();
  const defaultRangeEndMs = new Date(`${selectedDate}T20:00:00`).getTime();

  const rangeStartMs = sessions.reduce(
    (earliestMs, session) => Math.min(earliestMs, session.start_time),
    defaultRangeStartMs
  );
  const rangeEndMs = sessions.reduce(
    (latestMs, session) => Math.max(latestMs, session.end_time),
    defaultRangeEndMs
  );

  const totalSpanMs = Math.max(rangeEndMs - rangeStartMs, 1);

  function leftPercent(timestampMs: number): number {
    return ((timestampMs - rangeStartMs) / totalSpanMs) * 100;
  }

  function widthPercent(sessionStartMs: number, sessionEndMs: number): number {
    const natural = ((sessionEndMs - sessionStartMs) / totalSpanMs) * 100;
    return Math.max(natural, 1.5); // enforce minimum visible width
  }

  const hourMarkTimestamps: Array<{ timestampMs: number; label: string }> = [];
  for (let hour = 0; hour < 24; hour += 2) {
    const paddedHour = String(hour).padStart(2, "0");
    const markerMs = new Date(`${selectedDate}T${paddedHour}:00:00`).getTime();
    if (markerMs >= rangeStartMs && markerMs <= rangeEndMs) {
      hourMarkTimestamps.push({
        timestampMs: markerMs,
        label: new Date(markerMs).toLocaleTimeString([], { hour: "numeric", hour12: true }),
      });
    }
  }

  return (
    <div className="flex flex-col gap-1.5 bg-zinc-50/50 dark:bg-zinc-950/40 border border-zinc-100 dark:border-zinc-900/60 p-3 rounded-2xl">
      <div className="relative w-full h-8 bg-zinc-100 dark:bg-zinc-900/40 rounded-xl overflow-visible">
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 select-none">
              Nothing captured yet for this day
            </span>
          </div>
        )}

        {sessions.map((session) => {
          const sessionDurationMinutes = Math.round(
            (session.end_time - session.start_time) / 60_000
          );
          const blockColor = getProjectColor(session.project_name);
          const isHovered = hoveredSessionId === session.id;

          return (
            <div
              key={session.id}
              onMouseEnter={() => setHoveredSessionId(session.id)}
              onMouseLeave={() => setHoveredSessionId(null)}
              className={`absolute top-1.5 bottom-1.5 cursor-default transition-all duration-150 rounded-lg ${
                isHovered
                  ? "opacity-100 scale-y-110 shadow-md shadow-black/10 z-20"
                  : "opacity-80"
              }`}
              style={{
                left: `${Math.max(0, leftPercent(session.start_time))}%`,
                width: `${widthPercent(session.start_time, session.end_time)}%`,
                backgroundColor: blockColor,
              }}
            >
              {isHovered && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-[10px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap shadow-xl border border-white/10 dark:border-black/5">
                  {session.project_name ?? "Unknown"} · {sessionDurationMinutes}m
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative w-full h-4 select-none">
        {hourMarkTimestamps.map(({ timestampMs, label }) => (
          <span
            key={timestampMs}
            className="absolute text-[9px] text-zinc-400 dark:text-zinc-600 -translate-x-1/2"
            style={{ left: `${leftPercent(timestampMs)}%` }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────
interface SessionCardProps {
  session: TimelineSession;
  selectedDate: string;
  onAskOrbit: (query: string) => void;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function SessionCard({
  session,
  selectedDate,
  onAskOrbit,
  isHovered,
  onMouseEnter,
  onMouseLeave,
}: SessionCardProps) {
  const sessionColor = getProjectColor(session.project_name);
  const durationMinutes = Math.round(
    (session.end_time - session.start_time) / 60_000
  );
  const activityDescription = session.activity || session.ai_summary;

  let parsedTopics: string[] = [];
  if (session.topics) {
    try {
      const parsed = JSON.parse(session.topics);
      if (Array.isArray(parsed)) parsedTopics = parsed as string[];
    } catch {
      /* ignore */
    }
  }

  const formattedResources = parseResources(session.key_resources);

  function handleAskOrbitClick(e: React.MouseEvent): void {
    e.stopPropagation();
    const dateLabelForQuery = formatDateLabel(selectedDate);
    onAskOrbit(
      `Tell me about my ${session.project_name ?? "session"} work on ${dateLabelForQuery}`
    );
  }

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`relative group rounded-2xl border transition-all duration-200 p-4 flex flex-col gap-3.5 shadow-sm ${
        isHovered
          ? "border-zinc-300 dark:border-zinc-700 bg-zinc-50/30 dark:bg-zinc-900/10 shadow-md translate-x-[2px]"
          : "border-zinc-100 dark:border-zinc-900 bg-white dark:bg-black"
      }`}
    >
      {/* Connector Dot Node on the Left Thread */}
      <div
        className={`absolute -left-[31px] top-[22px] w-3 h-3 rounded-full border-2 border-white dark:border-zinc-950 shadow-sm z-10 transition-all duration-200 ${
          isHovered ? "scale-125" : ""
        }`}
        style={{
          backgroundColor: sessionColor,
          boxShadow: isHovered
            ? `0 0 0 4px ${sessionColor}40`
            : `0 0 0 2px ${sessionColor}15`,
        }}
      />

      {/* Header Info */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {session.project_name ?? "Unnamed Session"}
            </span>
            {session.category && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 font-medium">
                {session.category}
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1 font-medium select-none">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatSessionTimeRange(session.start_time, session.end_time)} ({formatDurationMinutes(durationMinutes)})
          </span>
        </div>

        {/* Ask Orbit Action Bubble */}
        <button
          onClick={handleAskOrbitClick}
          className="shrink-0 p-1.5 rounded-lg border border-zinc-100 hover:border-zinc-200 dark:border-zinc-900 dark:hover:border-zinc-800 bg-zinc-50/50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-900 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-semibold"
          title="Ask Orbit to recall details"
        >
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Ask Orbit
        </button>
      </div>

      {/* Goal Highlight */}
      {session.goal && (
        <div className="bg-zinc-50/50 dark:bg-zinc-900/10 border border-zinc-100/50 dark:border-zinc-900/40 rounded-xl px-3 py-2">
          <p className="text-[8px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">
            Focus Goal
          </p>
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 leading-normal">
            {session.goal}
          </p>
        </div>
      )}

      {/* Activity description */}
      {activityDescription && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">Activity summary:</span>{" "}
          {activityDescription}
        </p>
      )}

      {/* Topics hashtag pills */}
      {parsedTopics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parsedTopics.map((topic) => (
            <span
              key={topic}
              className="px-2 py-0.5 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100/50 dark:border-zinc-900/20 text-[10px] text-zinc-500 dark:text-zinc-400 rounded-full font-medium"
            >
              #{topic}
            </span>
          ))}
        </div>
      )}

      {/* Parsed Resources section */}
      {formattedResources.length > 0 && (
        <div className="space-y-1">
          <p className="text-[8px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
            Resources Used
          </p>
          <div className="flex flex-wrap gap-1">
            {formattedResources.map((res, i) => (
              <a
                key={i}
                href={res.type === "url" ? res.value : undefined}
                target={res.type === "url" ? "_blank" : undefined}
                rel={res.type === "url" ? "noopener noreferrer" : undefined}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-light transition-all border ${
                  res.type === "url"
                    ? "bg-blue-50/20 hover:bg-blue-50/50 border-blue-100/30 text-blue-600 dark:bg-blue-950/10 dark:hover:bg-blue-950/20 dark:border-blue-900/20 dark:text-blue-400 cursor-pointer"
                    : "bg-zinc-50 hover:bg-zinc-100 border-zinc-100 text-zinc-600 dark:bg-zinc-905 dark:hover:bg-zinc-900 dark:border-zinc-900 dark:text-zinc-400 cursor-default"
                }`}
                title={res.value}
              >
                {res.type === "url" ? <LinkIcon /> : <FileIcon />}
                <span className="truncate max-w-[130px] font-medium">{res.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Blocker Alert Box */}
      {session.blockers && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-50/40 dark:bg-red-950/10 border border-red-100/30 dark:border-red-900/20 text-red-800 dark:text-red-400 text-xs">
          <span className="mt-0.5 text-xs select-none">⚠️</span>
          <div className="leading-tight">
            <span className="font-semibold block text-[8px] uppercase tracking-wider text-red-500/80 mb-0.5">Stuck On</span>
            <p className="font-light">{session.blockers}</p>
          </div>
        </div>
      )}

      {/* Next Steps / Continuation Box */}
      {session.next_step && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100/30 dark:border-indigo-900/20 text-indigo-900 dark:text-indigo-400 text-xs">
          <span className="mt-0.5 text-xs select-none">✨</span>
          <div className="leading-tight">
            <span className="font-semibold block text-[8px] uppercase tracking-wider text-indigo-500/80 mb-0.5">Where you left off</span>
            <p className="font-light">{session.next_step}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main TimelineView ────────────────────────────────────────────────────────
export interface TimelineViewProps {
  onAskOrbit: (query: string) => void;
}

export function TimelineView({ onAskOrbit }: TimelineViewProps) {
  const {
    sessions,
    totalActiveMinutes,
    projectCount,
    availableDates,
    isLoading,
    error,
    selectedDate,
    setSelectedDate,
  } = useTimeline();

  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

  const longestSessionMinutes = sessions.reduce((longestSoFar, session) => {
    const sessionDurationMinutes = Math.round(
      (session.end_time - session.start_time) / 60_000
    );
    return Math.max(longestSoFar, sessionDurationMinutes);
  }, 0);

  return (
    <div className="flex flex-col h-full min-h-0 gap-4 font-sans text-zinc-900 dark:text-zinc-100 select-none">
      {/* Header and Calendar date selection strip */}
      <div className="flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-white">
            Daily Journey
          </h2>
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
            {formatDateLabel(selectedDate)}
          </span>
        </div>

        {/* Date Selector Slider */}
        {availableDates.length > 0 ? (
          <div
            className="flex gap-2 overflow-x-auto pb-1 scrollbar-none shrink-0"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {availableDates.slice(0, 10).map((dateStr) => {
              const isSelected = dateStr === selectedDate;
              const date = new Date(`${dateStr}T00:00:00`);
              const dayName = date.toLocaleDateString([], { weekday: "short" });
              const dayNum = date.getDate();
              const monthName = date.toLocaleDateString([], { month: "short" });

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`flex flex-col items-center min-w-[56px] py-2 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-zinc-900 border-zinc-800 text-white dark:bg-white dark:border-white dark:text-black shadow-md shadow-black/10 dark:shadow-white/5 font-semibold"
                      : "bg-zinc-50 border-zinc-100 hover:bg-zinc-100/50 hover:border-zinc-200 text-zinc-500 dark:bg-zinc-950 dark:border-zinc-900 dark:hover:bg-zinc-900/60 dark:hover:border-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  <span className="text-[8px] uppercase tracking-wider opacity-60 mb-0.5">{dayName}</span>
                  <span className="text-sm font-extrabold leading-none mb-0.5">{dayNum}</span>
                  <span className="text-[8px] opacity-75">{monthName}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500">No active dates logged yet.</p>
        )}
      </div>

      {/* Loading & Error Overlays */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center shrink-0 py-8">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 animate-pulse text-center">
            Loading timeline dashboard…
          </p>
        </div>
      )}
      {!isLoading && error && (
        <div className="flex-1 flex items-center justify-center shrink-0 py-8">
          <p className="text-xs text-red-400 font-medium text-center">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* Stats Cards Row */}
          {sessions.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5 shrink-0 select-none">
              {/* Active Work Card */}
              <div className="bg-zinc-50/50 dark:bg-zinc-950/40 border border-zinc-100 dark:border-zinc-900/60 rounded-2xl p-3 flex flex-col gap-1 transition-all">
                <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="text-[9px] uppercase font-bold tracking-wider">Active Work</span>
                </div>
                <span className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                  {totalActiveMinutes}m
                </span>
              </div>

              {/* Projects Card */}
              <div className="bg-zinc-50/50 dark:bg-zinc-950/40 border border-zinc-100 dark:border-zinc-900/60 rounded-2xl p-3 flex flex-col gap-1 transition-all">
                <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="text-[9px] uppercase font-bold tracking-wider">Projects</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                    {projectCount}
                  </span>
                  <div className="flex gap-0.5 max-w-[36px] overflow-hidden">
                    {sessions.slice(0, 3).map((session, i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: getProjectColor(session.project_name) }}
                        title={session.project_name ?? "Project"}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Longest Focus block */}
              <div className="bg-zinc-50/50 dark:bg-zinc-950/40 border border-zinc-100 dark:border-zinc-900/60 rounded-2xl p-3 flex flex-col gap-1 transition-all">
                <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span className="text-[9px] uppercase font-bold tracking-wider">Peak Focus</span>
                </div>
                <span className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                  {longestSessionMinutes}m
                </span>
              </div>
            </div>
          )}

          {/* Timeline strip/ruler view */}
          <div className="shrink-0">
            <TimelineStrip
              sessions={sessions}
              selectedDate={selectedDate}
              hoveredSessionId={hoveredSessionId}
              setHoveredSessionId={setHoveredSessionId}
            />
          </div>

          {/* Session list wrapped in a vertical thread */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 select-text">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
                <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center leading-relaxed">
                  No activity recorded for this day.
                </p>
                <p className="text-[10px] text-zinc-300 dark:text-zinc-600 text-center font-light">
                  Orbit automatically captures and indexes sessions as you work.
                </p>
              </div>
            ) : (
              <div className="relative border-l border-zinc-100 dark:border-zinc-900/50 ml-4 pl-6 flex flex-col gap-6 py-2">
                {sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    selectedDate={selectedDate}
                    onAskOrbit={onAskOrbit}
                    isHovered={hoveredSessionId === session.id}
                    onMouseEnter={() => setHoveredSessionId(session.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
