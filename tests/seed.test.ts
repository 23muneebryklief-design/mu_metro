import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/db.js';
import { seed } from '../src/seed.js';

test('migrations and demo seeds are repeatable, create no default account, and preserve existing dates', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  migrate(db); migrate(db);
  const result = await seed(db);
  assert.equal(result.adminCreated, false);
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()!.count, 0);
  const date = db.prepare('SELECT starts_at FROM screenings ORDER BY id LIMIT 1').get()!.starts_at;
  await seed(db, { now: Date.now() + 86_400_000 });
  assert.equal(db.prepare('SELECT count(*) AS count FROM screenings').get()!.count, 42);
  assert.equal(db.prepare('SELECT count(*) AS count FROM seats').get()!.count, 120);
  assert.equal(db.prepare('SELECT starts_at FROM screenings ORDER BY id LIMIT 1').get()!.starts_at, date);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('explicit admin setup hashes the password and refuses to promote an existing customer', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close()); migrate(db);
  await assert.rejects(seed(db, { adminEmail: 'admin@example.test' }));
  await assert.rejects(seed(db, { adminEmail: 'admin@example.test', adminPassword: 'short' }));
  const result = await seed(db, { adminEmail: 'Admin@example.test', adminPassword: 'Unique admin passphrase 2026!' });
  assert.equal(result.adminCreated, true);
  const admin = db.prepare("SELECT * FROM users WHERE email='admin@example.test'").get()!;
  assert.equal(admin.role, 'admin');
  assert.ok(String(admin.password_hash).startsWith('scrypt$'));
  assert.equal((await seed(db, { adminEmail: 'admin@example.test', adminPassword: 'Another valid passphrase!' })).adminCreated, false);
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()!.count, 1);
  db.prepare("UPDATE users SET role='customer' WHERE id=?").run(admin.id);
  await assert.rejects(seed(db, { adminEmail: 'admin@example.test', adminPassword: 'Another valid passphrase!' }), /customer/);
});
