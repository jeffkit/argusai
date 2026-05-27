import { z } from 'zod';

export const ServerEnvConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_DIALECT: z.enum(['sqlite', 'pg', 'mysql']).default('pg'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ServerEnvConfig = z.infer<typeof ServerEnvConfigSchema>;

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerEnvConfig {
  return ServerEnvConfigSchema.parse(env);
}
