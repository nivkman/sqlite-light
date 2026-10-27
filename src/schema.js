import { quote, encode } from './sql.js';

const TYPES = {
  string: 'TEXT',
  text: 'TEXT',
  number: 'REAL',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  date: 'TEXT',
  json: 'TEXT',
  blob: 'BLOB',
};

function normalizeField(spec) {
  const field = typeof spec === 'string' ? { type: spec } : { ...spec };
  field.type = String(field.type || 'string').toLowerCase();
  if (!TYPES[field.type]) throw new Error(`sqlite-light: unknown type "${field.type}"`);
  return field;
}

export function normalizeSchema(schema = {}, options = {}) {
  const fields = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, normalizeField(v)]));
  if (options.timestamps) {
    fields.createdAt = { type: 'date' };
    fields.updatedAt = { type: 'date' };
  }
  return fields;
}

function literal(field) {
  if (field.default === null) return 'NULL';
  const encoded = field.type === 'json' ? JSON.stringify(field.default) : encode(field.default);
  if (typeof encoded === 'number') return String(encoded);
  return `'${String(encoded).replaceAll("'", "''")}'`;
}

function columnSql(name, field) {
  const parts = [quote(name), TYPES[field.type]];
  if (field.required) parts.push('NOT NULL');
  if (field.unique) parts.push('UNIQUE');
  if (field.default !== undefined) parts.push(`DEFAULT ${literal(field)}`);
  return parts.join(' ');
}

export function createTableSql(table, fields) {
  const columns = Object.entries(fields).map(([name, field]) => columnSql(name, field));
  const all = ['"id" INTEGER PRIMARY KEY AUTOINCREMENT', ...columns].join(', ');
  return `CREATE TABLE IF NOT EXISTS ${quote(table)} (${all})`;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function encodeRow(data, fields) {
  const row = { ...data };
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'json' && row[name] != null) row[name] = JSON.stringify(row[name]);
  }
  return row;
}

function decodeValue(value, type) {
  if (value === null || value === undefined) return value;
  if (type === 'boolean') return typeof value === 'string' ? value === 'true' || value === '1' : Number(value) !== 0;
  if (type === 'json') return parseJson(value);
  if (type === 'date') return new Date(value);
  return value;
}

export function decodeRow(row, fields) {
  if (!row) return null;
  const plain = { ...row };
  for (const [name, field] of Object.entries(fields)) {
    if (name in plain) plain[name] = decodeValue(plain[name], field.type);
  }
  return plain;
}
