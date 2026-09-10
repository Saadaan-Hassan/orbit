# ADR-003: Shared sanitization before Rust event persistence

## Status

Accepted

## Context

Rust capture monitors currently write different captured fields directly to the
local SQLite event store. A clipboard-only detector cannot protect window
titles, browser URLs, file names and paths, screen text, or future capture
paths. SQLite is the source for local search and provider-bound context, so a
sensitive value stored there can be exposed later even if a later layer tries
to redact it.

## Decision

`PRIV-003` introduces one Rust sanitization module used immediately before every
active Rust event insert. It applies inline redaction to known credentials,
private keys, authorization headers, JWTs, connection strings, payment-card-like
and US-SSN values, email addresses, phone numbers, and configured exact-match
user patterns. It also strips URL fragments, removes credential-bearing URL
authority data, and redacts sensitive query-parameter values.

The sanitizer accepts bounded input, then caps output while preserving a clear
truncation marker. It must sanitize every captured string field, including
`raw_content`, `app_name`, `url`, `file_path`, `screen_text`, and any
metadata-derived strings. Static patterns are always available; user-defined
patterns are local-only exact-match phrases loaded from SQLite with a short
per-monitor cache. Invalid, missing, or unreadable pattern settings fall back
to static redaction rather than disabling capture safeguards.

```text
OS/clipboard/browser/file input
              |
              v
       Rust capture monitor
              |
              v
 shared sanitizer + local custom-pattern cache
              |
              v
       SQLite events / FTS5 index
              |
              v
 Python boundary redaction (defence in depth; PRIV-004)
```

## Consequences

### Positive

- All active Rust capture paths share one auditable redaction policy.
- Sensitive URL fragments, credentials, and configured phrases never reach
  the local event/FTS tables through Rust capture.
- Input/output limits reduce accidental storage and processing of huge text.

### Negative

- Some useful search context is intentionally removed or shortened.
- User-defined phrases are stored locally in privacy settings so they can be
  matched; users should not use that feature as a secret vault.
- A later provider-bound boundary remains necessary because browser extension
  events do not pass through Rust.

### Neutral

- Redaction is best effort, not a guarantee that every secret format can be
  recognized. New patterns require tests before they are added.
