-- Run this once in your Supabase project dashboard: SQL Editor → New query → Run
--
-- Creates the waitlist table with a unique constraint on email so duplicate
-- submissions are rejected at the DB level (we silently treat them as success
-- in the Server Action — never telling the user the address was already used).

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        NOT NULL UNIQUE,
  name       TEXT,
  source     TEXT        DEFAULT 'landing',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup when checking for duplicates or exporting the list.
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist (email);
