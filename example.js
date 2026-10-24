import { connectDB } from './src/index.js';

const db = connectDB(); // in-memory — pass a path like './app.db' for a file

const User = db.model('users', {
  name: { type: 'string', required: true },
  email: { type: 'string', unique: true },
  age: 'integer',
  active: { type: 'boolean', default: true },
  tags: 'json',
}, { timestamps: true });

User.createMany([
  { name: 'Niv', email: 'niv@example.com', age: 31, tags: ['admin'] },
  { name: 'Dana', email: 'dana@example.com', age: 27 },
  { name: 'Omer', email: 'omer@example.com', age: 19, active: false },
]);

console.log('Adults:', User.find({ age: { $gte: 21 } }, { sort: '-age' }).map(u => u.name));
console.log('First:', User.findOne({ email: 'niv@example.com' }));
console.log('Active count:', User.count({ active: true }));

User.updateById(3, { active: true });
console.log('Raw SQL:', db.query('SELECT name, age FROM users WHERE age < ?', [30]));

db.close();
