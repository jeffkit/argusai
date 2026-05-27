# Feature Specification: ArgusAI Server — Platformization Service Layer

**Feature Branch**: `007-server`  
**Created**: 2026-03-09  
**Status**: Draft  
**Input**: User description: "ArgusAI Server — 平台化服务层：以 result sync 模式为核心，测试执行保持本地 Docker，测试结果异步同步到中央服务器。提供团队协作、趋势分析共享、诊断知识库共享、企微通知等能力。"

---

## Problem Statement

ArgusAI is currently a single-machine tool (CLI/MCP) where test data is stored only on the developer's local machine. This creates several collaboration barriers:

- Teams cannot share test history — each developer sees only their own runs.
- Trend analysis is isolated — no team-wide or cross-project quality visibility.
- Diagnostic knowledge (failure patterns, fix records) cannot be shared across team members.
- There is no centralized notification mechanism for test failures.
- Multiple teams using ArgusAI have no unified platform for cross-team visibility.

## Solution Overview

Introduce **ArgusAI Server** as a central service layer using a **result sync model**: test execution stays local (Docker on developer machines), and results are asynchronously synced to a central server. This avoids the complexity of remote Docker management while providing team-level visibility, shared diagnostics, and centralized notifications.

```
Developer A (Local)          ArgusAI Server (Central)    Developer B (Local)
┌─────────────────┐          ┌──────────────────┐       ┌─────────────────┐
│ e2e.yaml        │          │ Database          │       │ e2e.yaml        │
│ Docker Engine   │          │ REST API          │       │ Docker Engine   │
│ argusai-mcp     │──sync──▶│ WeChat Notify     │◀──sync│ argusai-mcp     │
│ (local mode)    │          │ Dashboard (unified)│      │ (local mode)    │
└─────────────────┘          │ Trends + Diagnose │       └─────────────────┘
                             └──────────────────┘
```

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Result Sync from Local to Server (Priority: P1)

As a developer running E2E tests locally, I want my test results to be automatically synced to a central ArgusAI Server so that my teammates can see my test outcomes and the team has a unified view of project quality.

After every local test run, the system writes results to the local store as it does today, and then asynchronously uploads the run data (TestRun + TestCaseRun records) to the configured ArgusAI Server. The sync happens in the background and does not block the developer's workflow. If the server is unavailable, the results are queued locally and retried later.

**Why this priority**: Result sync is the foundational data pipeline that enables every server-side feature (shared trends, team dashboards, notifications). Without sync, the server has no data.

**Independent Test**: Configure a local ArgusAI instance with a server URL and API key, run a test suite, then verify the results appear on the server via the API.

**Acceptance Scenarios**:

1. **Given** a valid `server` configuration in `e2e.yaml` (URL, API key, team name), **When** a test suite completes locally, **Then** the TestRun and all TestCaseRun records are synced to the server within 30 seconds.
2. **Given** `server.sync` is set to `auto`, **When** a test run completes, **Then** sync happens automatically without any manual step from the developer.
3. **Given** the server is unreachable at sync time, **When** a test run completes, **Then** results are saved locally as normal, the sync failure is logged as a warning (not an error), and the results are queued for retry.
4. **Given** queued results from a previous server outage, **When** the server becomes reachable again, **Then** all queued results are synced in chronological order.
5. **Given** `server.sync` is set to `disabled`, **When** a test run completes, **Then** no sync attempt is made and the system behaves identically to a setup without any server configuration.
6. **Given** `server.sync` is set to `manual`, **When** a test run completes, **Then** results are stored locally but not synced until the developer explicitly triggers sync.
7. **Given** no `server` section in `e2e.yaml`, **When** a test run completes, **Then** behavior is identical to the current system — fully local, no sync, no errors.

---

### User Story 2 — API Key Authentication & Team Isolation (Priority: P1)

As a team lead, I want to create a team on the ArgusAI Server with a unique API key so that my team's data is isolated from other teams and only authorized members can sync results.

Each team has one API key. The key is configured in `e2e.yaml` (or via environment variable). The server validates the API key on every request and scopes all data access to the team associated with that key. Teams cannot see each other's data.

