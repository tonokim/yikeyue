import { serve } from "@hono/node-server";
import pg from "pg";
import { config } from "./config.js";
import { createDb } from "./db/index.js";
import { createRedisClient } from "./redis.js";
import { createApp } from "./app.js";
import { logger } from "./logger/index.js";
import { createQueueConnection, QueueRegistry, registerPayloadSchema } from "./queue/index.js";
import { infraPingSchema, deadLetterScanSchema } from "@yikey/shared";

async function bootstrap() {
  logger.info("Bootstrapping server...");

  // Initialize PostgreSQL pool
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
  });

  // Test PG connection
  try {
    await pool.query("SELECT 1");
    logger.info("Connected to PostgreSQL successfully.");
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to PostgreSQL database");
    process.exit(1);
  }

  // Initialize Redis client
  const redis = createRedisClient(config.REDIS_URL);
  
  // Test Redis connection
  try {
    const pingRes = await redis.ping();
    logger.info({ pingRes }, "Connected to Redis successfully.");
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to Redis");
    process.exit(1);
  }

  // Initialize dedicated Queue connection & register schemas/queues
  const queueRedis = createQueueConnection(config.REDIS_URL);
  QueueRegistry.setConnection(queueRedis);
  registerPayloadSchema("infra:ping", infraPingSchema);
  registerPayloadSchema("infra:dead-letter-scan", deadLetterScanSchema);
  QueueRegistry.register("infra:ping");
  QueueRegistry.register("infra:dead-letter-scan");

  const db = createDb(pool);
  const clock = () => new Date();
  const jwtSecret = config.JWT_SECRET;

  const app = createApp({
    db,
    redis,
    clock,
    jwtSecret,
  });

  // Start the server
  serve({
    fetch: app.fetch,
    port: config.PORT,
  }, (info) => {
    logger.info(`Server is running at http://localhost:${info.port}`);
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
