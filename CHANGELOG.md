# Changelog

Orbit does not hand-maintain a changelog file. Release notes are generated
per tag by `.github/workflows/release.yml` (app, `v*` tags) and
`.github/workflows/publish-extension.yml` (Chrome extension, `ext-v*` tags)
and published on the relevant GitHub Releases page:

- **App releases**: [Saadaan-Hassan/orbit-releases](https://github.com/Saadaan-Hassan/orbit-releases/releases)
  — the public repo release assets and notes actually live in (see
  `AGENTS.md`'s `Release & Distribution` section for why).
- **Extension releases**: tracked via `ext-v*` tags on this repo.

If you're looking for "what changed since version X," check the release
notes above rather than this file.
