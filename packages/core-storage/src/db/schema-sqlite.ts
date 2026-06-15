import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// =====================================================================
// test_runs — matches migrations.ts v1 + new server columns (v3)
// =====================================================================

export const testRuns = sqliteTable('test_runs', {
  id: text('id').primaryKey(),
  project: text('project').notNull(),
  timestamp: integer('timestamp').notNull(),
  gitCommit: text('git_commit'),
  gitBranch: text('git_branch'),
  configHash: text('config_hash').notNull(),
  trigger: text('trigger').notNull(),
  duration: integer('duration').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  // Server columns (v3, all nullable for backward compat)
  teamId: text('team_id'),
  projectId: text('project_id'),
  sourceDeveloper: text('source_developer'),
  syncedAt: text('synced_at'),
}, (table) => [
  index('idx_runs_project_ts').on(table.project, table.timestamp),
  index('idx_runs_project_status').on(table.project, table.status),
  index('idx_runs_team_project').on(table.teamId, table.projectId, table.timestamp),
]);

// =====================================================================
// test_case_runs — matches migrations.ts v1
// =====================================================================

export const testCaseRuns = sqliteTable('test_case_runs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => testRuns.id, { onDelete: 'cascade' }),
  suiteId: text('suite_id').notNull(),
  caseName: text('case_name').notNull(),
  status: text('status').notNull(),
  duration: integer('duration').notNull().default(0),
  attempts: integer('attempts').notNull().default(1),
  responseMs: integer('response_ms'),
  assertions: integer('assertions'),
  error: text('error'),
  snapshot: text('snapshot'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_cases_run_id').on(table.runId),
  index('idx_cases_suite_case').on(table.suiteId, table.caseName),
  index('idx_cases_name_ts').on(table.caseName, table.createdAt),
]);

// =====================================================================
// failure_patterns — matches migrations.ts v2 + new server columns (v3)
// =====================================================================

export const failurePatterns = sqliteTable('failure_patterns', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  signature: text('signature').notNull().unique(),
  signaturePattern: text('signature_pattern').notNull(),
  description: text('description').notNull().default(''),
  suggestedFix: text('suggested_fix').notNull().default(''),
  confidence: real('confidence').notNull().default(0.5),
  occurrences: integer('occurrences').notNull().default(0),
  resolutions: integer('resolutions').notNull().default(0),
  source: text('source').notNull().default('learned'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // Server columns (v3, nullable)
  teamId: text('team_id'),
  projectId: text('project_id'),
}, (table) => [
  index('idx_patterns_signature').on(table.signature),
  index('idx_patterns_category').on(table.category),
  index('idx_patterns_source').on(table.source),
  index('idx_patterns_team_sig').on(table.teamId, table.signature),
]);

// =====================================================================
// fix_history — matches migrations.ts v2
// =====================================================================

export const fixHistory = sqliteTable('fix_history', {
  id: text('id').primaryKey(),
  patternId: text('pattern_id').notNull().references(() => failurePatterns.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull(),
  caseName: text('case_name').notNull(),
  fixDescription: text('fix_description').notNull(),
  success: integer('success').notNull().default(1),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_fix_history_pattern').on(table.patternId, table.createdAt),
  index('idx_fix_history_run').on(table.runId),
]);

// =====================================================================
// sync_queue — local only (v3)
// =====================================================================

export const syncQueue = sqliteTable('sync_queue', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(10),
  createdAt: text('created_at').notNull(),
  nextRetryAt: text('next_retry_at').notNull(),
  lastError: text('last_error'),
}, (table) => [
  index('idx_sync_queue_status').on(table.status, table.nextRetryAt),
]);

// =====================================================================
// Server-only tables (for SQLite server mode)
// =====================================================================

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  lastSyncAt: text('last_sync_at'),
  totalRuns: integer('total_runs').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_projects_team_name').on(table.teamId, table.name),
  index('idx_projects_team_id').on(table.teamId),
]);

export const notificationConfigs = sqliteTable('notification_configs', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().unique().references(() => teams.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url'),
  onFailure: integer('on_failure').notNull().default(1),
  onSuccess: integer('on_success').notNull().default(0),
  onNewFlaky: integer('on_new_flaky').notNull().default(0),
  dailyDigest: integer('daily_digest').notNull().default(0),
  digestTime: text('digest_time').default('09:00'),
  digestTimezone: text('digest_timezone').default('Asia/Shanghai'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