**Why this priority**: Authentication and data isolation are prerequisites for any multi-team deployment. Without this, data from different teams would be mixed, making the server unusable.

**Independent Test**: Create two teams with separate API keys, sync data from each, and verify that each team can only access its own data.

**Acceptance Scenarios**:

1. **Given** a valid API key in the request header, **When** any API endpoint is called, **Then** the request succeeds and data is scoped to the team associated with that key.
2. **Given** an invalid or missing API key, **When** any API endpoint is called, **Then** the request is rejected with a 401 Unauthorized response.
3. **Given** Team A's API key, **When** querying projects or runs, **Then** only Team A's data is returned — Team B's data is never visible.
4. **Given** a team admin, **When** they call the key management API to reset the API key, **Then** a new key is generated, the old key is immediately invalidated, and subsequent requests must use the new key.
5. **Given** a team admin, **When** they create a new team via the API, **Then** a unique API key is generated and returned.
6. **Given** the API key is set via the `ARGUSAI_API_KEY` environment variable, **When** a sync request is made, **Then** the environment variable value is used (taking precedence over the `e2e.yaml` value if both are set).

---

### User Story 3 — Automatic Project Registration (Priority: P1)

As a developer syncing results for the first time from a new project, I want the project to be automatically registered on the server so that I don't need to go through any approval or manual setup process.

When the server receives sync data for a project name it hasn't seen before (within the team), it automatically creates a project record. No approval workflow is needed — just a uniqueness constraint on (team + project_name).

**Why this priority**: Frictionless onboarding is critical for adoption. If developers have to manually register projects before syncing, many will skip the process entirely.

**Independent Test**: Sync results from a new project name and verify the project is automatically created on the server.

**Acceptance Scenarios**:

1. **Given** a team with no projects, **When** the first sync arrives with `project: "payment-service"`, **Then** a project record is created automatically and the sync data is stored under it.
2. **Given** a team with existing project `payment-service`, **When** a sync arrives with the same project name, **Then** data is appended to the existing project (no duplicate created).
3. **Given** Team A has project `payment-service`, **When** Team B syncs with the same project name, **Then** a separate project record is created for Team B (team + project_name is the uniqueness constraint, not project_name alone).
4. **Given** a project name containing special characters or spaces, **When** synced, **Then** the system normalizes and stores it correctly without errors.

---

### User Story 4 — Unified ORM with Drizzle Migration (Priority: P1)

As a developer or operator, I want ArgusAI to use a unified ORM layer so that the same codebase works transparently with SQLite (local), MySQL, or PostgreSQL (server) without code changes.

The current `better-sqlite3` direct calls in the history store are migrated to Drizzle ORM. In local mode, Drizzle uses SQLite (preserving current behavior). In server mode, Drizzle connects to MySQL or PostgreSQL. Schema definitions are shared, and only the database driver changes.

**Why this priority**: This is the foundational data layer change that makes both local and server modes work from the same codebase. Every other server feature depends on consistent data storage.

**Independent Test**: Run the full test suite in local mode (SQLite) and verify behavior is unchanged, then run against PostgreSQL and verify identical behavior.

**Acceptance Scenarios**:

1. **Given** local mode with no server configuration, **When** tests run, **Then** Drizzle uses SQLite and behavior is identical to the current `better-sqlite3` implementation (no user-visible changes).
2. **Given** server mode with PostgreSQL configured, **When** the server starts, **Then** Drizzle connects to PostgreSQL and all CRUD operations work correctly.
3. **Given** server mode with MySQL configured, **When** the server starts, **Then** Drizzle connects to MySQL and all CRUD operations work correctly.
4. **Given** existing local SQLite data from before the migration, **When** the updated system starts, **Then** existing data is accessible and no data loss occurs.
5. **Given** the Drizzle schema definition, **When** the database is initialized, **Then** all required tables, indexes, and constraints are created automatically.

---

### User Story 5 — Server-Side REST API for Test Data (Priority: P1)

As a Dashboard frontend or external tool, I want a comprehensive REST API on the ArgusAI Server so that I can query test runs, trends, flaky tests, and diagnostics across all projects in a team.

