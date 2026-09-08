import { useEffect, useRef, useState } from "react";
import { orbitApiFetch } from "@/lib/local-api";
import type { ProjectCard, ProjectsData } from "../types";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedResult {
  data: ProjectsData;
  fetchedAt: number;
}

// Module-level cache so multiple hook instances (if ever rendered) share state.
let moduleCache: CachedResult | null = null;

export interface UseProjectsResult {
  projects: ProjectCard[];
  todayActiveMinutes: number;
  isLoading: boolean;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectCard[]>(
    moduleCache?.data.projects ?? []
  );
  const [todayActiveMinutes, setTodayActiveMinutes] = useState<number>(
    moduleCache?.data.today_active_minutes ?? 0
  );
  const [isLoading, setIsLoading] = useState<boolean>(moduleCache === null);

  // Track mount status to avoid setState after unmount.
  const isMountedRef = useRef(true);

  async function fetchProjects(forceRefresh = false): Promise<void> {
    const now = Date.now();
    if (
      !forceRefresh &&
      moduleCache &&
      now - moduleCache.fetchedAt < CACHE_TTL_MS
    ) {
      // Cache is fresh — update state from cache and bail.
      setProjects(moduleCache.data.projects);
      setTodayActiveMinutes(moduleCache.data.today_active_minutes);
      setIsLoading(false);
      return;
    }

    try {
      const response = await orbitApiFetch("/projects");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: ProjectsData = await response.json();

      moduleCache = { data, fetchedAt: Date.now() };

      if (isMountedRef.current) {
        setProjects(data.projects);
        setTodayActiveMinutes(data.today_active_minutes);
      }
    } catch {
      // Fail silently — the dashboard just shows nothing rather than an error.
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    fetchProjects();

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        fetchProjects(true);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return { projects, todayActiveMinutes, isLoading };
}
