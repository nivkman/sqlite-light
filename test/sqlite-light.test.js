import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectDB } from '../src/index.js';

function setup() {
  const db = connectDB();
  const User = db.model('users', {
    name: { type: 'string', required: true },
    email: { type: 'string', unique: true },
    age: 'integer',
    active: { type: 'boolean', default: true },
    tags: 'json',
  }, { timestamps: true });
  return { db, User };
}

test('create returns the stored row with id, decoded types and timestamps', () => {
  const { User } = setup();
  const user = User.create({ name: 'Niv', email: 'niv@example.com', age: 30, tags: ['a', 'b'] });
  assert.equal(user.id, 1);
  assert.equal(user.active, true);
  assert.deepEqual(user.tags, ['a', 'b']);
  assert.ok(user.createdAt instanceof Date);
});

test('find supports equality, operators, $in, null, sort, limit, offset', () => {
  const { User } = setup();
  User.createMany([
    { name: 'A', age: 20 }, { name: 'B', age: 30 }, { name: 'C', age: 40, active: false }, { name: 'D' },
  ]);
  assert.deepEqual(User.find({ age: { $gte: 30 } }).map(u => u.name), ['B', 'C']);
  assert.deepEqual(User.find({ name: ['A', 'C'] }).map(u => u.name), ['A', 'C']);
  assert.deepEqual(User.find({ age: null }).map(u => u.name), ['D']);
  assert.deepEqual(User.find({ active: false }).map(u => u.name), ['C']);
  assert.deepEqual(User.find({}, { sort: '-age', limit: 2 }).map(u => u.name), ['C', 'B']);
  assert.deepEqual(User.find({}, { sort: { name: 1 }, offset: 3 }).map(u => u.name), ['D']);
  assert.deepEqual(User.find({ name: { $like: 'B%' } }).map(u => u.name), ['B']);
  assert.deepEqual(User.find({ name: { $nin: ['A', 'B'] } }).map(u => u.name), ['C', 'D']);
  assert.deepEqual(User.find({ name: [] }), []);
});

test('findById, findOne, count, exists', () => {
  const { User } = setup();
  User.createMany([{ name: 'A', age: 1 }, { name: 'B', age: 2 }]);
  assert.equal(User.findById(2).name, 'B');
  assert.equal(User.findById(99), null);
  assert.equal(User.findOne({ age: { $gt: 1 } }).name, 'B');
  assert.equal(User.count(), 2);
  assert.equal(User.count({ name: 'A' }), 1);
  assert.equal(User.exists({ name: 'Z' }), false);
});

test('update and delete return affected rows and bump updatedAt', async () => {
  const { User } = setup();
  const created = User.create({ name: 'A', age: 1 });
  await new Promise(resolve => setTimeout(resolve, 5));
  const updated = User.updateById(created.id, { age: 2 });
  assert.equal(updated.age, 2);
  assert.ok(updated.updatedAt > created.updatedAt);
  assert.equal(User.update({ name: 'nobody' }, { age: 5 }).length, 0);
  assert.equal(User.deleteById(created.id).name, 'A');
  assert.equal(User.count(), 0);
});

test('update and delete refuse empty conditions', () => {
  const { User } = setup();
  assert.throws(() => User.update({}, { age: 1 }), /needs conditions/);
  assert.throws(() => User.delete({}), /needs conditions/);
  const Plain = setup().db.model('plain', { name: 'string' });
  assert.throws(() => Plain.update({ id: 1 }), /at least one field/);
});

test('schema constraints are enforced', () => {
  const { User } = setup();
  User.create({ name: 'A', email: 'x@y.z' });
  assert.throws(() => User.create({ name: 'B', email: 'x@y.z' }), /UNIQUE/);
  assert.throws(() => User.create({ email: 'q@y.z' }), /NOT NULL/);
});

test('transaction rolls back on error and supports nesting', () => {
  const { db, User } = setup();
  assert.throws(() => db.transaction(() => {
    User.create({ name: 'A' });
    throw new Error('boom');
  }), /boom/);
  assert.equal(User.count(), 0);
  db.transaction(() => {
    User.create({ name: 'outer' });
    assert.throws(() => db.transaction(() => {
      User.create({ name: 'inner' });
      throw new Error('inner fail');
    }));
  });
  assert.deepEqual(User.find().map(u => u.name), ['outer']);
});

test('createMany is atomic', () => {
  const { User } = setup();
  assert.throws(() => User.createMany([{ name: 'A' }, { email: 'no-name' }]));
  assert.equal(User.count(), 0);
});

test('async transaction callbacks are rejected and rolled back', () => {
  const { db, User } = setup();
  assert.throws(() => db.transaction(async () => User.create({ name: 'A' })), /synchronous/);
  assert.equal(User.count(), 0);
});

test('raw SQL helpers: query, get, run with positional and named params', () => {
  const { db, User } = setup();
  User.create({ name: 'A', age: 1 });
  assert.deepEqual(db.query('SELECT name FROM users WHERE age = ?', [1]), [{ name: 'A' }]);
  assert.deepEqual(db.get('SELECT name FROM users WHERE name = $name', { name: 'A' }), { name: 'A' });
  assert.equal(db.get('SELECT * FROM users WHERE id = ?', [42]), null);
  assert.equal(db.run('UPDATE users SET active = ?', [false]).changes, 1);
  assert.equal(db.run('INSERT INTO users (name) VALUES (?)', ['B']).lastInsertRowid, 2);
  assert.equal(User.findById(1).active, false);
});

test('identifiers are quoted, so odd column names cannot inject SQL', () => {
  const { db } = setup();
  const Weird = db.model('weird table', { 'a"b': 'string' });
  Weird.create({ 'a"b': 'ok' });
  assert.equal(Weird.findOne({ 'a"b': 'ok' })['a"b'], 'ok');
  assert.throws(() => Weird.find({ 'x; DROP TABLE users; --': 1 }), /no such column/);
  assert.equal(db.query('SELECT COUNT(*) AS n FROM users')[0].n, 0);
});

test('unknown operators and non-integer limits throw', () => {
  const { User } = setup();
  assert.throws(() => User.find({ age: { $regex: 'x' } }), /unknown operator/);
  assert.throws(() => User.find({}, { limit: '1; DROP TABLE users' }), /integer/);
});

test('file database persists across connections and uses WAL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-light-'));
  const path = join(dir, 'app.db');
  try {
    const db = connectDB(path);
    db.model('notes', { body: 'string' }).create({ body: 'hello' });
    assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
    db.close();
    const again = connectDB(path);
    assert.equal(again.model('notes').findOne().body, 'hello');
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model without schema works on an existing table', () => {
  const db = connectDB();
  db.exec('CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT)');
  const Log = db.model('logs');
  Log.create({ msg: 'x' });
  assert.deepEqual(Log.find(), [{ id: 1, msg: 'x' }]);
});

test('blobs round-trip and a single Buffer param binds positionally', () => {
  const db = connectDB();
  const Files = db.model('files', { data: 'blob' });
  Files.create({ data: new Uint8Array([1, 2, 3]) });
  assert.deepEqual([...Files.findById(1).data], [1, 2, 3]);
  assert.equal(db.get('SELECT id FROM files WHERE data = ?', Buffer.from([1, 2, 3])).id, 1);
});

test('readOnly connections reject writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-light-'));
  const path = join(dir, 'ro.db');
  try {
    connectDB(path).model('t', { v: 'string' }).create({ v: 'x' });
    const ro = connectDB(path, { readOnly: true });
    assert.equal(ro.model('t').count(), 1);
    assert.throws(() => ro.model('t').create({ v: 'y' }), /readonly/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