The server exposes RESTful endpoints that mirror the existing local API patterns (from 004-history and 005-diagnostics features) but operate on team-scoped data. This includes: receiving sync data, listing projects, querying run history, retrieving trends, flaky rankings, run comparisons, and diagnostic patterns.

**Why this priority**: The REST API is the primary interface for both the Dashboard and any external integrations. Without it, the server is just a data store with no access layer.

**Independent Test**: Seed the server with test data via the sync API, then call each query endpoint and verify correct responses.

**Acceptance Scenarios**:

1. **Given** synced test runs, **When** `GET /api/projects` is called with a valid API key, **Then** all projects for the team are returned with summary statistics.
2. **Given** synced runs for a project, **When** `GET /api/runs?project=X&limit=20` is called, **Then** a paginated list of the 20 most recent runs is returned.
3. **Given** multiple days of synced data, **When** trend endpoints are called (pass-rate, duration, flaky), **Then** aggregated trend data is returned matching the existing local API response format.
4. **Given** synced diagnostic patterns, **When** `GET /api/patterns?project=X` is called, **Then** failure patterns and fix records are returned.
5. **Given** two run IDs, **When** `GET /api/runs/compare?run1=A&run2=B` is called, **Then** a comparison of the two runs is returned showing status changes.

---

### User Story 6 — Enterprise WeChat (企微) Notifications (Priority: P2)

As a team lead, I want the ArgusAI Server to send notifications to our Enterprise WeChat (企微) group when tests fail so that the team is immediately aware of quality regressions without checking the dashboard.

Each team can configure a 企微 group bot webhook URL on the server. When synced test results contain failures (or other configured trigger conditions), the server sends a formatted notification to the configured webhook.

**Why this priority**: Notifications are a high-value collaboration feature but depend on the server already receiving synced data (P1). They significantly reduce mean-time-to-awareness for test failures.

**Independent Test**: Configure a webhook URL, sync a failed test run, and verify that a correctly formatted notification is sent to the webhook.

**Acceptance Scenarios**:

1. **Given** a team with a configured 企微 webhook URL and test failure notification enabled (default), **When** a synced run contains failures, **Then** a notification is sent to the 企微 group within 60 seconds of sync, including: project name, run summary (pass/fail counts), failed case names, flaky indicators, and a link to the dashboard.
2. **Given** a team with success notification enabled, **When** a synced run has 100% pass rate, **Then** a success notification is sent.
3. **Given** a team with daily digest enabled, **When** the configured digest time arrives, **Then** a daily summary is sent including: total runs, overall pass rate, new flaky tests discovered, and top failing cases.
4. **Given** a team with flaky alert enabled, **When** a newly identified flaky test is detected (first time crossing the FLAKY threshold), **Then** an alert is sent highlighting the newly flaky test with its recent history.
5. **Given** a team with no webhook configured, **When** test results are synced, **Then** no notification attempt is made and no errors occur.
6. **Given** the 企微 webhook URL is unreachable, **When** a notification is triggered, **Then** the failure is logged but does not affect data sync or any other server operation.

---

### User Story 7 — Diagnostic Pattern Sync (Priority: P2)

As a developer, I want failure patterns and fix records discovered on my local machine to be synced to the server so that teammates benefit from diagnostic knowledge without re-discovering the same patterns.

When the local diagnostics engine identifies a new failure pattern or records a fix, this information is synced to the server alongside test results. Other team members can then query the shared diagnostic knowledge base through the server API or Dashboard.

**Why this priority**: Sharing diagnostic knowledge amplifies the value of AI-driven diagnostics across the team, but requires the base sync infrastructure and pattern detection to already be working.

**Independent Test**: Generate a failure pattern locally, sync it, and verify it appears in the server's diagnostic API for the same team/project.

**Acceptance Scenarios**:

1. **Given** a local diagnostic pattern identified during a test run, **When** sync runs, **Then** the pattern (error signature, frequency, suggested fix) is uploaded to the server.
2. **Given** Developer A synced a pattern and Developer B queries the server, **When** Developer B encounters the same error, **Then** the pattern and suggested fix are available through the server API.
3. **Given** the same pattern is synced by multiple developers, **When** the server stores it, **Then** the pattern is deduplicated and its frequency count is aggregated.
4. **Given** a fix record is synced for an existing pattern, **When** the pattern is queried, **Then** the fix information is included in the response.

