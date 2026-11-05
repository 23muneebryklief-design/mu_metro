import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/db.js';
import { seedReference } from '../src/seed-reference.js';

test("optional reference catalogue is repeatable and future schedules never move existing reservations", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  migrate(db);
  const now = Date.parse("2026-11-05T08:00:00Z");
  await seedReference(db, now);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movies").get()!.n, 15);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM screenings").get()!.n, 182);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get()!.n, 0);
  const original = db
    .prepare(
      "SELECT id,starts_at FROM screenings WHERE id LIKE 'screening-reference-%' ORDER BY id LIMIT 1",
    )
    .get()!;
  await seedReference(db, now);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM screenings").get()!.n, 182);
  await seedReference(db, now + 86400000);
  assert.equal(
    db.prepare("SELECT starts_at FROM screenings WHERE id=?").get(original.id)!
      .starts_at,
    original.starts_at,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM screenings").get()!.n, 202);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const overlaps = db
    .prepare(
      `SELECT a.id FROM screenings a JOIN screenings b ON a.auditorium_id=b.auditorium_id AND a.id<b.id
    AND julianday(a.starts_at)<julianday(b.ends_at,'+20 minutes') AND julianday(b.starts_at)<julianday(a.ends_at,'+20 minutes')`,
    )
    .all();
  assert.deepEqual(overlaps, []);
});
