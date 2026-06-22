export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number; // Unix ms — used for display and ordering
};

export type EventTypeFilter =
  | "all"
  | "clipboard"
  | "window"
  | "url"
  | "page_content"
  | "search_query"
  | "link_click"
  | "file_activity"
  | "system_state"
  | "app_lifecycle"
  | "screen_content";

export interface MemoryEvent {
  id: string;
  timestamp: number;
  type: string;
  raw_content: string | null;
  app_name: string | null;
  url: string | null;
  source: string;
}

export interface MemorySession {
  id: string;
  start_time: number;
  end_time: number;
  project_name: string | null;
  goal: string | null;
  ai_summary: string | null;
  activity: string | null;
  next_step: string | null;
  blockers: string | null;
  last_action: string | null;
  key_resources: string | null; // JSON array string e.g. '["file.py","https://..."]'
  topics: string | null;        // JSON array string
  active_minutes: number | null;
  embedding_id: string | null;
  event_count: number;
}
