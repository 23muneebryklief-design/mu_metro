import { openDatabase, migrate } from "../src/db.js";
import { seedReference } from "../src/seed-reference.js";

const db = openDatabase(process.env.DATABASE_PATH ?? "./data/mu-metro.db");
try {
  migrate(db);
  console.log(await seedReference(db));
} finally {
  db.close();
}
