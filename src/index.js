import { encode } from './sql.js';
import { Model } from './model.js';

const { DatabaseSync } = await import('node:sqlite').catch(() => {
  throw new Error(`sqlite-light needs Node.js 22.13+ (built-in node:sqlite). You are on ${process.version}.`);
});

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };
const MAX_CACHED_STATEMENTS = 500;

function isNamedParams(params) {
  if (params === null || typeof params !== 'object') return false;
  const proto = Object.getPrototypeOf(params);
  return proto === Object.prototype || proto === null;
}

function encodeParams(params) {
  if (Array.isArray(params)) return params.map(encode);
  if (isNamedParams(params)) {
    return [Object.fromEntries(Object.entries(params).map(([k, v]) => [k, encode(v)]))];
  }
  return params === undefined ? [] : [encode(params)];
}

function isThenable(value) {
  return value !== null && typeof value?.then === 'function';
}

class SqliteLight {
  #db = null;
  #logger = null;
  #statements = new Map();
  #depth = 0;

  constructor(db, logger) {
    this.#db = db;
    this.#logger = logger;
  }

  #prepare(sql) {
    this.#logger.debug(`SQL: ${sql}`);
    if (this.#statements.has(sql)) return this.#statements.get(sql);
    if (this.#statements.size >= MAX_CACHED_STATEMENTS) this.#statements.delete(this.#statements.keys().next().value);
    this.#statements.set(sql, this.#db.prepare(sql));
    return this.#statements.get(sql);
  }

  query(sql, params) {
    return this.#prepare(sql).all(...encodeParams(params)).map(row => ({ ...row }));
  }

  get(sql, params) {
    const row = this.#prepare(sql).get(...encodeParams(params));
    return row ? { ...row } : null;
  }

  run(sql, params) {
    const { changes, lastInsertRowid } = this.#prepare(sql).run(...encodeParams(params));
    return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
  }

  exec(sql) {
    this.#logger.debug(`SQL: ${sql}`);
    this.#db.exec(sql);
    return this;
  }

  #begin(name) {
    this.#db.exec(this.#depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.#depth += 1;
  }

  #commit(name) {
    this.#depth -= 1;
    this.#db.exec(this.#depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
  }

  #rollback(name) {
    this.#depth -= 1;
    this.#db.exec(this.#depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
  }

  transaction(callback) {
    const name = `sl_${this.#depth}`;
    this.#begin(name);
    try {
      const result = callback(this);
      if (isThenable(result)) throw new Error('sqlite-light: transaction() callbacks must be synchronous');
      this.#commit(name);
      return result;
    } catch (error) {
      this.#rollback(name);
      this.#logger.error(`Transaction rolled back: ${error.message}`);
      throw error;
    }
  }

  model(table, schema, options) {
    return new Model(this, table, schema, options);
  }

  close() {
    this.#statements.clear();
    this.#db.close();
    this.#logger.info('Database connection closed');
  }

  get raw() {
    return this.#db;
  }
}

function applyPragmas(db, path, options) {
  db.exec(`PRAGMA busy_timeout = ${Number(options.busyTimeout ?? 5000)}`);
  db.exec(`PRAGMA foreign_keys = ${options.foreignKeys === false ? 'OFF' : 'ON'}`);
  const wal = options.wal ?? (path !== ':memory:' && !options.readOnly);
  if (wal) db.exec('PRAGMA journal_mode = WAL');
}

export function connectDB(path = ':memory:', options = {}) {
  const logger = options.logger || SILENT;
  const db = new DatabaseSync(path, { readOnly: Boolean(options.readOnly) });
  applyPragmas(db, path, options);
  logger.info(`SQLite connected: ${path}`);
  return new SqliteLight(db, logger);
}

export { Model, DatabaseSync };
