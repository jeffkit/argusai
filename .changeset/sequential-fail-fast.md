---
'argusai-core': patch
---

**fix(yaml-engine): emit `case_skip` for remaining cases when a case fails in `sequential: true` suites (fail-fast)**

Previously, when a YAML test suite was declared with `sequential: true` and a case failed, the engine would still run every subsequent case. This often produced misleading reports — a single root cause (e.g. a broken setup or a regression in case 2) could surface as N independent failures because cases 3..N typically depend on case 2's side effects.

The engine now short-circuits: once a case fails (after retries are exhausted, and not via `ignoreError`) in a `sequential: true` suite, every remaining case is reported via the existing `case_skip` event with reason `"Previous case failed in sequential suite (fail-fast)"`. The `case_skip` event type was already defined in `types.ts` and aggregated by `reporter.ts` (`suite.skipped++`), so no downstream change is required — dashboards, CLI, and HTML reports keep working.

**Backward compatibility:**
- Suites without `sequential: true` (or `sequential: false` / unset) keep the existing "run every case" behavior.
- `ignoreError: true` cases are unaffected — they still produce `case_pass` and never trigger fail-fast.
- Retried cases that eventually pass are unaffected — only post-exhaustion failures trigger fail-fast.
- `setup` / `teardown` failure semantics are unchanged.

Adds 7 new unit tests in `tests/unit/yaml-engine.test.ts` covering: sequential+fail (skips remaining), all-pass (no skip), undefined / explicit-false (no skip), `ignoreError` (no skip), retry-then-pass (no skip), and retry-exhausted-with-sequential (skip after retry exhaustion).
