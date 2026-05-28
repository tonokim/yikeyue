import { Redis } from "ioredis";

/**
 * Creates a dedicated Redis client instance for BullMQ.
 * Design Invariant: D1 - connection must have maxRetriesPerRequest set to null.
 */
export function createQueueConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
  });
}
