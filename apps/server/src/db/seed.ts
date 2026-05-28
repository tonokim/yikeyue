import pg from "pg";
import pino from "pino";
import { createDb } from "./index.js";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

async function main() {
  logger.info("Database seeding started...");
  
  const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/yikeyue";
  const pool = new pg.Pool({ connectionString });
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _db = createDb(pool);

  try {
    // Design D10: Skeleton implementation, no business tables seeded yet.
    logger.info("Database seeding completed successfully.");
  } catch (error) {
    logger.error({ err: error }, "Database seeding failed.");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
