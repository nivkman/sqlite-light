# sqlite-light 🪶

Zero-dependency SQLite for Node.js with Mongoose-like models. Built on the **built-in `node:sqlite`** module — nothing to compile, nothing to download, nothing in `node_modules`.

```js
import { connectDB } from 'sqlite-light';

const db = connectDB('./app.db');
const User = db.model('users', { name: 'string', age: 'integer' });

User.create({ name: 'Niv', age: 31 });
User.find({ age: { $gte: 21 } }); // [{ id: 1, name: 'Niv', age: 31 }]
```

## Features ✨

- 📦 **Zero Dependencies** - Uses Node's built-in `node:sqlite`. No `better-sqlite3`, no native build, no `node-gyp`
- ⚡ **One-line Connection** - `connectDB('./app.db')`, with WAL and foreign keys on by default
- 🎨 **Mongoose-like Models** - `create`, `find`, `findOne`, `findById`, `update`, `delete`, `count`...
- 🔍 **Query Operators** - `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`, `$nin`, `$like`
- 🧱 **Schemas Create Tables** - Define fields once and the table is created for you
- 🔄 **Type Round-trip** - Booleans, dates and JSON columns come back as real JS values
- ⏱️ **Timestamps** - `createdAt` / `updatedAt` handled automatically
- 🔁 **Transactions** - Auto-rollback on error, safe to nest (savepoints)
- 🚀 **Synchronous API** - No `await` needed. SQLite is in-process, so calls are fast and simple
- 🛡️ **Safe by Default** - Values are always bound parameters, identifiers are quoted, and `update`/`delete` refuse to run without conditions
- 🏷️ **TypeScript Types** - Rows are typed from your schema, wrong columns are compile errors
- 🔓 **Full Access** - Drop to raw SQL at any time, or use the underlying `DatabaseSync` via `db.raw`

## Requirements

**Node.js 22.13 or newer** (the version where `node:sqlite` stopped needing a flag). On older Node versions the import throws a clear error.

Node still marks `node:sqlite` as experimental and prints a one-time `ExperimentalWarning`. To hide it:

```bash
node --no-warnings=ExperimentalWarning app.js
```

## Installation

```bash
npm install sqlite-light
```

## Quick Start

### Models (For Simple CRUD)

```js
import { connectDB } from 'sqlite-light';

const db = connectDB('./app.db'); // or connectDB() for in-memory

const User = db.model('users', {
  name: { type: 'string', required: true },
  email: { type: 'string', unique: true },
  age: 'integer',
  active: { type: 'boolean', default: true },
  tags: 'json',
}, { timestamps: true });

// CRUD operations - No SQL needed!
const user = User.create({ name: 'Niv', email: 'niv@example.com', age: 31, tags: ['admin'] });
// { id: 1, name: 'Niv', ..., active: true, tags: ['admin'], createdAt: Date, updatedAt: Date }

User.find({ active: true }, { sort: '-age', limit: 10 });
User.findOne({ email: 'niv@example.com' });
User.findById(1);
User.updateById(1, { age: 32 });
User.deleteById(1);
User.count({ age: { $lt: 30 } });

db.close();
```

### Raw SQL

```js
const rows = db.query('SELECT * FROM users WHERE age > ?', [21]);  // all rows
const row  = db.get('SELECT * FROM users WHERE email = $email', { email: 'niv@example.com' }); // one row or null
const info = db.run('UPDATE users SET active = ? WHERE age < ?', [false, 18]);  // { changes, lastInsertRowid }
db.exec('CREATE INDEX IF NOT EXISTS users_age ON users (age)');  // run SQL with no parameters
```

### Transactions

```js
db.transaction(() => {
  const from = Account.findById(1);
  Account.updateById(1, { balance: from.balance - 100 });
  Account.updateById(2, { balance: Account.findById(2).balance + 100 });
}); // throws → everything rolls back
```

### TypeScript

Types ship with the package, and a schema gives you typed rows automatically:

```ts
const User = db.model('users', {
  name: { type: 'string', required: true },
  age: 'integer',
}, { timestamps: true });

const user = User.findById(1);  // { id: number; name: string; age: number | null; createdAt: Date; updatedAt: Date } | null
User.find({ age: { $gte: 18 } });  // ✅
User.find({ agee: 18 });           // ❌ type error: unknown column
```

For a model without a schema, pass the row type yourself: `db.model<{ id: number; msg: string }>('logs')`.

## API

### `connectDB(path?, options?)`

Opens (or creates) a database. `path` defaults to `':memory:'`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `wal` | boolean | `true` for files | Enable WAL journal mode (better concurrency) |
| `foreignKeys` | boolean | `true` | Enforce foreign key constraints |
| `busyTimeout` | number | `5000` | Milliseconds to wait when the database is locked |
| `readOnly` | boolean | `false` | Open the database read-only |
| `bigInts` | boolean | `false` | Read integers as `BigInt`. Without it, writing an integer beyond `Number.MAX_SAFE_INTEGER` throws instead of being stored |
| `logger` | object | silent | Any logger with `debug`/`info`/`error` (e.g. a `logger-standard` instance). SQL is logged at `debug` |

