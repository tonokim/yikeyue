import { Redis } from "ioredis";

/**
 * Factory to create a Redis client instance.
 * Design invariant: D8 - Standalone Redis client independent of BullMQ queues.
 */
export function createRedisClient(url: string): Redis {
  const isTest = process.env.NODE_ENV === "test";
  return new Redis(url, {
    // In test environment, fail fast rather than hanging indefinitely
    maxRetriesPerRequest: isTest ? 3 : null,
    connectTimeout: isTest ? 2000 : 10000,
  });
}
export type RedisClient = Redis;