---

### User Story 8 — Multi-Team Dashboard (Priority: P2)

As a developer or team lead, I want to access a standalone Dashboard web application connected to the ArgusAI Server so that I can view test results, trends, and diagnostics across all projects in my team — and switch between teams if I have access to multiple.

The Dashboard is deployed as a standalone web application that authenticates against the ArgusAI Server. It provides a multi-project view within a team, team switching (if the user has keys for multiple teams), project navigation, and all the existing Dashboard features (trends, flaky, diagnostics) operating on server-side data.

**Why this priority**: The Dashboard is the primary visual interface for the server's data. It depends on the REST API and synced data being available first.

**Independent Test**: Deploy the Dashboard, authenticate, and verify that team-scoped data is displayed correctly with multi-project navigation.

**Acceptance Scenarios**:

1. **Given** a user with a valid API key, **When** they open the Dashboard and authenticate, **Then** they see a project list showing all projects for their team.
2. **Given** multiple projects in a team, **When** the user selects a project, **Then** the Dashboard shows that project's test runs, trends, flaky tests, and diagnostics.
3. **Given** a user with API keys for multiple teams, **When** they switch teams, **Then** the Dashboard updates to show the selected team's projects and data.
4. **Given** the server has synced data from multiple developers, **When** the Dashboard shows a project's run history, **Then** runs from all team members are displayed in a unified timeline.
5. **Given** no synced data exists, **When** a user opens the Dashboard, **Then** a helpful empty state is shown with guidance on how to configure sync.

---

### User Story 9 — Server Deployment & Self-Hosting (Priority: P3)

As an operations engineer, I want a Dockerfile and docker-compose.yml for the ArgusAI Server so that I can deploy it quickly on any infrastructure (self-hosted or cloud) with minimal configuration.

The server package includes production-ready deployment artifacts: a Dockerfile for the server, a docker-compose.yml that includes the server, database, and optionally the Dashboard, and environment variable documentation for configuration.

**Why this priority**: Deployment artifacts are needed for production use but can be built after the server functionality is complete. Development and testing can use local runs of the server process.

**Independent Test**: Run `docker-compose up` and verify the server starts, connects to the database, and accepts API requests.

**Acceptance Scenarios**:

1. **Given** the provided `docker-compose.yml`, **When** `docker-compose up` is run, **Then** the server, database, and Dashboard start and are accessible.
2. **Given** the Dockerfile, **When** the image is built, **Then** the image size is reasonable (under 200MB) and contains all necessary runtime dependencies.
3. **Given** environment variables for database connection and server configuration, **When** the container starts, **Then** the server connects to the configured database and is ready to accept requests.
4. **Given** no pre-existing database, **When** the server starts for the first time, **Then** the database schema is automatically created (Drizzle migrations).
5. **Given** a previously running server with data, **When** the server is restarted, **Then** all data is intact and accessible.

---

### User Story 10 — Graceful Degradation & Local-First Guarantee (Priority: P1)

As a developer, I want ArgusAI to always work locally even when the server is unavailable so that my testing workflow is never blocked by server issues.

The system follows a local-first architecture: all test execution, result storage, and basic features (flaky detection, history, diagnostics) work entirely locally. Server sync is an additive layer. If the server is down, misconfigured, or the network is unavailable, the local workflow continues without interruption.

**Why this priority**: This is a core architectural principle, not a feature. Any regression in local functionality due to server integration would be unacceptable.

**Independent Test**: Disconnect the server (remove URL, block network), run full test suites, and verify all local features work identically to a non-server configuration.

**Acceptance Scenarios**:

1. **Given** a configured server URL that is unreachable, **When** tests run, **Then** local test execution, result storage, and flaky detection all work normally.
2. **Given** the server returns errors on sync attempts, **When** tests run, **Then** the developer sees a non-blocking warning in logs but the test workflow is unaffected.
3. **Given** a server configuration is removed from `e2e.yaml`, **When** tests run, **Then** behavior is identical to a system that never had server configuration.
4. **Given** the server comes back online after a period of unavailability, **When** the next sync attempt runs, **Then** all queued results from the outage period are synced without data loss.
5. **Given** a network timeout during sync, **When** the timeout occurs, **Then** the sync is abandoned for that attempt (not blocking the developer) and retried on the next trigger.

