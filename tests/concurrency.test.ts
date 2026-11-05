import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/db.js';
import { fixture } from './helpers.js';

type Outcome = { ok: boolean; statusCode: number; holdId?: string; userId: string; code?: string; message?: string };

function claimWorker(databasePath: string, userId: string, seatIds: string[]) {
  const child = fork(fileURLToPath(new URL('./claim-worker.ts', import.meta.url)), [databasePath, userId, JSON.stringify(seatIds)], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  let completed = false;
  child.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-8_000); });
  let readyResolve!: () => void; let readyReject!: (error: Error) => void;
  let attemptResolve!: () => void; let attemptReject!: (error: Error) => void;
  let resultResolve!: (result: Outcome) => void; let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((accept, reject) => { readyResolve = accept; readyReject = reject; });
  const attempting = new Promise<void>((accept, reject) => { attemptResolve = accept; attemptReject = reject; });
  const result = new Promise<Outcome>((accept, reject) => { resultResolve = accept; resultReject = reject; });
  // A startup failure can reject promises before that phase is awaited.
  for (const pending of [ready, attempting, result]) void pending.catch(() => {});
  function rejectPending(error: Error) { readyReject(error); attemptReject(error); resultReject(error); }
  child.on('error', rejectPending);
  child.on('message', message => {
    const received = message as { type?: string } & Outcome;
    if (received.type === 'ready') readyResolve();
    if (received.type === 'attempting') attemptResolve();
    if (received.type === 'result') { completed = true; resultResolve(received); }
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(accept => {
    child.once('close', (code, signal) => {
      if (!completed) rejectPending(new Error(`Claim worker ${userId} exited before reporting (${code ?? signal}): ${diagnostics}`));
      accept({ code, signal });
    });
  });
  return { child, ready, attempting, result, exited, completed: () => completed, diagnostics: () => diagnostics };
}

test('separate SQLite processes serialize competing multi-seat claims and persist the winner', { timeout: 30_000 }, async t => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'mu-metro-concurrency-'));
  const databasePath = join(directory, 'reservations.db');
  const f = await fixture({ path: databasePath });
  let fixtureClosed = false;
  let parentLockHeld = false;
  const workers: ReturnType<typeof claimWorker>[] = [];
  t.after(async () => {
    if (parentLockHeld) { f.db.exec('ROLLBACK'); parentLockHeld = false; }
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill();
    }
    await Promise.all(workers.map(worker => worker.exited));
    if (!fixtureClosed) await f.close();
    // Only remove the exact temporary directory created by this test.
    assert.equal(dirname(directory), temporaryRoot);
    assert.ok(basename(directory).startsWith('mu-metro-concurrency-'));
    rmSync(directory, { recursive: true, force: true });
  });
  workers.push(claimWorker(databasePath, 'alice', ['seat-1', 'seat-2']));
  workers.push(claimWorker(databasePath, 'bob', ['seat-2', 'seat-3']));
  await Promise.all(workers.map(worker => worker.ready));

  // Hold the writer lock until both independent connections begin their claims.
  // A broken implementation which omits BEGIN IMMEDIATE cannot pass by merely
  // interleaving two requests on one JavaScript event loop.
  f.db.exec('BEGIN IMMEDIATE'); parentLockHeld = true;
  for (const worker of workers) worker.child.send({ type: 'start' });
  await Promise.all(workers.map(worker => worker.attempting));
  await delay(100);
  assert.ok(workers.every(worker => !worker.completed()), 'Both workers must wait for the existing SQLite writer.');
  f.db.exec('COMMIT'); parentLockHeld = false;

  const results = await Promise.all(workers.map(worker => worker.result));
  const exits = await Promise.all(workers.map(worker => worker.exited));
  for (const [index, exit] of exits.entries()) {
    assert.equal(exit.code, 0, workers[index].diagnostics());
    assert.equal(exit.signal, null);
  }
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409], JSON.stringify(results));
  const winner = results.find(result => result.ok)!;
  const loser = results.find(result => !result.ok)!;
  assert.equal(loser.code, 'SEAT_UNAVAILABLE');
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM holds').get()!.total, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM hold_seats').get()!.total, 2);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM seat_claims').get()!.total, 2);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM idempotency_keys').get()!.total, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM audit_logs').get()!.total, 1);
  const selected = winner.userId === 'alice' ? ['seat-1', 'seat-2'] : ['seat-2', 'seat-3'];
  assert.deepEqual(f.db.prepare('SELECT seat_id FROM seat_claims ORDER BY seat_id').all().map(row => row.seat_id), selected);
  assert.equal(f.db.prepare('SELECT user_id FROM holds WHERE id = ?').get(winner.holdId!)!.user_id, winner.userId);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(f.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');

  await f.close(); fixtureClosed = true;
  const reopened = openDatabase(databasePath);
  try {
    assert.equal(reopened.prepare('SELECT user_id FROM holds WHERE id = ?').get(winner.holdId!)!.user_id, winner.userId);
    assert.deepEqual(reopened.prepare('SELECT seat_id FROM seat_claims ORDER BY seat_id').all().map(row => row.seat_id), selected);
    assert.equal(reopened.prepare('SELECT count(*) AS total FROM idempotency_keys').get()!.total, 1);
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { reopened.close(); }
});
