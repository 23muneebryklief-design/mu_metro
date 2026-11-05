import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Database = DatabaseSync;
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  return db;
}

export function migrate(db: Database, directory = resolve('migrations')) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
  for (const name of readdirSync(directory).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    transaction(db, () => {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) return;
      db.exec(readFileSync(resolve(directory, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, new Date().toISOString());
    });
  }
}