---

### Edge Cases

- What happens when two developers sync results for the same test run simultaneously? The server should handle concurrent writes gracefully — if the same run (identified by run ID) is synced twice, the second write is treated as a no-op (idempotent sync).
- What happens when the API key is rotated while a developer has the old key configured? Sync attempts with the old key fail with 401, and the developer sees a clear error message instructing them to update their API key.
- What happens when the local SQLite database has data in the old `better-sqlite3` format after the Drizzle migration? A one-time migration process should convert the existing data to the Drizzle-managed schema. If automatic migration fails, a manual migration command should be available.
- What happens when the sync payload is very large (e.g., a test suite with 500+ cases)? The sync API should handle large payloads without timeout. If needed, payloads exceeding a configured size limit should be chunked.
- What happens when the server's database is full or the database connection is lost? The server should return a 503 Service Unavailable, and the local system should queue the sync for retry per the graceful degradation model.
- What happens when the 企微 webhook rate limit is exceeded? Notifications should be coalesced or queued to avoid hitting rate limits. A warning should be logged if notifications are being rate-limited.
- What happens when a project is deleted on the server but local clients still sync to it? The server should either reject the sync with a clear error or auto-recreate the project (consistent with the auto-registration model).
- What if the e2e.yaml `server.team` value differs from the team associated with the API key? The server should reject the request with a clear mismatch error rather than silently associating data with the wrong team.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Result Sync

- **FR-001**: System MUST support asynchronous sync of test run results (TestRun + TestCaseRun records) from local instances to a central ArgusAI Server after each test execution.
- **FR-002**: System MUST support three sync modes configurable in `e2e.yaml`: `auto` (sync after every run), `manual` (sync only on explicit trigger), and `disabled` (no sync).
- **FR-003**: System MUST implement a local sync queue that buffers results when the server is unreachable, and automatically retries when connectivity is restored.
- **FR-004**: Sync MUST be idempotent — syncing the same run (identified by run ID) multiple times must not create duplicate records on the server.
- **FR-005**: Sync MUST include: TestRun metadata (project, timestamp, git context, duration, pass/fail/skip/flaky counts, trigger source, config hash), all TestCaseRun records, and diagnostic snapshots.
- **FR-006**: System MUST sync diagnostic patterns (failure signatures, frequency, suggested fixes) and fix records to the server alongside test results.

#### Authentication & Team Management

- **FR-007**: System MUST authenticate all server API requests using an API key passed in the request header (`X-API-Key` or `Authorization: Bearer`).
- **FR-008**: System MUST support API key configuration via `e2e.yaml` (`server.apiKey`) or environment variable (`ARGUSAI_API_KEY`), with the environment variable taking precedence.
- **FR-009**: System MUST scope all data access by team — a team's API key can only access that team's data.
- **FR-010**: System MUST provide team management API endpoints: create team (generates API key), delete team, reset API key.
- **FR-011**: When an API key is reset, the old key MUST be immediately invalidated.

#### Project Management

- **FR-012**: System MUST auto-register a project when the server first receives sync data for an unrecognized project name within a team.
- **FR-013**: Project uniqueness MUST be enforced at the (team + project_name) level — different teams may have projects with the same name.
- **FR-014**: System MUST provide a project listing API endpoint that returns all projects for the authenticated team with summary statistics.

#### Database & ORM

- **FR-015**: System MUST use Drizzle ORM as the unified data access layer, replacing direct `better-sqlite3` calls.
- **FR-016**: System MUST support three database backends transparently: SQLite (local mode default), MySQL (server mode), and PostgreSQL (server mode).
- **FR-017**: System MUST provide automatic schema creation and migration via Drizzle when the application starts.
- **FR-018**: Existing local SQLite data from the pre-Drizzle implementation MUST be preserved during migration — no data loss.

#### Server REST API

