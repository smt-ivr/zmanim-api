// Minimal in-memory D1 stand-in on node:sqlite (tests only).
import { DatabaseSync } from 'node:sqlite';

const returnsRows = (sql) => /^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql);
const norm = (v) => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v);

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params.map(norm)); }
  _exec() {
    const stmt = this.db.prepare(this.sql);
    if (returnsRows(this.sql)) return { results: stmt.all(...this.params).map((r) => ({ ...r })), success: true, meta: {} };
    const info = stmt.run(...this.params);
    return { results: [], success: true, meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
  }
  async first() { return this._exec().results[0] ?? null; }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
}

export class D1Shim {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try { const out = stmts.map((s) => s._exec()); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
