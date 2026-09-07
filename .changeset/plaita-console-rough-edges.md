---
'argusai-core': patch
'argusai-mcp': patch
---

Fix three field-tested rough edges from plaita-console E2E integration (issue #11):

- **run**: `ensureEnvironmentReady` now waits (up to 60s) for auto-started services and image-based mocks to accept TCP connections before cases execute, and surfaces failed/unhealthy services as warnings — services without a configured healthcheck no longer fail their first requests with `fetch failed` while still booting.
- **clean**: empty `argusai-*` managed networks are now reclaimed by `argus_clean` (both with and without a live session) and by preflight orphan cleanup, instead of leaking until the Docker address pool is exhausted. A 60s grace period protects networks of concurrent setups.
- **browser steps**: playwright module and Chromium binary are now detected in one pass with a single actionable message (`npm install -g playwright && npx playwright install chromium`), instead of two sequential failures (module missing → install → binary missing → install again).
