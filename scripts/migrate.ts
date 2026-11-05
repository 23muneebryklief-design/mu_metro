import { openDatabase, migrate } from '../src/db.js';
const db = openDatabase(process.env.DATABASE_PATH ?? './data/mu-metro.db');
try { migrate(db); console.log('Database migrations applied.'); }
finally { db.close(); }
