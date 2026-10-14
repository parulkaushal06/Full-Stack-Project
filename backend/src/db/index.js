import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from '../config.js';

let db = null;

/**
 * Opens (or returns) the SQLite connection.
 * Uses node:sqlite (built into Node >= 22) - no native build step needed.
 */
export function getDb() {
  if (db) return db;

  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }

  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (config.dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;'); // better concurrent reads
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/** Typed convenience helpers around prepared statements (positional ? params). */
export const query = {
  all(sql, ...params) {
    return getDb().prepare(sql).all(...params);
  },
  get(sql, ...params) {
    return getDb().prepare(sql).get(...params);
  },
  run(sql, ...params) {
    const res = getDb().prepare(sql).run(...params);
    return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
  },
  /** Run several statements atomically. */
  exec(sql) {
    getDb().exec(sql);
  },
  /** fn runs inside BEGIN/COMMIT, rolls back on throw. */
  tx(fn) {
    const database = getDb();
    database.exec('BEGIN');
    try {
      const result = fn();
      database.exec('COMMIT');
      return result;
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  },
};
