import { mysqlTable, text, varchar, int, bigint, double, datetime, boolean, index, uniqueIndex } from 'drizzle-orm/mysql-core';

// =====================================================================
// teams (server only)
// =====================================================================

export const teams = mysqlTable('teams', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  apiKeyHash: varchar('api_key_hash', { length: 64 }).notNull().unique(),
  apiKeyPrefix: varchar('api_key_prefix', { length: 8 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
});

// =====================================================================
// projects (server only)
// =====================================================================

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  teamId: varchar('team_id', { length: 36 }).notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  lastSyncAt: datetime('last_sync_at', { mode: 'string' }),
  totalRuns: int('total_runs').notNull().default(0),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
}, (table) => [
  uniqueIndex('idx_projects_team_name').on(table.teamId, table.name),
  index('idx_projects_team_id').on(table.teamId),
]);

// =====================================================================
// test_runs
// =====================================================================

export const testRuns = mysqlTable('test_runs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  project: varchar('project', { length: 200 }).notNull(),
  teamId: varchar('team_id', { length: 36 }).references(() => teams.id, { onDelete: 'cascade' }),
  projectId: varchar('project_id', { length: 36 }).references(() => projects.id, { onDelete: 'cascade' }),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  gitCommit: varchar('git_commit', { length: 40 }),
  gitBranch: varchar('git_branch', { length: 200 }),
  configHash: varchar('config_hash', { length: 64 }).notNull(),
  trigger: varchar('trigger', { length: 20 }).notNull(),
  duration: int('duration').notNull().default(0),
  passed: int('passed').notNull().default(0),
  failed: int('failed').notNull().default(0),
  skipped: int('skipped').notNull().default(0),
  flaky: int('flaky').notNull().default(0),
  status: varchar('status', { length: 10 }).notNull(),
  sourceDeveloper: varchar('source_developer', { length: 200 }),
  syncedAt: datetime('synced_at', { mode: 'string' }),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
}, (table) => [
  index('idx_runs_project_ts').on(table.project, table.timestamp),
  index('idx_runs_project_status').on(table.project, table.status),
  index('idx_runs_team_project').on(table.teamId, table.projectId, table.timestamp),
]);

// =====================================================================
// test_case_runs
// =====================================================================

export const testCaseRuns = mysqlTable('test_case_runs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  runId: varchar('run_id', { length: 36 }).notNull().references(() => testRuns.id, { onDelete: 'cascade' }),
  suiteId: varchar('suite_id', { length: 200 }).notNull(),
  caseName: varchar('case_name', { length: 500 }).notNull(),
  status: varchar('status', { length: 10 }).notNull(),
  duration: int('duration').notNull().default(0),
  attempts: int('attempts').notNull().default(1),
  responseMs: int('response_ms'),
  assertions: int('assertions'),
  error: text('error'),
  snapshot: text('snapshot'),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
}, (table) => [
  index('idx_cases_run_id').on(table.runId),
  index('idx_cases_suite_case').on(table.suiteId, table.caseName),
  index('idx_cases_name_ts').on(table.caseName, table.createdAt),
]);

// =====================================================================
// failure_patterns
// =====================================================================

export const failurePatterns = mysqlTable('failure_patterns', {
  id: varchar('id', { length: 36 }).primaryKey(),
  category: varchar('category', { length: 30 }).notNull(),
  signature: varchar('signature', { length: 500 }).notNull().unique(),
  signaturePattern: text('signature_pattern').notNull(),
  description: text('description').notNull(),
  suggestedFix: text('suggested_fix').notNull(),
  confidence: double('confidence').notNull().default(0.5),
  occurrences: int('occurrences').notNull().default(0),
  resolutions: int('resolutions').notNull().default(0),
  source: varchar('source', { length: 10 }).notNull().default('learned'),
  firstSeenAt: datetime('first_seen_at', { mode: 'string' }).notNull(),
  lastSeenAt: datetime('last_seen_at', { mode: 'string' }).notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  teamId: varchar('team_id', { length: 36 }).references(() => teams.id, { onDelete: 'cascade' }),
  projectId: varchar('project_id', { length: 36 }).references(() => projects.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_patterns_signature').on(table.signature),
  index('idx_patterns_category').on(table.category),
  index('idx_patterns_source').on(table.source),
  index('idx_patterns_team_sig').on(table.teamId, table.signature),
]);

// =====================================================================
// fix_history
// =====================================================================

export const fixHistory = mysqlTable('fix_history', {
  id: varchar('id', { length: 36 }).primaryKey(),
  patternId: varchar('pattern_id', { length: 36 }).notNull().references(() => failurePatterns.id, { onDelete: 'cascade' }),
  runId: varchar('run_id', { length: 36 }).notNull(),
  caseName: varchar('case_name', { length: 500 }).notNull(),
  fixDescription: text('fix_description').notNull(),
  success: int('success').notNull().default(1),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
}, (table) => [
  index('idx_fix_history_pattern').on(table.patternId, table.createdAt),
  index('idx_fix_history_run').on(table.runId),
]);

// =====================================================================
// notification_configs (server only)
// =====================================================================

export const notificationConfigs = mysqlTable('notification_configs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  teamId: varchar('team_id', { length: 36 }).notNull().unique().references(() => teams.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url'),
  onFailure: boolean('on_failure').notNull().default(true),
  onSuccess: boolean('on_success').notNull().default(false),
  onNewFlaky: boolean('on_new_flaky').notNull().default(false),
  dailyDigest: boolean('daily_digest').notNull().default(false),
  digestTime: varchar('digest_time', { length: 5 }).default('09:00'),
  digestTimezone: varchar('digest_timezone', { length: 50 }).default('Asia/Shanghai'),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
});
