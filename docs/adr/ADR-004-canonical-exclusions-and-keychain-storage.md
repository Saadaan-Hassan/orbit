# ADR-004: Canonical exclusions and Keychain-backed provider credentials

## Status

Accepted

## Context

Orbit evaluates capture exclusions in both Rust and FastAPI. Previously those
paths compared raw strings, so case, `www.`, ports, Unicode hostnames, and
subdomains could produce different results. The repository also contained two
different default app-exclusion lists.

Older Orbit installations may store a user-provided Groq key in SQLite. That
would expose the credential to local database copies, exports, and file-system
readers even though macOS provides a protected credential store.

## Decision

Default exclusions are defined once in `services/exclusion_policy.py` and are
written into SQLite in canonical form. SQLite is the runtime source shared by
the Rust capture monitors and the extension-facing FastAPI route.

Domains are normalized by removing scheme, path, port, a single leading `www.`,
and a trailing dot; then lowercased and converted to IDNA/punycode. Excluding a
domain excludes that domain and its true DNS subdomains, but never a merely
similar suffix such as `example.com.attacker.test`. App names are Unicode-
normalized, whitespace-collapsed, and lowercased. Watched folders are
canonical absolute paths and file events must stay within one of them.

The macOS Keychain generic-password item `com.heyorbit.orbit` /
`groq-api-key` is the sole persistent store for a Groq credential. On startup,
a legacy non-empty SQLite value is copied to Keychain first and cleared only
after that write succeeds. The backend reads a credential only immediately
before it is needed for a provider request and never returns it to the webview.

Orbit data directories are mode `0700`; ordinary local data files, SQLite,
WAL/SHM files, and the Qdrant store use mode `0600` for files and `0700` for
directories. Existing non-symlink paths are repaired at startup.

```text
Privacy UI ──canonicalize──> SQLite exclusions <──read── Rust / FastAPI capture

legacy SQLite Groq key ──copy on success──> macOS Keychain
                                      └──> clear SQLite value
```

## Consequences

### Positive

- Native browser and extension capture make the same domain decision.
- Existing malformed/duplicate exclusions are repaired to one predictable form.
- Provider keys no longer persist in SQLite or local backups after successful
  Keychain migration.
- Local storage has protections appropriate for a single-user macOS desktop app.

### Negative

- A user who entered `www.example.com` is intentionally opting out of capture
  for `example.com` and its subdomains as well.
- A Keychain failure leaves a legacy SQLite key untouched rather than risking
  data loss; Orbit reports the safe failure and the maintainer/user must retry.
- File permissions are not encryption. Other activity data stays readable to
  the signed-in macOS account and to software acting as that account.

### Neutral

- FileVault remains the recommended protection for data at rest; Orbit does
  not claim application-level encryption for activity data.
