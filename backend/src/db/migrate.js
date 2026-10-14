import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

/**
 * Tiny, dependency-free SQL migration runner.
 * - every .sql file in migrations/ is applied exactly once, in filename order
 * - applied migrations are recorded in schema_migrations
 * - each file runs inside a transaction (atomic)
 */
export function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
      newlyApplied.push(file);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
  return newlyApplied;
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const applied = migrate();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
}
