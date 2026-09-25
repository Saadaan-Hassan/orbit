import { useState } from "react";
import { useProjects } from "../hooks/useProjects";
import { getProjectColor } from "../lib/project-color";
import type { ProjectCard } from "../types";

// ─── Time formatting ─────────────────────────────────────────────────────────
function formatLastActive(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  if (diffMin < 60) return diffMin <= 1 ? "Just now" : `${diffMin}m ago`;
  if (diffHours < 24) return diffHours === 1 ? "1h ago" : `${diffHours}h ago`;

  const eventDate = new Date(timestampMs);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    eventDate.getDate() === yesterday.getDate() &&
    eventDate.getMonth() === yesterday.getMonth() &&
    eventDate.getFullYear() === yesterday.getFullYear()
  ) {
    return "Yesterday";
  }

  return eventDate.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatActiveMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin === 0 ? `${hours}h` : `${hours}h ${remainingMin}m`;
}

// ─── Individual card ──────────────────────────────────────────────────────────
interface ProjectCardItemProps {
  project: ProjectCard;
  onPrefill: (query: string) => void;
  onSubmit: (query: string) => void;
}

function ProjectCardItem({ project, onPrefill, onSubmit }: ProjectCardItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const color = getProjectColor(project.project_name);
  const description = project.activity || project.ai_summary;
  const truncatedDescription = description
    ? description.length > 80
      ? description.slice(0, 80) + "…"
      : description
    : "No recent summary available for this project.";

  const prefillQuery = `Where did I leave off with ${project.project_name}?`;

  function handleCardClick(e: React.MouseEvent): void {
    if ((e.target as HTMLElement).closest("[data-submit-btn]")) return;
    onPrefill(prefillQuery);
  }

  function handleSubmitClick(e: React.MouseEvent): void {
    e.stopPropagation();
    onSubmit(prefillQuery);
  }

  return (
    <button
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative text-left w-full flex flex-col justify-between gap-3 p-4 rounded-2xl border transition-all duration-250 cursor-pointer bg-gradient-to-br from-white to-zinc-50/50 dark:from-zinc-950 dark:to-zinc-900/10 ${
        isHovered
          ? "border-zinc-300 dark:border-zinc-700 -translate-y-[2px]"
          : "border-zinc-100 dark:border-zinc-900"
      }`}
      style={{
        boxShadow: isHovered
          ? `0 10px 22px -6px ${color}1e, 0 4px 8px -2px ${color}0b`
          : "0 1px 3px rgba(0,0,0,0.02)",
      }}
    >
      <div className="w-full flex flex-col gap-2">
        {/* Project name + color dot */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="shrink-0 w-2.5 h-2.5 rounded-full border border-white dark:border-zinc-950 shadow-sm"
              style={{
                backgroundColor: color,
                boxShadow: `0 0 0 2px ${color}25`,
              }}
            />
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 tracking-tight truncate">
              {project.project_name}
            </span>
          </div>

          {/* One-click submit arrow */}
          <span
            data-submit-btn
            onClick={handleSubmitClick}
            role="button"
            aria-label={`Resume ${project.project_name}`}
            className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all duration-150 border border-transparent hover:border-zinc-200/50 dark:hover:border-zinc-800/80 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </div>

        {/* Activity description */}
        <p className="text-xs font-light text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2 min-h-[32px]">
          {truncatedDescription}
        </p>
      </div>

      {/* Stats footer (Badges) */}
      <div className="w-full flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100/50 dark:border-zinc-900/40 select-none">
        <div className="flex items-center gap-1.5">
          {project.weekly_active_minutes > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-zinc-100/50 dark:bg-zinc-900/60 border border-zinc-100/30 dark:border-zinc-900/20 text-[9px] text-zinc-400 dark:text-zinc-500 font-medium">
              🕐 {formatActiveMinutes(project.weekly_active_minutes)}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded-md bg-zinc-100/50 dark:bg-zinc-900/60 border border-zinc-100/30 dark:border-zinc-900/20 text-[9px] text-zinc-400 dark:text-zinc-500 font-medium">
            📁 {project.session_count} {project.session_count === 1 ? "session" : "sessions"}
          </span>
        </div>
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-light whitespace-nowrap">
          {formatLastActive(project.last_active_ms)}
        </span>
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface ProjectCardsProps {
  isVisible: boolean;
  onPrefill: (query: string) => void;
  onSubmit: (query: string) => void;
}

const MAX_VISIBLE_PROJECTS = 4; // reduced from 6 to match the taller dimensions cleanly

export function ProjectCards({ isVisible, onPrefill, onSubmit }: ProjectCardsProps) {
  const { projects, todayActiveMinutes, isLoading } = useProjects();
  const [showAll, setShowAll] = useState(false);

  if (!isLoading && projects.length === 0) return null;

  const visibleProjects = showAll ? projects : projects.slice(0, MAX_VISIBLE_PROJECTS);
  const hasMore = projects.length > MAX_VISIBLE_PROJECTS;

  return (
    <div
      className="flex flex-col gap-3 transition-opacity duration-200 ease-out select-none"
      style={{ opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? "auto" : "none" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
          Active Projects
        </span>
        {todayActiveMinutes > 0 && (
          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
            🕐 {formatActiveMinutes(todayActiveMinutes)} today
          </span>
        )}
      </div>

      {/* Loading shimmer */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[105px] rounded-2xl bg-zinc-100 dark:bg-zinc-900/60 animate-pulse border border-zinc-100/50 dark:border-zinc-900/20"
            />
          ))}
        </div>
      )}

      {/* Cards grid */}
      {!isLoading && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {visibleProjects.map((project) => (
              <ProjectCardItem
                key={project.project_name}
                project={project}
                onPrefill={onPrefill}
                onSubmit={onSubmit}
              />
            ))}
          </div>

          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="self-center text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer pt-1"
            >
              Show all {projects.length} projects ↓
            </button>
          )}
        </>
      )}
    </div>
  );
}
