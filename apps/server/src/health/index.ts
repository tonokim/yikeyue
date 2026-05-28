import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";

/**
 * Health check router factory.
 * Design Invariant: 8.1 - Probes PG and Redis connection.
 * Returns 200 if both are up, 503 if any is unreachable.
 * Follows unified success/failure response wrapping formats.
 */
export function createHealthRouter(redis: Redis) {
  const router = new Hono<AppEnv>();

  router.get("/", async (c) => {
    const db = c.var.db;
    const log = c.var.log;
    const reqId = c.var.requestId;

    let pgStatus = "down";
    let redisStatus = "down";
    let isHealthy = true;

    // Probe PostgreSQL
    try {
      await db.execute(sql`SELECT 1`);
      pgStatus = "up";
    } catch (err) {
      isHealthy = false;
      log.error({ err }, "Healthcheck: PostgreSQL connection failed");
    }

    // Probe Redis
    try {
      const pingResult = await redis.ping();
      if (pingResult === "PONG") {
        redisStatus = "up";
      } else {
        isHealthy = false;
        log.error({ pingResult }, "Healthcheck: Redis returned unexpected ping result");
      }
    } catch (err) {
      isHealthy = false;
      log.error({ err }, "Healthcheck: Redis connection failed");
    }

    const payload = {
      postgres: pgStatus,
      redis: redisStatus,
    };

    if (isHealthy) {
      return c.json(
        {
          request_id: reqId,
          data: {
            status: "healthy",
            ...payload,
          },
        },
        200,
      );
    } else {
      return c.json(
        {
          request_id: reqId,
          error: {
            code: "health.unhealthy",
            message: "One or more service dependencies are unhealthy.",
            details: payload,
          },
        },
        503,
      );
    }
  });

  return router;
}
