import { connectDB, Model } from '../../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>() => {};

const db = connectDB('./app.db', { wal: true });
const User = db.model('users', {
  name: { type: 'string', required: true },
  age: 'integer',
  active: { type: 'boolean', default: true },
  tags: 'json',
}, { timestamps: true });

const user = User.create({ name: 'Niv', age: 31 });
assertType<Equal<typeof user.name, string>>();
assertType<Equal<typeof user.age, number | null>>();
assertType<Equal<typeof user.active, boolean | null>>();
assertType<Equal<typeof user.createdAt, Date>>();
assertType<Equal<typeof user.id, number>>();

User.find({ age: { $gte: 18 }, name: ['a', 'b'], active: null }, { sort: '-age', limit: 5 });
User.find({}, { sort: { age: -1 } });
const maybe: ReturnType<typeof User.findById> = null;

// @ts-expect-error unknown column
User.find({ nope: 1 });
// @ts-expect-error wrong value type
User.find({ age: 'old' });
// @ts-expect-error unknown operator
User.find({ age: { $regex: 'x' } });

const Plain = db.model('logs');
Plain.find({ anything: 1 });
const typed: Model<{ id: number; msg: string }> = db.model<{ id: number; msg: string }>('logs');
typed.findOne({ msg: 'x' })?.msg.toUpperCase();

const rows = db.query<{ n: number }>('SELECT 1 AS n');
rows[0].n.toFixed();
db.run('UPDATE users SET active = ?', [false]).changes.toFixed();
const total: number = db.transaction(() => User.count());
db.raw.prepare('SELECT 1');
void maybe; void total;
