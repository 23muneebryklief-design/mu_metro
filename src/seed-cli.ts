import { migrate, openDatabase } from './db.js';
import { seed } from './seed.js';

const db = openDatabase(process.env.DATABASE_PATH ?? './data/mu-metro.db');
try {
  migrate(db);
  await seed(db, { adminEmail: process.env.SEED_ADMIN_EMAIL, adminPassword: process.env.SEED_ADMIN_PASSWORD });
  console.log('Seed complete. Demo catalogue is ready. Administrator created only if supplied via environment.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
} finally { db.close(); }
