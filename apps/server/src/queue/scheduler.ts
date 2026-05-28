import { JobsOptions } from "bullmq";
import { z } from "zod";
import { QueueRegistry } from "./registry.js";

export type RetryCategory = "default" | "external-api" | "db-write";

export interface RetryConfig {
  attempts: number;
  backoff?: {
    type: string;
    delay?: number;
  };
}

export const RETRY_STRATEGIES: Record<RetryCategory, RetryConfig> = {
  default: {
    attempts: 3,
    backoff: {
      type: "customExponential",
    },
  },
  "external-api": {
    attempts: 5,
    backoff: {
      type: "customExponential",
    },
  },
  "db-write": {
    attempts: 1, // No retries
  },
};

export interface SchedulerOpts {
  jobId?: string; // Business key for idempotency
  retryCategory?: RetryCategory;
}

// Memory map to store Zod payload schemas for queues
const payloadSchemas = new Map<string, z.ZodSchema<any>>();

export function registerPayloadSchema<T>(queueName: string, schema: z.ZodSchema<T>) {
  payloadSchemas.set(queueName, schema);
}

export function getPayloadSchema(queueName: string): z.ZodSchema<any> | undefined {
  return payloadSchemas.get(queueName);
}

/**
 * 3.1 Implement immediate enqueue
 */
export async function enqueue<T>(
  queueName: string,
  payload: T,
  opts?: SchedulerOpts
) {
  const queue = QueueRegistry.get(queueName);

  // Validate payload before enqueueing (fail early)
  const schema = getPayloadSchema(queueName);
  if (schema) {
    schema.parse(payload);
  }

  const category = opts?.retryCategory ?? "default";
  const retryConfig = RETRY_STRATEGIES[category];

  const jobOpts: JobsOptions = {
    jobId: opts?.jobId,
    attempts: retryConfig.attempts,
    backoff: retryConfig.backoff,
  };

  return await queue.add(queueName, payload, jobOpts);
}

/**
 * 3.2 Implement delayed schedule
 */
export async function schedule<T>(
  queueName: string,
  payload: T,
  delayMs: number,
  opts?: SchedulerOpts
) {
  const queue = QueueRegistry.get(queueName);

  const schema = getPayloadSchema(queueName);
  if (schema) {
    schema.parse(payload);
  }

  const category = opts?.retryCategory ?? "default";
  const retryConfig = RETRY_STRATEGIES[category];

  const jobOpts: JobsOptions = {
    jobId: opts?.jobId,
    attempts: retryConfig.attempts,
    backoff: retryConfig.backoff,
    delay: delayMs,
  };

  return await queue.add(queueName, payload, jobOpts);
}

/**
 * 3.3 Implement repeatable cron
 */
export async function repeatable<T>(
  queueName: string,
  payload: T,
  cron: string,
  opts?: Omit<SchedulerOpts, "jobId">
) {
  const queue = QueueRegistry.get(queueName);

  const schema = getPayloadSchema(queueName);
  if (schema) {
    schema.parse(payload);
  }

  const category = opts?.retryCategory ?? "default";
  const retryConfig = RETRY_STRATEGIES[category];

  const jobOpts: JobsOptions = {
    attempts: retryConfig.attempts,
    backoff: retryConfig.backoff,
    repeat: {
      pattern: cron,
    },
  };

  return await queue.add(queueName, payload, jobOpts);
}
