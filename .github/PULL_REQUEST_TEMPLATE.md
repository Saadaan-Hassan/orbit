## What this changes and why

<!-- Link the issue this addresses, or explain why one wasn't opened first
     (see CONTRIBUTING.md's "Picking a task" section). -->

## Tests

- [ ] I ran the relevant workspace's test suite (`backend`: `unittest`,
      `app/src-tauri`: `cargo test`, `worker`: `npm run test`, `app`:
      `pnpm build`) and it passes.
- [ ] I added or updated tests for the behavior this PR changes.
- [ ] No tests apply (docs-only, config-only, etc.) — explain why:

## Data flow / privacy impact

- [ ] This PR does not touch capture, redaction, storage, or any AI
      provider call.
- [ ] This PR **does** touch one of those. Describe what changes, in
      terms of `AGENTS.md`'s data flow: what's captured, what's redacted
      and when, what (if anything) is now sent somewhere it wasn't before,
      and to whom.

## Cost impact

- [ ] This PR does not add a new outbound API call, new default-on
      network behavior, or any maintainer-funded resource usage.
- [ ] This PR **does** add one of those. Explain the BYOK story (see
      `COST-001`/`COST-002` in `AGENTS.md`) — there is no maintainer-funded
      key for anything, by design.

## Screenshots (UI changes only)

<!-- Before/after, if this touches app/src, landing/src, or extension UI.
     Delete this section if not applicable. -->

## Sign-off

- [ ] My commits are signed off (`git commit -s`) per the DCO — see
      `CONTRIBUTING.md`.
