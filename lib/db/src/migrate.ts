import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { db, pool } from "./index";

const migrationsFolder = path.join(process.cwd(), "lib/db/migrations");

const INITIAL_MIGRATION_HASH = "090adcf61fda68f65248d81c134469722899678b6098ed45449a52cabbf7561d";

export async function runMigrations(): Promise<void> {
  const tablesCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS exists`,
  );

  const tablesExist = tablesCheck.rows[0]?.exists === true;

  if (tablesExist) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id         SERIAL PRIMARY KEY,
        hash       text NOT NULL,
        created_at bigint
      )
    `);

    const { rowCount } = await pool.query(
      `SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1`,
    );

    if ((rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [INITIAL_MIGRATION_HASH, Date.now()],
      );
    }
  }

  await migrate(db, { migrationsFolder });
}
