# ADR-002: Versioned, opt-in capture consent

## Status

Accepted

## Context

Orbit previously created capture settings with enabled defaults and treated missing
settings as permission to capture. That is incompatible with informed consent,
especially for an existing installation upgraded to a more invasive release.

## Decision

Orbit stores one versioned consent record with independent choices for clipboard,
app/window, browser, file activity, and screen content. A new or upgraded
database has version `1`, no acceptance timestamp, every category disabled, and
global capture paused. Existing preferences and data are preserved, but capture
does not resume until the user explicitly saves a consent choice. Missing or
corrupt consent is interpreted as no consent.

`PRIV-001` owns persistence and authenticated API/UI state. `PRIV-002` owns
enforcing this record in every Rust monitor and onboarding flow.

## Consequences

### Positive

- A fresh install and an upgrade fail closed before invasive collection.
- Users can revoke one source without discarding other privacy choices or data.

### Negative

- Existing users must review consent before capture resumes.
- The app needs explicit onboarding/review UI in the next task.

### Neutral

- Consent version changes can require a new review without deleting history.
