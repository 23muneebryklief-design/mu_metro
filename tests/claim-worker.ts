import { openDatabase } from '../src/db.js';
import { createHold } from '../src/lib/booking-service.js';
import type { Config } from '../src/config.js';

const [databasePath, userId, encodedSeatIds] = process.argv.slice(2);
if (!databasePath || !userId || !encodedSeatIds || !process.send) {
  throw new Error('Claim worker must be forked with a database, user, seat selection, and IPC channel.');
}
const seatIds = JSON.parse(encodedSeatIds) as string[];
const db = openDatabase(databasePath);
const config: Config = {
  nodeEnv: 'test', host: '127.0.0.1', port: 3000, databasePath,
  jwtSecret: 'local-concurrency-worker-secret-not-used-for-auth', corsOrigins: [],
  holdMinutes: 10, demoPayments: true, clock: Date.now,
};
let closed = false;
function close() { if (!closed) { db.close(); closed = true; } }
process.once('disconnect', close);
process.once('message', message => {
  if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'start') {
    close(); process.exitCode = 1; process.disconnect(); return;
  }
  process.send!({ type: 'attempting' });
  let result;
  try {
    const response = createHold({ db, config }, userId, `cross-process-${userId}`, { screeningId: 'screen-1', seatIds });
    result = { type: 'result', ok: true, statusCode: 201, holdId: response.data.id, userId };
  } catch (error) {
    const failure = error as { statusCode?: number; code?: string; message?: string };
    result = { type: 'result', ok: false, statusCode: failure.statusCode ?? 500,
      code: failure.code, message: failure.message, userId };
  } finally { close(); }
  process.send!(result, () => process.disconnect());
});
process.send({ type: 'ready' });
