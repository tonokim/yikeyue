import { Job, Worker } from "bullmq";
import { QueueRegistry } from "../../../src/queue/registry.js";

/**
 * Queue Test Harness
 * Provides robust helper methods for verifying queue jobs without relying on BullMQ internals.
 */
export class QueueTestHarness {
  /**
   * Waits for a job to complete or fail by subscribing to Worker events first,
   * and immediately re-checking its state to prevent missing events due to race conditions.
   * This is 100% event-driven and race-free.
   */
  static async waitForWorkerJob(
    worker: Worker,
    job: Job,
    timeoutMs = 5000
  ): Promise<{ status: "completed" | "failed"; err?: Error }> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        worker.off("completed", onCompleted);
        worker.off("failed", onFailed);
        clearTimeout(timer);
      };

      const onCompleted = (j: Job) => {
        if (j.id === job.id && !resolved) {
          resolved = true;
          cleanup();
          resolve({ status: "completed" });
        }
      };

      const onFailed = (j: Job | undefined, err: Error) => {
        if (j && j.id === job.id && !resolved) {
          const maxAttempts = j.opts.attempts ?? 1;
          if (j.attemptsMade >= maxAttempts) {
            resolved = true;
            cleanup();
            resolve({ status: "failed", err });
          }
        }
      };

      // 1. Register event listeners first
      worker.on("completed", onCompleted);
      worker.on("failed", onFailed);

      // 2. Start timeout timer
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Timeout waiting for job ${job.id} on worker ${worker.name}`));
        }
      }, timeoutMs);

      // 3. Immediately query state in case the job already finished
      job
        .getState()
        .then((state) => {
          if (resolved) return;
          if (state === "completed") {
            resolved = true;
            cleanup();
            resolve({ status: "completed" });
          } else if (state === "failed") {
            resolved = true;
            cleanup();
            resolve({ status: "failed", err: new Error(job.failedReason) });
          }
        })
        .catch((err) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(err);
          }
        });
    });
  }

  static async getWaitingJobs(queueName: string): Promise<Job[]> {
    const queue = QueueRegistry.get(queueName);
    return await queue.getWaiting();
  }

  static async getFailedJobs(queueName: string): Promise<Job[]> {
    const queue = QueueRegistry.get(queueName);
    return await queue.getFailed();
  }

  static async getCompletedJobs(queueName: string): Promise<Job[]> {
    const queue = QueueRegistry.get(queueName);
    return await queue.getCompleted();
  }
}
