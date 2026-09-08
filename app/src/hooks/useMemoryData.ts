import { useCallback, useEffect, useState } from "react";

import { orbitApiFetch } from "@/lib/local-api";
import type { EventTypeFilter, MemoryEvent, MemorySession } from "../types";

const EVENTS_PAGE_SIZE = 50;
const SESSIONS_PAGE_SIZE = 20;

export interface UseMemoryDataReturn {
  // Events
  events: MemoryEvent[];
  totalEvents: number;
  eventsTypeFilter: EventTypeFilter;
  hasMoreEvents: boolean;
  isLoadingEvents: boolean;
  setEventsTypeFilter: (filter: EventTypeFilter) => void;
  loadMoreEvents: () => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  // Sessions
  sessions: MemorySession[];
  totalSessions: number;
  hasMoreSessions: boolean;
  isLoadingSessions: boolean;
  loadMoreSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  // Feedback
  submitFeedback: (
    rating: "positive" | "negative",
    comment: string | null,
    context: string | null
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMemoryData(): UseMemoryDataReturn {
  // --- Events state ---
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsTypeFilter, setEventsTypeFilterState] =
    useState<EventTypeFilter>("all");
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  // --- Sessions state ---
  const [sessions, setSessions] = useState<MemorySession[]>([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  // ---------------------------------------------------------------------------
  // Data fetchers
  // ---------------------------------------------------------------------------

  async function fetchEvents(
    offset: number,
    filter: EventTypeFilter,
    append: boolean
  ): Promise<void> {
    setIsLoadingEvents(true);
    try {
      const response = await orbitApiFetch(
        `/memory/events?limit=${EVENTS_PAGE_SIZE}&offset=${offset}&type=${filter}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: {
        events: MemoryEvent[];
        total: number;
        limit: number;
        offset: number;
      } = await response.json();

      setEvents((previous) =>
        append ? [...previous, ...data.events] : data.events
      );
      setTotalEvents(data.total);
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function fetchSessions(offset: number, append: boolean): Promise<void> {
    setIsLoadingSessions(true);
    try {
      const response = await orbitApiFetch(
        `/memory/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=${offset}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: { sessions: MemorySession[]; total: number } =
        await response.json();

      setSessions((previous) =>
        append ? [...previous, ...data.sessions] : data.sessions
      );
      setTotalSessions(data.total);
    } finally {
      setIsLoadingSessions(false);
    }
  }

  // Load first page of both on mount.
  useEffect(() => {
    fetchEvents(0, eventsTypeFilter, false);
    fetchSessions(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  // Changing the type filter resets pagination and fetches a fresh first page.
  const setEventsTypeFilter = useCallback(
    (filter: EventTypeFilter): void => {
      setEventsTypeFilterState(filter);
      setEventsOffset(0);
      fetchEvents(0, filter, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const loadMoreEvents = useCallback(async (): Promise<void> => {
    const nextOffset = eventsOffset + EVENTS_PAGE_SIZE;
    setEventsOffset(nextOffset);
    await fetchEvents(nextOffset, eventsTypeFilter, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsOffset, eventsTypeFilter]);

  const loadMoreSessions = useCallback(async (): Promise<void> => {
    const nextOffset = sessionsOffset + SESSIONS_PAGE_SIZE;
    setSessionsOffset(nextOffset);
    await fetchSessions(nextOffset, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsOffset]);

  const deleteEvent = useCallback(async (eventId: string): Promise<void> => {
    const response = await orbitApiFetch(
      `/memory/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" }
    );
    if (!response.ok) throw new Error("Failed to delete event.");
    // Optimistic removal — no refetch needed.
    setEvents((previous) =>
      previous.filter((event) => event.id !== eventId)
    );
    setTotalEvents((previous) => Math.max(0, previous - 1));
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const response = await orbitApiFetch(
        `/memory/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete session.");
      setSessions((previous) =>
        previous.filter((session) => session.id !== sessionId)
      );
      setTotalSessions((previous) => Math.max(0, previous - 1));
    },
    []
  );

  const submitFeedback = useCallback(
    async (
      rating: "positive" | "negative",
      comment: string | null,
      context: string | null
    ): Promise<void> => {
      const response = await orbitApiFetch("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, context }),
      });
      if (!response.ok) throw new Error("Failed to submit feedback.");
    },
    []
  );

  return {
    events,
    totalEvents,
    eventsTypeFilter,
    hasMoreEvents: events.length < totalEvents,
    isLoadingEvents,
    setEventsTypeFilter,
    loadMoreEvents,
    deleteEvent,
    sessions,
    totalSessions,
    hasMoreSessions: sessions.length < totalSessions,
    isLoadingSessions,
    loadMoreSessions,
    deleteSession,
    submitFeedback,
  };
}
