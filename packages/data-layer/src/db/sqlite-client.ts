import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './sqlite-schema.js';

export type SqliteClient = ReturnType<typeof createSqliteClient>;

export interface SqliteClientOptions {
  /** Path to the SQLite database file. Use ':memory:' for in-memory. */
  path: string;
  /** Enable WAL mode for better concurrent read performance. Defaults to true. */
  wal?: boolean;
}

export function createSqliteClient(opts: SqliteClientOptions): ReturnType<typeof drizzle<typeof schema>> {
  if (opts.path !== ':memory:') {
    mkdirSync(dirname(opts.path), { recursive: true });
  }
  const sqlite = new Database(opts.path);

  // Enable WAL mode for better concurrent read performance
  if (opts.wal !== false) {
    sqlite.pragma('journal_mode = WAL');
  }

  // Recommended SQLite pragmas for performance
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  return drizzle(sqlite, { schema });
}
