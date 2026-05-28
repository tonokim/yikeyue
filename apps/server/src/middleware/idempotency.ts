import { createMiddleware } from "hono/factory";
import { Redis } from "ioredis";
import { AppEnv } from "../types.js";
import { BizError, serializeBizError } from "../errors.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to cache completed response.
 */
async function cacheCompletedResponse(c: any, redis: Redis, redisKey: string) {
  if (!c.res) return;

  const clonedRes = c.res.clone();
  const bodyText = await clonedRes.text();
  const status = clonedRes.status;
  const headers: Record<string, string> = {};
  const contentType = clonedRes.headers.get("content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }

  await redis.set(
    redisKey,
    JSON.stringify({
      status: "completed",
      response: { status, body: bodyText, headers },
    }),
    "EX",
    24 * 60 * 60
  );
}

/**
 * Helper to handle handler error caching.
 * If client error (BizError with status < 500), we format it using serializeBizError
 * and cache the response.
 * Otherwise (5xx or system errors), we delete the lock key and rethrow.
 */
async function handleHandlerError(c: any, err: any, redis: Redis, redisKey: string) {
  const isClientError = err instanceof BizError && err.httpStatus < 500;

  if (isClientError) {
    try {
      const reqId = c.var.requestId || "unknown";
      const log = c.var.log;
      if (log) {
        log.warn(
          {
            code: err.code,
            message: err.message,
            status: err.httpStatus,
            details: err.details,
          },
          `Business Error [${err.code}]: ${err.message}`,
        );
      }

      const response = c.json(serializeBizError(err, reqId), err.httpStatus as any);
      c.res = response;
      await cacheCompletedResponse(c, redis, redisKey);
      return;
    } catch (cacheErr) {
      const log = c.var.log;
      if (log) {
        log.warn({ err: cacheErr }, "Failed to cache client error response in idempotency middleware");
      }
    }
  }

  // Delete lock and rethrow for system/5xx errors
  try {
    await redis.del(redisKey);
  } catch (redisErr) {
    const log = c.var.log;
    if (log) {
      log.warn({ err: redisErr }, "Redis error deleting lock key on handler failure");
    }
  }
  throw err;
}

/**
 * Helper to run request handler and cache the result.
 */
async function runHandlerAndCache(c: any, next: () => Promise<void>, redis: Redis, redisKey: string) {
  try {
    await next();

    // Any Redis errors after handler execution must NOT bubble up to rerun handler
    try {
      if (c.res) {
        if (c.res.status >= 500) {
          await redis.del(redisKey);
        } else {
          await cacheCompletedResponse(c, redis, redisKey);
        }
      }
    } catch (redisErr) {
      const log = c.var.log;
      if (log) {
        log.warn({ err: redisErr }, "Redis error during idempotency response caching after handler execution");
      }
    }
  } catch (err) {
    await handleHandlerError(c, err, redis, redisKey);
  }
}

/**
 * Idempotency Middleware.
 * Design Invariant: 7.6 - Looks for 'Idempotency-Key' request header.
 * Caches and replays response body, status, and headers via Redis with 24h TTL.
 * Cache key: 'idem:<endpoint>:<key>'
 * 
 * Concurrency Safety (P1):
 * Uses atomic `SET key "in-progress" NX EX 30` to serialize concurrent requests.
 * If the key already exists:
 *   - If "completed", replays response.
 *   - If "in-progress", polls Redis every 100ms for up to 5s.
 *   - If the lock expires or is deleted, tries to acquire it.
 *   - If polling times out, throws 409 Conflict.
 * If the request fails, deletes the lock key so the client can retry immediately.
 */
export function createIdempotencyMiddleware(redis: Redis) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header("Idempotency-Key");
    if (!key) {
      return await next();
    }

    const endpoint = c.req.path;
    const redisKey = `idem:${endpoint}:${key}`;

    // 1. Try to acquire lock. This is a BEFORE-handler Redis operation.
    let lockAcquired: string | null;
    try {
      lockAcquired = await redis.set(
        redisKey,
        JSON.stringify({ status: "in-progress" }),
        "EX",
        30,
        "NX"
      );
    } catch (err) {
      // Redis failed BEFORE handler. Fail-soft: run handler.
      const log = c.var.log;
      if (log) {
        log.warn({ err }, "Redis error encountered in idempotency middleware before handler execution");
      }
      return await next();
    }

    if (lockAcquired !== "OK") {
      // Lock not acquired. Poll and replay.
      // We wrap the polling logic in a try/catch. If it fails due to Redis error, fail-soft and run handler.
      try {
        let attempts = 0;
        const maxAttempts = 50;

        while (attempts < maxAttempts) {
          await sleep(100);
          attempts++;

          const currentVal = await redis.get(redisKey);
          if (!currentVal) {
            // Lock was deleted or expired. Try to acquire it ourselves.
            const acquire = await redis.set(
              redisKey,
              JSON.stringify({ status: "in-progress" }),
              "EX",
              30,
              "NX"
            );
            if (acquire === "OK") {
              // We successfully acquired the lock! Run the handler and cache.
              await runHandlerAndCache(c, next, redis, redisKey);
              return;
            }
            continue;
          }

          const parsed = JSON.parse(currentVal);
          if (parsed.status === "completed") {
            const replay = parsed.response;
            c.status(replay.status);
            if (replay.headers) {
              for (const [hk, hv] of Object.entries(replay.headers)) {
                c.header(hk, hv as string);
              }
            }
            return c.body(replay.body);
          }
        }

        throw new BizError(
          "idempotency.conflict",
          "A concurrent request with the same idempotency key is already in progress.",
          { httpStatus: 409 }
        );
      } catch (err) {
        if (err instanceof BizError) {
          throw err;
        }
        // Redis failed during polling. Fail-soft: run handler.
        const log = c.var.log;
        if (log) {
          log.warn({ err }, "Redis error during idempotency polling. Failing soft.");
        }
        return await next();
      }
    }

    // 2. Lock was acquired successfully, run the request and cache.
    await runHandlerAndCache(c, next, redis, redisKey);
  });
}

