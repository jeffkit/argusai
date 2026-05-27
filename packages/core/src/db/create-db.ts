import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteSchema from './schema-sqlite.js';

export type DbDialect = 'sqlite' | 'pg' | 'mysql';

export interface DbConfig {
  dialect: DbDialect;
  connectionString?: string;
  filePath?: string;
}

export type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

export type AnyDb = SqliteDb | ReturnType<typeof import('drizzle-orm/node-postgres').drizzle> | ReturnType<typeof import('drizzle-orm/mysql2').drizzle>;

/**
 * Create a Drizzle database instance from a pre-opened better-sqlite3 Database.
 * Used by the local factory path where migrations have already been applied.
 */
export function createSqliteDbFromDatabase(database: import('better-sqlite3').Database): SqliteDb {
  return drizzleSqlite(database, { schema: sqliteSchema });
}

/**
 * Create a Drizzle DB instance based on the dialect configuration.
 * For SQLite, provide `filePath`. For PG/MySQL, provide `connectionString`.
 */
export async function createDb(config: DbConfig): Promise<AnyDb> {
  switch (config.dialect) {
    case 'sqlite': {
      const Database = (await import('better-sqlite3')).default;
      const filePath = config.filePath ?? config.connectionString ?? ':memory:';
      const database = new Database(filePath);
      database.pragma('journal_mode = WAL');
      database.pragma('foreign_keys = ON');
      return drizzleSqlite(database, { schema: sqliteSchema });
    }

    case 'pg': {
      if (!config.connectionString) {
        throw new Error('connectionString is required for PostgreSQL dialect');
      }
      const { drizzle } = await import('drizzle-orm/node-postgres');
      const pgSchema = await import('./schema-pg.js');
      // Dynamic import with variable to avoid TS declaration file check for optional peer dep
      const pgModuleName = 'pg';
      const pg = await import(/* webpackIgnore: true */ pgModuleName) as any;
      const Pool = pg.default?.Pool ?? pg.Pool;
      const pool = new Pool({ connectionString: config.connectionString });
      return drizzle(pool, { schema: pgSchema });
    }

    case 'mysql': {
      if (!config.connectionString) {
        throw new Error('connectionString is required for MySQL dialect');
      }
      const { drizzle } = await import('drizzle-orm/mysql2');
      const mysqlSchema = await import('./schema-mysql.js');
      const mysqlModuleName = 'mysql2/promise';
      const mysql = await import(/* webpackIgnore: true */ mysqlModuleName) as any;
      const pool = mysql.default?.createPool?.(config.connectionString) ?? mysql.createPool(config.connectionString);
      return drizzle(pool, { schema: mysqlSchema, mode: 'default' });
    }

    default:
      throw new Error(`Unsupported dialect: ${config.dialect as string}`);
  }
}
