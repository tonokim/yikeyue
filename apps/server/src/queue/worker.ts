import { Worker, WorkerOptions } from "bullmq";
import { Redis } from "ioredis";
import pg from "pg";
import { JobContext, createJobContext } from "./context.js";
import { getPayloadSchema } from "./scheduler.js";
import { logger } from "../logger/index.js";

export interface WorkerConfig {
  concurrency?: Record<string, number>;
}

export class WorkerRegistry {
  private static workers: Worker[] = [];
  private static connection: Redis;
  private static pgPool: pg.Pool;

  static setConnection(connection: Redis, pgPool: pg.Pool) {
    this.connection = connection;
    this.pgPool = pgPool;
  }

  static register(
    queueName: string,
    processor: (payload: any, ctx: JobContext) => Promise<void>,
    config?: WorkerConfig,
    opts?: Omit<WorkerOptions, "connection" | "concurrency">
  ): Worker {
    if (!this.connection || !this.pgPool) {
      throw new Error("WorkerRegistry connection or PG pool not set. Call WorkerRegistry.setConnection() first.");
    }

    const capability = queueName.split(":")[0];
    const concurrency = config?.concurrency?.[capability] ?? 5; // Default to 5

    const bullName = queueName.replace(":", "__");
    const worker = new Worker(
      bullName,
      async (job) => {
        const attempt = job.attemptsMade + 1;
        const ctx = createJobContext({
          queueName,
          jobId: job.id ?? "unknown",
          attempt,
          pgPool: this.pgPool,
        });

        ctx.log.info({ jobName: job.name }, "Starting job processing");

        // 4.2 Validate payload at worker entry
        try {
          const schema = getPayloadSchema(queueName);
          if (schema) {
            job.data = schema.parse(job.data);
          }
        } catch (err) {
          ctx.log.error({ err, data: job.data }, "Payload validation failed, discarding job immediately");
          // Discard job to prevent retries, sending it directly to dead letter (failed state)
          await job.discard();
          throw err;
        }

        try {
          await processor(job.data, ctx);
          ctx.log.info("Job processed successfully");
        } catch (err) {
          ctx.log.error({ err }, "Job execution threw an error");
          throw err;
        }
      },
      {
        ...opts,
        connection: this.connection as any,
        concurrency,
        settings: {
          backoffStrategy: (attemptsMade: number, type: string | undefined) => {
            if (type === "customExponential") {
              return Math.pow(4, attemptsMade - 1) * 2000;
            }
            return -1;
          },
          ...opts?.settings,
        },
      }
    );

    this.workers.push(worker);
    return worker;
  }

  static getWorkers(): Worker[] {
    return this.workers;
  }

  static async closeAll() {
    logger.info("Closing all workers...");
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers = [];
  }
}
