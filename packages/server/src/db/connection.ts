import { createDb } from 'argusai-core';
import type { AnyDb, DbDialect } from 'argusai-core';
import type { ServerEnvConfig } from '../config.js';

/**
 * Create the server's Drizzle database instance from server env config.
 * Returns a typed Drizzle instance for the configured dialect.
 */
export async function createServerDb(config: ServerEnvConfig): Promise<AnyDb> {
  const dialect = config.DATABASE_DIALECT as DbDialect;

  return createDb({
    dialect,
    connectionString: config.DATABASE_URL,
    filePath: dialect === 'sqlite' ? config.DATABASE_URL : undefined,
  });
}
