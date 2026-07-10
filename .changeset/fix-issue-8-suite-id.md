---
"argusai-core": patch
"argusai-mcp": patch
---

fix(run): attribute suite events by id to prevent silent false-green (issue #8)

- Stamp `suiteId` from e2e.yaml onto all YAML suite/case events
- Aggregate `argus_run` results by `suiteId` instead of free-text `name`
- Guard: if a suite declares cases but none are attributed, mark failed (never empty pass)
