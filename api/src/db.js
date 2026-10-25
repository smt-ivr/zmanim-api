// Thin helpers over D1. Every query is parameterized; table/column names never come from input.

export const q = (env, sql, ...params) => env.DB.prepare(sql).bind(...params);
export const first = (env, sql, ...params) => q(env, sql, ...params).first();
export const run = (env, sql, ...params) => q(env, sql, ...params).run();
export const all = async (env, sql, ...params) => (await q(env, sql, ...params).all()).results;
export const batch = (env, statements) => env.DB.batch(statements);

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const nowSec = () => Math.floor(Date.now() / 1000);
export const bool = (v) => v === 1 || v === true;

/** "?, ?, ?" for an IN list. */
export const marks = (n) => Array(n).fill('?').join(', ');

/** Builds "SET a = ?, b = ?" from a whitelist of columns present in `data`. */
export function setClause(data, columns, transform = {}) {
  const keys = columns.filter((c) => data[c] !== undefined);
  return {
    keys,
    sql: keys.map((k) => `${k} = ?`).join(', '),
    params: keys.map((k) => (transform[k] ? transform[k](data[k]) : typeof data[k] === 'boolean' ? (data[k] ? 1 : 0) : data[k])),
  };
}
