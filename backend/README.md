# Orbit backend

FastAPI backend (Python, `uv`). See the root [`README.md`](../README.md) for
what Orbit is and how to build every workspace, and [`AGENTS.md`](../AGENTS.md)
for the full architecture reference.

## Privacy regression suite

From `backend/`, run the complete local privacy, consent, authentication, and
provider-boundary regression suite with no provider credentials:

```bash
uv run python -m unittest discover -s tests -p 'test_*.py'
```

This is the command intended for `CI-002`.
