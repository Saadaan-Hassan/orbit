import { useState, useEffect, useRef } from "react";
import { orbitApiFetch } from "@/lib/local-api";
import type { TimelineDayData, TimelineSession } from "../types";

function buildTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const EMPTY_DAY_DATA: TimelineDayData = {
  sessions: [],
  total_active_minutes: 0,
  total_duration_minutes: 0,
  project_count: 0,
};

export interface UseTimelineResult {
  sessions: TimelineSession[];
  totalActiveMinutes: number;
  totalDurationMinutes: number;
  projectCount: number;
  availableDates: string[];
  isLoading: boolean;
  error: string | null;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

export function useTimeline(initialDate?: string): UseTimelineResult {
  const today = buildTodayDateString();
  const [selectedDate, setSelectedDateState] = useState<string>(initialDate ?? today);
  const [currentDayData, setCurrentDayData] = useState<TimelineDayData>(EMPTY_DAY_DATA);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // In-memory cache keyed by date string — prevents re-fetching the same day.
  const dayDataCache = useRef<Map<string, TimelineDayData>>(new Map());

  async function fetchDayData(dateString: string): Promise<void> {
    if (dayDataCache.current.has(dateString)) {
      setCurrentDayData(dayDataCache.current.get(dateString)!);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await orbitApiFetch(
        `/timeline/day?date=${encodeURIComponent(dateString)}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: TimelineDayData = await response.json();
      dayDataCache.current.set(dateString, data);
      setCurrentDayData(data);
    } catch {
      setError("Could not load timeline data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchAvailableDates(): Promise<void> {
    try {
      const response = await orbitApiFetch("/timeline/dates");
      if (!response.ok) return;
      const data: { dates: string[] } = await response.json();
      setAvailableDates(data.dates);
    } catch {
      // Non-fatal — date navigation will work without this list.
    }
  }

  useEffect(() => {
    fetchDayData(selectedDate);
    fetchAvailableDates();
  }, []);

  function setSelectedDate(dateString: string): void {
    setSelectedDateState(dateString);
    fetchDayData(dateString);
  }

  return {
    sessions: currentDayData.sessions,
    totalActiveMinutes: currentDayData.total_active_minutes,
    totalDurationMinutes: currentDayData.total_duration_minutes,
    projectCount: currentDayData.project_count,
    availableDates,
    isLoading,
    error,
    selectedDate,
    setSelectedDate,
  };
}
