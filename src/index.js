import { encode, isPlainObject } from './sql.js';
import { Model } from './model.js';

const { DatabaseSync } = await import('node:sqlite').catch(() => {
  throw new Error(`sqlite-light needs Node.js 22.13+ (built-in node:sqlite). You are on ${process.version}.`);
});

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };
const MAX_CACHED_STATEMENTS = 500;
const SCHEMA_CHANGE = /^\s*(CREATE|ALTER|DROP)\b/i;

function encodeParams(params) {
  if (Array.isArray(params)) return params.map(encode);
  if (isPlainObject(params)) {
    return [Object.fromEntries(Object.entries(params).map(([k, v]) => [k, encode(v)]))];
  }
  return params === undefined ? [] : [encode(params)];
}

function isUnsafeBigInt(value) {
  return typeof value === 'bigint' && (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER));
}

function checkBigInts(args) {
  const values = args.flatMap(arg => (isPlainObject(arg) ? Object.values(arg) : [arg]));
  if (!values.some(isUnsafeBigInt)) return args;
  throw new Error('sqlite-light: integer is too large for a JS number — connect with { bigInts: true } to store it');
}

function isThenable(value) {
  return value !== null && typeof value?.then === 'function';
}

class SqliteLight {
  #db = null;
  #logger = null;
  #statements = new Map();
  #depth = 0;

  #bigInts = false;

  constructor(db, logger, bigInts) {
    this.#db = db;
    this.#logger = logger;
    this.#bigInts = bigInts;
  }

  #params(params) {
    const args = encodeParams(params);
    return this.#bigInts ? args : checkBigInts(args);
  }

  #toInt(value) {
    return this.#bigInts ? value : Number(value);
  }

  #prepare(sql) {
    this.#logger.debug(`SQL: ${sql}`);
    if (this.#statements.has(sql)) return this.#statements.get(sql);
    if (this.#statements.size >= MAX_CACHED_STATEMENTS) this.#statements.delete(this.#statements.keys().next().value);
    const statement = this.#db.prepare(sql);
    statement.setReadBigInts(this.#bigInts);
    this.#statements.set(sql, statement);
    return statement;
  }

  query(sql, params) {
    return this.#prepare(sql).all(...this.#params(params)).map(row => ({ ...row }));
  }

  get(sql, params) {
    const row = this.#prepare(sql).get(...this.#params(params));
    return row ? { ...row } : null;
  }

  run(sql, params) {
    const { changes, lastInsertRowid } = this.#prepare(sql).run(...this.#params(params));
    if (SCHEMA_CHANGE.test(sql)) this.#statements.clear();
    return { changes: Number(changes), lastInsertRowid: this.#toInt(lastInsertRowid) };
  }

  exec(sql) {
    this.#logger.debug(`SQL: ${sql}`);
    this.#db.exec(sql);
    this.#statements.clear();
    return this;
  }

  #begin(name) {
    this.#db.exec(this.#depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.#depth += 1;
  }

  #commit(name) {
    this.#db.exec(this.#depth === 1 ? 'COMMIT' : `RELEASE ${name}`);
    this.#depth -= 1;
  }

  // Never throws: a failed rollback (e.g. SQLite already rolled back) must not hide the original error.
  #rollback(name) {
    const sql = this.#depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`;
    this.#depth -= 1;
    try {
      this.#db.exec(sql);
    } catch (error) {
      this.#logger.error(`Rollback failed: ${error.message}`);
    }
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
      this.#logger.error(`Transaction rolled back: ${error?.message ?? error}`);
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

function busyTimeout(value = 5000) {
  if (Number.isInteger(value) && value >= 0) return value;
  throw new Error(`sqlite-light: busyTimeout must be a non-negative integer, got ${value}`);
}

function applyPragmas(db, path, options) {
  db.exec(`PRAGMA busy_timeout = ${busyTimeout(options.busyTimeout)}`);
  db.exec(`PRAGMA foreign_keys = ${options.foreignKeys === false ? 'OFF' : 'ON'}`);
  const wal = options.wal ?? (path !== ':memory:' && !options.readOnly);
  if (wal) db.exec('PRAGMA journal_mode = WAL');
}

export function connectDB(path = ':memory:', options = {}) {
  const logger = options.logger || SILENT;
  const db = new DatabaseSync(path, { readOnly: Boolean(options.readOnly) });
  applyPragmas(db, path, options);
  logger.info(`SQLite connected: ${path}`);
  return new SqliteLight(db, logger, Boolean(options.bigInts));
}

export { Model, DatabaseSync };
