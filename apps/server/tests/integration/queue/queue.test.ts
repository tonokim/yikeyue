import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import {
  QueueRegistry,
  WorkerRegistry,
  createQueueConnection,
  registerPayloadSchema,
  enqueue,
  schedule,
  scanDeadLetters,
  registerAlertHook,
  FailedJobDetail,
} from "../../../src/queue/index.js";
import { QueueTestHarness } from "./harness.js";
import { infraPingSchema, deadLetterScanSchema } from "@yikey/shared";
import { logger } from "../../../src/logger/index.js";

describe("Queue Integration Tests", () => {
  let pgPool: pg.Pool;
  let redisConnection: any;
  const fileId = createId().substring(0, 8);
  const queuePrefix = `bq_${fileId}`;

  // Track alert hook calls
  let alertHookCalledWith: FailedJobDetail[] = [];

  beforeAll(async () => {
    const pgUrl = process.env.TEST_DATABASE_URL;
    const redisUrl = process.env.TEST_REDIS_URL;
    if (!pgUrl || !redisUrl) {
      throw new Error("TEST_DATABASE_URL or TEST_REDIS_URL is missing.");
    }

    pgPool = new pg.Pool({ connectionString: pgUrl, max: 2 });
    redisConnection = createQueueConnection(redisUrl);

    QueueRegistry.setConnection(redisConnection);
    WorkerRegistry.setConnection(redisConnection, pgPool);

    // Register schemas
    registerPayloadSchema("infra:ping", infraPingSchema);
    registerPayloadSchema("infra:dead-letter-scan", deadLetterScanSchema);

    // Register alert hook
    registerAlertHook(async (failedJobs) => {
      alertHookCalledWith = failedJobs;
    });
  });

  afterAll(async () => {
    await WorkerRegistry.closeAll();
    await QueueRegistry.closeAll();
    if (redisConnection) {
      // Clean up all keys starting with the test prefix
      const keys = await redisConnection.keys(`*${queuePrefix}*`);
      if (keys.length > 0) {
        await redisConnection.del(...keys);
      }
      await redisConnection.quit();
    }
    if (pgPool) {
      await pgPool.end();
    }
  });

  it("11.7 should reject invalid queue names", () => {
    expect(() => QueueRegistry.register("invalid_name")).toThrow();
    expect(() => QueueRegistry.register("CAPABILITY:job-kind")).toThrow();
    expect(() => QueueRegistry.register("capability:jobKind")).toThrow();
    expect(() => QueueRegistry.register("capability:job-kind-123")).not.toThrow();
  });

  it("11.1 & 11.8 should enqueue and process infra:ping demo queue successfully", async () => {
    const queueName = "infra:ping";
    QueueRegistry.register(queueName, { prefix: queuePrefix });

    const payload = {
      message: "hello from test",
      timestamp: Date.now(),
    };

    // Enqueue before registering worker so it sits in waiting state
    const job = await enqueue(queueName, payload);

    const waiting = await QueueTestHarness.getWaitingJobs(queueName);
    expect(waiting.length).toBe(1);

    let processedPayload: any = null;
    const worker = WorkerRegistry.register(
      queueName,
      async (p) => {
        processedPayload = p;
      },
      { concurrency: { infra: 1 } },
      { prefix: queuePrefix }
    );

    const { status } = await QueueTestHarness.waitForWorkerJob(worker, job);
    expect(status).toBe("completed");
    expect(processedPayload).toEqual(payload);

    const waitingAfter = await QueueTestHarness.getWaitingJobs(queueName);
    expect(waitingAfter.length).toBe(0);
  });

  it("11.2 should delay execution and only run after delay has passed", async () => {
    const queueName = "infra:delay-test";
    QueueRegistry.register(queueName, { prefix: queuePrefix });

    let runCount = 0;
    const worker = WorkerRegistry.register(
      queueName,
      async () => {
        runCount++;
      },
      undefined,
      { prefix: queuePrefix }
    );

    const job = await schedule(queueName, { val: "delayed" }, 150);

    // Immediately check status (should be delayed, runCount should be 0)
    expect(await job.getState()).toBe("delayed");
    expect(runCount).toBe(0);

    // Wait for the job to complete event-driven (timeout 2s)
    const { status } = await QueueTestHarness.waitForWorkerJob(worker, job, 2000);
    expect(status).toBe("completed");
    expect(runCount).toBe(1);
  });

  it("11.3 should enforce idempotency with jobId", async () => {
    const queueName = "infra:idempotent-test";
    const queue = QueueRegistry.register(queueName, { prefix: queuePrefix });

    const jobId = "idem-key-123";
    const payload = { data: "idem-data" };

    // Enqueue twice with same jobId before worker starts
    const job1 = await enqueue(queueName, payload, { jobId });
    const job2 = await enqueue(queueName, payload, { jobId });

    expect(job1.id).toBe(job2.id);

    const waiting = await queue.getWaiting();
    expect(waiting.length).toBe(1); // Deduplicated!

    let runCount = 0;
    const worker = WorkerRegistry.register(
      queueName,
      async () => {
        runCount++;
      },
      undefined,
      { prefix: queuePrefix }
    );

    const { status } = await QueueTestHarness.waitForWorkerJob(worker, job1);
    expect(status).toBe("completed");
    expect(runCount).toBe(1);
  });

  it("11.4 should validate payload schemas", async () => {
    const queueName = "infra:validation-test";
    const payloadSchema = z.object({
      phone: z.string(),
      count: z.number(),
    });
    registerPayloadSchema(queueName, payloadSchema);
    const queue = QueueRegistry.register(queueName, { prefix: queuePrefix });

    // 1. Should fail at enqueue time when using enqueue API
    await expect(enqueue(queueName, { phone: 123, count: "invalid" })).rejects.toThrow();

    // 2. Bypassing enqueue validation to test worker parse failure
    let executed = false;
    // Add directly to queue bypassing scheduler validation
    const job = await queue.add(queueName, { phone: 123, count: "invalid" });

    const worker = WorkerRegistry.register(
      queueName,
      async () => {
        executed = true;
      },
      undefined,
      { prefix: queuePrefix }
    );

    const { status } = await QueueTestHarness.waitForWorkerJob(worker, job);
    expect(status).toBe("failed");
    expect(executed).toBe(false);

    // Fetch fresh job to check failedReason
    const freshJob = await queue.getJob(job.id!);
    expect(freshJob?.failedReason).toContain("invalid_type");

    // Confirm that the job has been discarded and is in failed set
    const failedJobs = await QueueTestHarness.getFailedJobs(queueName);
    expect(failedJobs.length).toBe(1);
  });

  it("11.5 should support retry strategies and daily repeatable dead-letter scan", async () => {
    const queueName = "infra:retry-test";
    QueueRegistry.register(queueName, { prefix: queuePrefix });

    let runAttempts = 0;
    const worker = WorkerRegistry.register(
      queueName,
      async () => {
        runAttempts++;
        throw new Error("Database deadlock");
      },
      undefined,
      {
        prefix: queuePrefix,
        settings: {
          backoffStrategy: () => {
            return 50; // fast retry backoff (50ms) for tests
          },
        },
      }
    );

    // Default retry: attempts = 3, customExponential backoff (overridden to 50ms)
    const job = await enqueue(queueName, { task: "always-fails" }, { retryCategory: "default" });

    const { status } = await QueueTestHarness.waitForWorkerJob(worker, job, 3000);
    expect(status).toBe("failed");
    expect(runAttempts).toBe(3);

    // Verify it entered the failed jobs list
    const failed = await QueueTestHarness.getFailedJobs(queueName);
    expect(failed.length).toBe(1);

    // Trigger dead-letter scan
    alertHookCalledWith = [];
    const loggerErrorSpy = vi.spyOn(logger, "error");

    await scanDeadLetters();

    expect(loggerErrorSpy).toHaveBeenCalled();
    const currentQueueFailedJobs = alertHookCalledWith.filter(j => j.queue === queueName);
    expect(currentQueueFailedJobs.length).toBe(1);
    expect(currentQueueFailedJobs[0].queue).toBe(queueName);
    expect(currentQueueFailedJobs[0].failedReason).toBe("Database deadlock");
  });

  it("11.6 should handle graceful shutdown (SIGTERM)", async () => {
    const { spawn } = await import("child_process");

    // Close parent workers and queues so they don't compete with the child process worker
    await WorkerRegistry.closeAll();
    await QueueRegistry.closeAll();

    // Spawn the worker process using process.execPath to target the same Node.js executable
    const child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        REDIS_URL: process.env.TEST_REDIS_URL,
        QUEUE_PREFIX: queuePrefix,
      },
    });

    let workerStarted = false;
    let stdoutBuffer = "";

    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (data) => {
        const str = data.toString();
        stdoutBuffer += str;
        if (str.includes("Worker process started successfully")) {
          workerStarted = true;
          resolve();
        }
      });
      child.stderr.on("data", (data) => {
        logger.error("Worker process stderr: " + data.toString());
      });
      child.on("error", (err) => {
        reject(err);
      });
      setTimeout(() => {
        if (!workerStarted) {
          reject(new Error("Worker process failed to start within 10s. Logs:\n" + stdoutBuffer));
        }
      }, 10000);
    });

    expect(workerStarted).toBe(true);

    const queueName = "infra:ping";
    const queue = QueueRegistry.register(queueName, { prefix: queuePrefix });

    // 1. Enqueue job 1 which sleeps for 1200ms
    const job1 = await enqueue(queueName, {
      message: "in-flight-job",
      timestamp: Date.now(),
      sleepMs: 1200,
    });

    // Wait until job 1 becomes active in the child worker (polled state check)
    let state = await job1.getState();
    const startStateCheck = Date.now();
    while (state !== "active") {
      if (Date.now() - startStateCheck > 5000) {
        throw new Error("Job 1 did not become active within 5s. Current state: " + state);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      state = await job1.getState();
    }

    // Send SIGTERM to the worker child process
    child.kill("SIGTERM");

    // Wait until child process logs show signal handler execution
    const startSigCheck = Date.now();
    while (!stdoutBuffer.includes("Received SIGTERM")) {
      if (Date.now() - startSigCheck > 5000) {
        throw new Error("Worker process did not print 'Received SIGTERM' within 5s. Logs:\n" + stdoutBuffer);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 2. Enqueue job 2 after SIGTERM has run (should NOT be picked up by the worker)
    const job2 = await enqueue(queueName, {
      message: "should-be-left-waiting",
      timestamp: Date.now(),
    });

    // Wait for the child process to exit cleanly
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", (code) => {
        resolve(code);
      });
    });

    // The child process should exit cleanly (code 0)
    expect(exitCode).toBe(0);

    // Verify job 1 finished successfully
    const freshJob1 = await queue.getJob(job1.id!);
    expect(await freshJob1?.getState()).toBe("completed");

    // Verify job 2 remains in the waiting state (not picked up)
    const freshJob2 = await queue.getJob(job2.id!);
    expect(await freshJob2?.getState()).toBe("waiting");

    // Clean up job 2
    await freshJob2?.remove();
  }, 15000);
});
