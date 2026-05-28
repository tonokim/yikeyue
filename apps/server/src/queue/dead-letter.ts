import { QueueRegistry } from "./registry.js";
import { logger } from "../logger/index.js";

export interface FailedJobDetail {
  queue: string;
  jobId: string;
  failedReason: string;
  data: any;
}

export type AlertHook = (failedJobs: FailedJobDetail[]) => Promise<void>;

let currentAlertHook: AlertHook = async (failedJobs) => {
  logger.warn({ count: failedJobs.length }, "Default alert hook called (no action taken)");
};

export function registerAlertHook(hook: AlertHook) {
  currentAlertHook = hook;
}

export function getAlertHook(): AlertHook {
  return currentAlertHook;
}

/**
 * 6.1 Traverses all queues and scans failed jobs, logging them as errors and invoking the alert hook.
 */
export async function scanDeadLetters() {
  const queues = QueueRegistry.getAll();
  const failedJobsToAlert: FailedJobDetail[] = [];

  for (const queue of queues) {
    try {
      const failedJobs = await queue.getFailed();
      const publicQueueName = queue.name.replace("__", ":");
      for (const job of failedJobs) {
        // Log at `error` level (design D6)
        logger.error(
          {
            queue: publicQueueName,
            jobId: job.id,
            failedReason: job.failedReason,
            data: job.data,
          },
          `Dead letter detected in queue "${publicQueueName}"`
        );

        failedJobsToAlert.push({
          queue: publicQueueName,
          jobId: job.id ?? "unknown",
          failedReason: job.failedReason ?? "unknown",
          data: job.data,
        });
      }
    } catch (err) {
      logger.error({ err, queueName: queue.name }, "Failed to get failed jobs from queue");
    }
  }

  if (failedJobsToAlert.length > 0) {
    try {
      await currentAlertHook(failedJobsToAlert);
    } catch (err) {
      logger.error({ err }, "Alert hook execution failed");
    }
  }
}