### Database Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `db.model(table, schema?, options?)` | `Model` | Create a model. With a schema, creates the table if it doesn't exist |
| `db.query(sql, params?)` | `object[]` | Run a query and return all rows |
| `db.get(sql, params?)` | `object \| null` | Return the first row |
| `db.run(sql, params?)` | `{ changes, lastInsertRowid }` | Run a statement |
| `db.exec(sql)` | `db` | Run one or more statements with no parameters |
| `db.transaction(fn)` | result of `fn` | Run `fn` in a transaction. Rolls back if it throws. Nesting uses savepoints. `fn` must be synchronous |
| `db.close()` | - | Close the connection |
| `db.raw` | `DatabaseSync` | The underlying `node:sqlite` database |

`params` can be an array (`?` placeholders) or an object (`$name` / `:name` / `@name` placeholders). Booleans, `Date`s, arrays and plain objects are converted for you.

### Schema

```js
db.model('users', {
  name: 'string',                                  // shorthand: just the type
  email: { type: 'string', required: true, unique: true },
  active: { type: 'boolean', default: true },
});
```

Every table gets an `id INTEGER PRIMARY KEY AUTOINCREMENT` column.

| Type | Stored as | Read back as |
|------|-----------|--------------|
| `string` / `text` | `TEXT` | string |
| `integer` | `INTEGER` | number |
| `number` | `REAL` | number |
| `boolean` | `INTEGER` (0/1) | boolean |
| `date` | `TEXT` (ISO 8601) | `Date` |
| `json` | `TEXT` | any JSON value (object, array, string, number, boolean) |
| `blob` | `BLOB` | `Uint8Array` |

| Field option | Description |
|--------------|-------------|
| `required` | `NOT NULL` |
| `unique` | `UNIQUE` |
| `default` | Default value |

| Model option | Default | Description |
|--------------|---------|-------------|
| `timestamps` | `false` | Adds `createdAt` / `updatedAt` and keeps them up to date |

The schema creates a missing table. It does **not** migrate an existing one — run `db.exec('ALTER TABLE ...')` yourself for changes. Without a schema, a model works on any existing table and returns raw column values.

### Model Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `find(conditions?, options?)` | `object[]` | Matching rows |
| `findOne(conditions?, options?)` | `object \| null` | First matching row |
| `findById(id)` | `object \| null` | Row by `id` |
| `create(data)` | `object` | Insert and return the new row |
| `createMany(list)` | `object[]` | Insert many rows in one transaction (all or nothing) |
| `update(conditions, data)` | `object[]` | Update matching rows and return them |
| `updateById(id, data)` | `object \| null` | Update one row |
| `delete(conditions)` | `object[]` | Delete matching rows and return them |
| `deleteById(id)` | `object \| null` | Delete one row |
| `count(conditions?)` | `number` | Count matching rows |
| `exists(conditions?)` | `boolean` | Whether any row matches |

`update` and `delete` throw when `conditions` is empty, so a missing filter can't wipe the table. To really touch every row, say so: `User.delete({ id: { $gt: 0 } })`.

### Conditions

```js
User.find({ name: 'Niv' });                    // name = 'Niv'
User.find({ age: { $gte: 18, $lt: 30 } });     // 18 <= age < 30
User.find({ role: ['admin', 'owner'] });       // role IN (...)  — same as { $in: [...] }
User.find({ role: { $nin: ['banned'] } });     // role NOT IN (...)
User.find({ deletedAt: null });                // deletedAt IS NULL
User.find({ deletedAt: { $ne: null } });       // deletedAt IS NOT NULL
User.find({ email: { $like: '%@gmail.com' } });
```

Conditions are combined with `AND`. For `OR`, joins, or anything else, use `db.query()`.

- Keys whose value is `undefined` are ignored — in conditions and in `create`/`update` data — so optional fields like `{ age: req.body.age }` behave as you'd expect, and a column's default still applies. `update`/`delete` throw if nothing is left to filter on.
- SQL `NULL` rules apply: `$ne`, `$nin`, `$gt` and friends never match rows where the column is `NULL`. To include them, query `null` explicitly (or use `db.query()` with `OR ... IS NULL`).

### Find Options

| Option | Example | Description |
|--------|---------|-------------|
| `sort` | `'-createdAt name'` or `{ createdAt: -1, name: 1 }` | Sort order (`-` / `-1` / `'desc'` = descending) |
| `limit` | `10` | Maximum rows |
| `offset` | `20` | Skip rows |

## Why sqlite-light? 🤔

- **No install pain.** `better-sqlite3` and `sqlite3` are native modules — they break on Node upgrades, Alpine images, new CPUs and CI caches. `node:sqlite` ships inside Node itself.
- **Mongoose ergonomics, SQL underneath.** If you know `User.find({ age: { $gte: 18 } })`, you already know this library.
- **Tiny.** A few hundred lines of plain JavaScript you can read in one sitting.
- **Great for** CLIs, scripts, bots, prototypes, local-first apps, tests, and small services.

Siblings: [`pg-light`](https://github.com/nivkman/pg-light) (PostgreSQL) and [`mongoose-light`](https://github.com/nivkman/mongoose-light) (MongoDB).

## License

MIT
