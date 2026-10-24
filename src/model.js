import { quote, buildWhere, buildOptions, buildInsert, buildUpdate } from './sql.js';
import { normalizeSchema, createTableSql, decodeRow } from './schema.js';

function requireConditions(conditions, method) {
  if (Object.keys(conditions || {}).length > 0) return;
  throw new Error(`sqlite-light: ${method}() needs conditions — refusing to touch every row`);
}

export class Model {
  #db = null;
  #table = null;
  #fields = null;
  #timestamps = false;

  constructor(db, table, schema, options = {}) {
    this.#db = db;
    this.#table = table;
    this.#fields = normalizeSchema(schema, options);
    this.#timestamps = Boolean(options.timestamps);
    if (schema) db.exec(createTableSql(table, this.#fields));
  }

  get table() {
    return this.#table;
  }

  #rows(sql, values) {
    return this.#db.query(sql, values).map(row => decodeRow(row, this.#fields));
  }

  find(conditions = {}, options = {}) {
    const where = buildWhere(conditions);
    const sql = `SELECT * FROM ${quote(this.#table)}${where.sql}${buildOptions(options)}`;
    return this.#rows(sql, where.values);
  }

  findOne(conditions = {}, options = {}) {
    return this.find(conditions, { ...options, limit: 1 })[0] || null;
  }

  findById(id) {
    return this.findOne({ id });
  }

  create(data = {}) {
    const now = new Date();
    const row = this.#timestamps ? { createdAt: now, updatedAt: now, ...data } : data;
    const { sql, values } = buildInsert(this.#table, row);
    return this.#rows(sql, values)[0];
  }

  createMany(list) {
    return this.#db.transaction(() => list.map(data => this.create(data)));
  }

  update(conditions, data) {
    requireConditions(conditions, 'update');
    const changes = this.#timestamps ? { updatedAt: new Date(), ...data } : data;
    const { sql, values } = buildUpdate(this.#table, changes, conditions);
    return this.#rows(sql, values);
  }

  updateById(id, data) {
    return this.update({ id }, data)[0] || null;
  }

  delete(conditions) {
    requireConditions(conditions, 'delete');
    const where = buildWhere(conditions);
    return this.#rows(`DELETE FROM ${quote(this.#table)}${where.sql} RETURNING *`, where.values);
  }

  deleteById(id) {
    return this.delete({ id })[0] || null;
  }

  count(conditions = {}) {
    const where = buildWhere(conditions);
    const sql = `SELECT COUNT(*) AS count FROM ${quote(this.#table)}${where.sql}`;
    return Number(this.#db.query(sql, where.values)[0].count);
  }

  exists(conditions = {}) {
    return this.findOne(conditions) !== null;
  }
}
