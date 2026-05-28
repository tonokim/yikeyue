import pg from "pg";
import { config } from "./config.js";
import { createQueueConnection } from "./queue/connection.js";
import { QueueRegistry } from "./queue/registry.js";
import { WorkerRegistry } from "./queue/worker.js";
import { logger } from "./logger/index.js";
import { registerPayloadSchema, repeatable } from "./queue/scheduler.js";
import { infraPingSchema, deadLetterScanSchema, wechatSubscribeJobSchema } from "@yikey/shared";
import { scanDeadLetters } from "./queue/dead-letter.js";
import { createRedisClient } from "./redis.js";
import { initWeChatService, getWeChatService, getTemplateConfig } from "./wechat/index.js";

async function bootstrapWorker() {
  logger.info("Bootstrapping worker process...");

  const pgPool = new pg.Pool({
    connectionString: config.DATABASE_URL,
  });

  try {
    await pgPool.query("SELECT 1");
    logger.info("Connected to PostgreSQL successfully (worker).");
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to PostgreSQL (worker)");
    process.exit(1);
  }

  const queueRedis = createQueueConnection(config.REDIS_URL);
  try {
    await queueRedis.ping();
    logger.info("Connected to Redis successfully (worker).");
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to Redis (worker)");
    process.exit(1);
  }

  const redis = createRedisClient(config.REDIS_URL);
  try {
    await redis.ping();
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to standard Redis (worker)");
    process.exit(1);
  }

  initWeChatService(redis);

  QueueRegistry.setConnection(queueRedis);
  WorkerRegistry.setConnection(queueRedis, pgPool);

  // Register schemas
  registerPayloadSchema("infra:ping", infraPingSchema);
  registerPayloadSchema("infra:dead-letter-scan", deadLetterScanSchema);
  registerPayloadSchema("notify:wechat-subscribe", wechatSubscribeJobSchema);

  const prefix = process.env.QUEUE_PREFIX;

  // Register Queues
  QueueRegistry.register("infra:ping", prefix ? { prefix } : undefined);
  QueueRegistry.register("infra:dead-letter-scan", prefix ? { prefix } : undefined);
  QueueRegistry.register("notify:wechat-subscribe", prefix ? { prefix } : undefined);

  // Register Workers
  // 8.1 Implement infra:ping demo queue + processor (labeled clearly for validation, not for business use)
  WorkerRegistry.register(
    "infra:ping",
    async (payload, ctx) => {
      ctx.log.info({ payload }, "Handling ping job (demo queue - for validation only, do not use in business)");
      if (payload.sleepMs) {
        await new Promise((resolve) => setTimeout(resolve, payload.sleepMs));
      }
    },
    undefined,
    prefix ? { prefix } : undefined
  );

  WorkerRegistry.register(
    "infra:dead-letter-scan",
    async (payload, ctx) => {
      ctx.log.info("Handling dead letter scan job");
      await scanDeadLetters();
    },
    undefined,
    prefix ? { prefix } : undefined
  );

  WorkerRegistry.register(
    "notify:wechat-subscribe",
    async (payload, ctx) => {
      ctx.log.info({ event: payload.event, openid: payload.touser }, "Handling WeChat subscribe message job");
      const templateConfig = getTemplateConfig(payload.event);
      const formattedData = templateConfig.buildData(payload.data);
      const service = getWeChatService();
      await service.subscribe.sendSubscribeMessage({
        touser: payload.touser,
        templateId: templateConfig.templateId,
        data: formattedData,
      });
    },
    undefined,
    prefix ? { prefix } : undefined
  );

  // Schedule repeatable dead-letter scan job (daily at midnight: "0 0 * * *")
  try {
    await repeatable("infra:dead-letter-scan", { scanTime: Date.now() }, "0 0 * * *");
    logger.info("Scheduled daily repeatable dead-letter-scan job.");
  } catch (err) {
    logger.error({ err }, "Failed to schedule daily repeatable dead-letter-scan job");
  }

  // Handle graceful shutdown (D7)
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    const forceExitTimeout = setTimeout(() => {
      logger.fatal("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 30000);
    forceExitTimeout.unref();

    try {
      await WorkerRegistry.closeAll();
      await QueueRegistry.closeAll();
      await pgPool.end();
      queueRedis.disconnect();
      await redis.quit().catch(() => {});
      logger.info("Worker process shutdown complete");
      clearTimeout(forceExitTimeout);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("Worker process started successfully and listening for jobs");
}

bootstrapWorker().catch((err) => {
  logger.fatal({ err }, "Failed to bootstrap worker process");
  process.exit(1);
});
