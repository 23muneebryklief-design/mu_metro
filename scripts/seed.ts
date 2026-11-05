import { openDatabase, migrate } from '../src/db.js';
import { seed } from '../src/seed.js';

const db = openDatabase(process.env.DATABASE_PATH ?? './data/mu-metro.db');
try {
  migrate(db);
  const result = await seed(db, { adminEmail: process.env.SEED_ADMIN_EMAIL, adminPassword: process.env.SEED_ADMIN_PASSWORD });
  console.log('Demo data seeded. These are fictional movies and demonstration cinemas.', result);
} finally { db.close(); }
