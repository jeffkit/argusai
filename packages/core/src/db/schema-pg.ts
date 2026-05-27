import { pgTable, text, integer, bigint, real, timestamp, uuid, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core';

// =====================================================================
// teams (server only)
// =====================================================================

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
});

// =====================================================================
// projects (server only)
// =====================================================================

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  lastSyncAt: timestamp('last_sync_at', { mode: 'string' }),
  totalRuns: integer('total_runs').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_projects_team_name').on(table.teamId, table.name),
  index('idx_projects_team_id').on(table.teamId),
]);

// =====================================================================
// test_runs
// =====================================================================

export const testRuns = pgTable('test_runs', {
  id: text('id').primaryKey(),
  project: text('project').notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
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
  sourceDeveloper: text('source_developer'),
  syncedAt: timestamp('synced_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_runs_project_ts').on(table.project, table.timestamp),
  index('idx_runs_project_status').on(table.project, table.status),
  index('idx_runs_team_project').on(table.teamId, table.projectId, table.timestamp),
]);

// =====================================================================
// test_case_runs
// =====================================================================

export const testCaseRuns = pgTable('test_case_runs', {
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
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_cases_run_id').on(table.runId),
  index('idx_cases_suite_case').on(table.suiteId, table.caseName),
  index('idx_cases_name_ts').on(table.caseName, table.createdAt),
]);

// =====================================================================
// failure_patterns
// =====================================================================

export const failurePatterns = pgTable('failure_patterns', {
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
  firstSeenAt: timestamp('first_seen_at', { mode: 'string' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { mode: 'string' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_patterns_signature').on(table.signature),
  index('idx_patterns_category').on(table.category),
  index('idx_patterns_source').on(table.source),
  index('idx_patterns_team_sig').on(table.teamId, table.signature),
]);

// =====================================================================
// fix_history
// =====================================================================

export const fixHistory = pgTable('fix_history', {
  id: text('id').primaryKey(),
  patternId: text('pattern_id').notNull().references(() => failurePatterns.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull(),
  caseName: text('case_name').notNull(),
  fixDescription: text('fix_description').notNull(),
  success: integer('success').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_fix_history_pattern').on(table.patternId, table.createdAt),
  index('idx_fix_history_run').on(table.runId),
]);

// =====================================================================
// notification_configs (server only)
// =====================================================================

export const notificationConfigs = pgTable('notification_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().unique().references(() => teams.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url'),
  onFailure: boolean('on_failure').notNull().default(true),
  onSuccess: boolean('on_success').notNull().default(false),
  onNewFlaky: boolean('on_new_flaky').notNull().default(false),
  dailyDigest: boolean('daily_digest').notNull().default(false),
  digestTime: text('digest_time').default('09:00'),
  digestTimezone: text('digest_timezone').default('Asia/Shanghai'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
});