- **FR-019**: System MUST provide `POST /api/sync/runs` to receive and store synced test run data from local instances.
- **FR-020**: System MUST provide `POST /api/sync/patterns` to receive and store synced diagnostic pattern data.
- **FR-021**: System MUST provide `GET /api/projects` to list all projects for the authenticated team.
- **FR-022**: System MUST provide `GET /api/runs` (paginated), `GET /api/runs/:id`, and `GET /api/runs/compare` for querying run data.
- **FR-023**: System MUST provide trend API endpoints (pass-rate, duration, flaky rankings, failure trends) consistent with the existing local API design (from 004-history).
- **FR-024**: System MUST provide diagnostic API endpoints (patterns, fixes) consistent with the existing local API design (from 005-diagnostics).
- **FR-025**: System MUST provide team management endpoints: `POST /api/teams`, `GET /api/teams`, `DELETE /api/teams/:id`, `POST /api/teams/:id/reset-key`.
- **FR-026**: All API responses MUST use consistent JSON format with appropriate HTTP status codes and error messages.

#### Enterprise WeChat (企微) Notifications

- **FR-027**: System MUST support configuring a 企微 group bot webhook URL per team on the server.
- **FR-028**: System MUST send test failure notifications to the configured 企微 webhook when synced results contain failures, including: project name, run summary, failed case names, flaky indicators, and dashboard link.
- **FR-029**: System MUST support configurable notification triggers: test failure (default on), test success (default off), daily/weekly digest (default off), new flaky test discovered (default off).
- **FR-030**: System MUST directly call the 企微 webhook API (not through any intermediary service).
- **FR-031**: Notification failures MUST NOT affect data sync or any other server operation.

#### Dashboard

- **FR-032**: Dashboard MUST support deployment as a standalone web application connected to the ArgusAI Server.
- **FR-033**: Dashboard MUST support authentication via API key (or JWT derived from API key).
- **FR-034**: Dashboard MUST provide a multi-project view showing all projects within the authenticated team.
- **FR-035**: Dashboard MUST support team switching for users with access to multiple teams.
- **FR-036**: Dashboard MUST display unified test run history from all team members who have synced results.
- **FR-037**: Dashboard MUST provide all existing visualization features (trends, flaky, diagnostics) operating on server-side data.

#### Graceful Degradation

- **FR-038**: System MUST guarantee that all local functionality (test execution, local storage, flaky detection, local history, local diagnostics) works without any server configuration.
- **FR-039**: System MUST guarantee that server unavailability does not block, slow down, or alter local test execution in any way.
- **FR-040**: System MUST log server connectivity issues as warnings, never as errors that would cause non-zero exit codes.
- **FR-041**: System MUST automatically recover synced data from the local queue when server connectivity is restored.

#### Configuration

- **FR-042**: System MUST extend the `e2e.yaml` schema to include an optional `server` section with fields: `url`, `apiKey`, `sync` (auto | manual | disabled), and `team`.
- **FR-043**: Omitting the `server` section entirely MUST result in behavior identical to the current system (fully local, no changes).

### Key Entities

- **Team**: An organizational unit on the ArgusAI Server. Has a unique name, a single API key, and optional notification configuration (企微 webhook URL, notification triggers). All data is scoped by team.
- **Project**: A test target within a team, uniquely identified by (team + project_name). Auto-registered on first sync. Contains aggregated statistics and links to runs.
- **TestRun** (server-side): A synced copy of a local TestRun record, enriched with the team and source developer context. Contains all run-level metadata.
- **TestCaseRun** (server-side): A synced copy of a local TestCaseRun record. Linked to a server-side TestRun.
- **DiagnosticPattern** (server-side): A synced copy of a locally identified failure pattern, deduplicated and aggregated across team members. Contains error signature, frequency, and suggested fixes.
- **SyncQueue**: A local queue of pending sync payloads that have not yet been successfully delivered to the server. Managed by the local system, persisted across restarts.
- **NotificationConfig**: Per-team notification settings including the 企微 webhook URL and which trigger conditions are enabled.
- **RemoteHistoryStore**: A new implementation of the HistoryStore interface that writes locally and asynchronously syncs to the server. Replaces the local-only store when server configuration is present.

