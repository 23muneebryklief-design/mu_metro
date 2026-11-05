import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { migrate, openDatabase } from "../src/db.js";
import { seedReference } from "../src/seed-reference.js";
import { fixture } from "./helpers.js";

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

test("production frontend and API share an origin without swallowing API errors or exposing other files", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const directory = await mkdtemp(join(tmpdir(), "mu-metro-web-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "index.html"),
    '<!doctype html><title>Mu Metro</title><div id="root"></div>',
  );
  await writeFile(
    join(directory, "assets", "app.js"),
    'console.log("cinema");',
  );
  const app = await buildApp(f.config, {
    db: f.db,
    logger: false,
    rateLimit: false,
    frontendRoot: directory,
  });
  t.after(() => app.close());
  const home = await app.inject("/");
  assert.equal(home.statusCode, 200);
  assert.match(home.headers["content-type"]!, /text\/html/);
  assert.equal((await app.inject("/assets/app.js")).statusCode, 200);
  assert.equal(
    (await app.inject("/api/v1/movies")).json().data[0].id,
    "movie-1",
  );
  const unknown = await app.inject("/api/v1/missing");
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, "NOT_FOUND");
  assert.equal((await app.inject("/.env")).statusCode, 404);
  assert.equal((await app.inject("/src/app.ts")).statusCode, 404);
  assert.equal((await app.inject("/docs/json")).statusCode, 200);
});
