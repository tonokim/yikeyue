import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createDb } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(connectionString: string) {
  logger.info("Running database migrations...");
  
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = createDb(client);

  try {
    await migrate(db, {
      migrationsFolder: path.join(__dirname, "migrations"),
    });
    logger.info("Database migrations completed successfully.");
  } catch (error) {
    logger.error({ err: error }, "Database migrations failed.");
    throw error;
  } finally {
    await client.end();
  }
}

// Check if file is run directly
const isDirectRun = 
  process.argv[1] === __filename || 
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate");

if (isDirectRun) {
  const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/yikeyue";
  runMigrations(connectionString).catch(() => process.exit(1));
}