---

## Non-Functional Requirements

- **NFR-001**: Sync overhead MUST NOT increase local test execution time by more than 5% — sync is asynchronous and non-blocking.
- **NFR-002**: The server MUST handle at least 100 concurrent sync requests without degradation.
- **NFR-003**: Server API response time for query endpoints MUST be under 2 seconds for datasets up to 10,000 runs per project.
- **NFR-004**: The sync queue MUST be persisted locally so that pending syncs survive process restarts.
- **NFR-005**: The Drizzle ORM migration from `better-sqlite3` MUST be backward-compatible — existing local installations MUST continue to work without manual intervention.
- **NFR-006**: The server Docker image MUST be under 200MB in size.
- **NFR-007**: 企微 notifications MUST be sent within 60 seconds of receiving synced results that match trigger conditions.
- **NFR-008**: The server MUST start and be ready to accept requests within 10 seconds.
- **NFR-009**: All server endpoints MUST be documented with OpenAPI/Swagger specifications.
- **NFR-010**: The server package MUST follow existing monorepo conventions (TypeScript strict mode, ESM, pnpm, Vitest).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can configure server sync (add `server` section to `e2e.yaml`) and see their first test run on the server Dashboard in under 5 minutes of setup time.
- **SC-002**: 100% of local test runs produce correct results regardless of server availability — zero regressions in local-only mode.
- **SC-003**: Synced test results appear on the server within 30 seconds of local test completion under normal network conditions.
- **SC-004**: Teams using the server can view unified test history from all team members within a single Dashboard view.
- **SC-005**: 企微 notifications for test failures are delivered within 60 seconds of the triggering sync, with correct content (project name, failed cases, flaky info, dashboard link).
- **SC-006**: The Drizzle ORM migration preserves 100% of existing local SQLite data — no records lost or corrupted.
- **SC-007**: The same ArgusAI codebase runs correctly against SQLite, MySQL, and PostgreSQL without any code-level conditional logic exposed to feature developers.
- **SC-008**: Server self-hosting via `docker-compose up` results in a fully operational system (server + database + Dashboard) within 2 minutes.
- **SC-009**: Data isolation between teams is complete — no API call with Team A's key can access Team B's data under any circumstances.
- **SC-010**: The sync queue successfully delivers all pending results after a server outage of up to 24 hours, with zero data loss.

---

## Assumptions

- The result sync model (local execution + async upload) is the correct architectural choice for this stage. Remote test execution (running Docker on the server) is explicitly out of scope.
- Drizzle ORM can handle the SQLite/MySQL/PostgreSQL abstraction without significant performance overhead compared to direct `better-sqlite3` calls.
- Team-level API key granularity is sufficient for the initial release. Per-user authentication with role-based access control may be added in a future iteration.
- 企微 group bot webhooks are the only notification channel needed initially. Other channels (email, Slack, Telegram) may be added later through the same notification framework.
- The existing HistoryStore interface is flexible enough to accommodate the new RemoteHistoryStore implementation without interface changes.
- Auto-project-registration (no approval workflow) is acceptable for all target deployment environments. Organizations requiring approval can implement it at the network/proxy level.
- The local sync queue can use a simple file-based persistence mechanism (e.g., a JSON file or small SQLite table) without needing a dedicated message queue.
- The Dashboard's standalone deployment mode can share the existing React codebase with minimal modifications (primarily configuration changes for API endpoint and authentication).
- Docker Compose is the standard deployment mechanism for self-hosted instances. Kubernetes/Helm charts are out of scope for the initial release.

---

## Implementation Phases (Suggested)

These phases are included for context on expected delivery order, not as implementation directives:

- **P1 — Core Infrastructure**: Server REST API, Drizzle ORM migration, RemoteHistoryStore, result sync pipeline, API key authentication, team/project management.
- **P2 — Collaboration Features**: Dashboard standalone mode, multi-team view, 企微 notifications, diagnostic pattern sync, team-wide trend analysis.
- **P3 — Deployment & Onboarding**: Dockerfile, docker-compose.yml, onboarding documentation, migration tooling for existing users.
