const OPERATORS = {
  $eq: '=',
  $ne: '!=',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
  $like: 'LIKE',
};

export function quote(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && value.constructor === Object;
}

export function encode(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value);
  return value;
}

function inClause(column, list) {
  if (list.length === 0) return { sql: '0', values: [] };
  const marks = list.map(() => '?').join(', ');
  return { sql: `${column} IN (${marks})`, values: list.map(encode) };
}

function compare(column, op, value) {
  if (op === '$in') return inClause(column, value);
  if (op === '$nin') return negate(inClause(column, value));
  if (value === null && op === '$eq') return { sql: `${column} IS NULL`, values: [] };
  if (value === null && op === '$ne') return { sql: `${column} IS NOT NULL`, values: [] };
  if (!OPERATORS[op]) throw new Error(`sqlite-light: unknown operator ${op}`);
  return { sql: `${column} ${OPERATORS[op]} ?`, values: [encode(value)] };
}

function negate(part) {
  return { sql: `NOT (${part.sql})`, values: part.values };
}

function conditionParts(key, value) {
  const column = quote(key);
  if (Array.isArray(value)) return [compare(column, '$in', value)];
  if (!isPlainObject(value)) return [compare(column, '$eq', value)];
  return Object.entries(value).map(([op, v]) => compare(column, op, v));
}

export function buildWhere(conditions = {}) {
  const parts = Object.entries(conditions).flatMap(([k, v]) => conditionParts(k, v));
  if (parts.length === 0) return { sql: '', values: [] };
  const sql = ` WHERE ${parts.map(p => p.sql).join(' AND ')}`;
  return { sql, values: parts.flatMap(p => p.values) };
}

function sortEntry(key, direction) {
  const desc = direction === -1 || String(direction).toLowerCase() === 'desc';
  return `${quote(key)} ${desc ? 'DESC' : 'ASC'}`;
}

function sortFromString(sort) {
  return sort.split(/\s+/).filter(Boolean).map(key =>
    key.startsWith('-') ? sortEntry(key.slice(1), -1) : sortEntry(key, 1));
}

export function buildOptions({ sort, limit, offset } = {}) {
  const entries = typeof sort === 'string' ? sortFromString(sort)
    : Object.entries(sort || {}).map(([k, d]) => sortEntry(k, d));
  const order = entries.length ? ` ORDER BY ${entries.join(', ')}` : '';
  const page = limit !== undefined || offset ? ` LIMIT ${toInt(limit ?? -1)}` : '';
  return order + page + (offset ? ` OFFSET ${toInt(offset)}` : '');
}

function toInt(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`sqlite-light: expected an integer, got ${value}`);
  return number;
}

export function buildInsert(table, data) {
  const keys = Object.keys(data);
  if (keys.length === 0) return { sql: `INSERT INTO ${quote(table)} DEFAULT VALUES RETURNING *`, values: [] };
  const columns = keys.map(quote).join(', ');
  const marks = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${quote(table)} (${columns}) VALUES (${marks}) RETURNING *`;
  return { sql, values: keys.map(k => encode(data[k])) };
}

export function buildUpdate(table, data, conditions) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) throw new Error('sqlite-light: update() needs at least one field to set');
  const set = keys.map(k => `${quote(k)} = ?`).join(', ');
  const where = buildWhere(conditions);
  const sql = `UPDATE ${quote(table)} SET ${set}${where.sql} RETURNING *`;
  return { sql, values: [...keys.map(k => encode(data[k])), ...where.values] };
}
