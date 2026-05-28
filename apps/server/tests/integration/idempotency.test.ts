import { describe, it, expect, vi } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { createIdempotencyMiddleware } from "../../src/middleware/idempotency.js";
import { migrationMeta } from "../../src/db/schema.js";
import { BizError } from "../../src/errors.js";

describe("Idempotency Middleware Integration Tests", () => {
  const harness = createTestHarness();
  
  let sideEffectCount = 0;

  function registerRoute() {
    harness.app.post(
      "/test-idempotency/action",
      createIdempotencyMiddleware(harness.redis),
      async (c: any) => {
        sideEffectCount += 1;
        const db = c.var.db;
        
        // Cause database side effect
        const inserted = await db
          .insert(migrationMeta)
          .values({
            metaKey: `key_idem_${Math.random()}`,
            metaValue: `run_${sideEffectCount}`,
          })
          .returning();

        return c.json({
          runNumber: sideEffectCount,
          recordId: inserted[0].id,
        });
      },
    );
  }

  it("same key replay: returns identical cached response and executes side effects only once", async () => {
    sideEffectCount = 0;
    registerRoute();
    const idemKey = "test-idem-key-123";

    // 1. First execution
    const res1 = await harness.request("POST", "/test-idempotency/action", {
      headers: { "Idempotency-Key": idemKey },
    });
    expect(res1.status).toBe(200);
    
    const body1 = await res1.json();
    expect(body1.data.runNumber).toBe(1);
    const initialRecordId = body1.data.recordId;
    expect(initialRecordId).toBeDefined();
    expect(sideEffectCount).toBe(1);

    // 2. Second execution (replay)
    const res2 = await harness.request("POST", "/test-idempotency/action", {
      headers: { "Idempotency-Key": idemKey },
    });
    expect(res2.status).toBe(200);

    const body2 = await res2.json();
    // Verify response matches the first one exactly
    expect(body2.data.runNumber).toBe(1);
    expect(body2.data.recordId).toBe(initialRecordId);
    
    // Verify that the side effect count was NOT incremented (remains 1)
    expect(sideEffectCount).toBe(1);

    // Verify database count is exactly 1 (since transaction is active, we can count inside harness.db)
    const records = await harness.db.select().from(migrationMeta);
    expect(records).toHaveLength(1);
  });

  it("different keys: processes requests independently", async () => {
    sideEffectCount = 0;
    registerRoute();
    // 1. Execute first key
    const res1 = await harness.request("POST", "/test-idempotency/action", {
      headers: { "Idempotency-Key": "idem-key-A" },
    });
    expect(res1.status).toBe(200);
    
    const body1 = await res1.json();
    expect(body1.data.runNumber).toBe(1);
    expect(sideEffectCount).toBe(1);

    // 2. Execute second key
    const res2 = await harness.request("POST", "/test-idempotency/action", {
      headers: { "Idempotency-Key": "idem-key-B" },
    });
    expect(res2.status).toBe(200);

    const body2 = await res2.json();
    expect(body2.data.runNumber).toBe(2);
    expect(sideEffectCount).toBe(2);

    // Verify database contains 2 records
    const records = await harness.db.select().from(migrationMeta);
    expect(records).toHaveLength(2);
  });

  it("no idempotency header: processes normally every time", async () => {
    sideEffectCount = 0;
    registerRoute();
    // 1. First execution without header
    const res1 = await harness.request("POST", "/test-idempotency/action");
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.data.runNumber).toBe(1);

    // 2. Second execution without header
    const res2 = await harness.request("POST", "/test-idempotency/action");
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.runNumber).toBe(2);

    expect(sideEffectCount).toBe(2);
  });

  it("concurrent requests: processes only once and serializes concurrent calls", async () => {
    sideEffectCount = 0;
    registerRoute();
    const idemKey = "test-concurrent-idem-key";

    // Trigger two requests concurrently
    const [res1, res2] = await Promise.all([
      harness.request("POST", "/test-idempotency/action", {
        headers: { "Idempotency-Key": idemKey },
      }),
      harness.request("POST", "/test-idempotency/action", {
        headers: { "Idempotency-Key": idemKey },
      }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.data.runNumber).toBe(1);
    expect(body2.data.runNumber).toBe(1);
    expect(body1.data.recordId).toBe(body2.data.recordId);
    expect(sideEffectCount).toBe(1);
  });

  it("handler fails: releases lock and allows immediate retry", async () => {
    let callCount = 0;
    harness.app.post(
      "/test-idempotency/failing-action",
      createIdempotencyMiddleware(harness.redis),
      async (c: any) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Temporary DB/API error");
        }
        return c.json({ ok: true, callCount });
      }
    );

    const idemKey = "test-fail-idem-key";

    // First call: should fail with 500 error
    const res1 = await harness.request("POST", "/test-idempotency/failing-action", {
      headers: { "Idempotency-Key": idemKey },
    });
    expect(res1.status).toBe(500);

    // Second call: should succeed since lock was deleted on failure
    const res2 = await harness.request("POST", "/test-idempotency/failing-action", {
      headers: { "Idempotency-Key": idemKey },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.callCount).toBe(2);
  });

  it("lock deleted during polling: polling request acquires the lock and executes", async () => {
    let runCount = 0;
    // We will use a promise resolver to control request 1 execution
    let resolveRequest1: (() => void) | undefined;
    const request1Started = new Promise<void>((resolve) => {
      resolveRequest1 = resolve;
    });

    harness.app.post(
      "/test-idempotency/polling-acquire",
      createIdempotencyMiddleware(harness.redis),
      async (c: any) => {
        runCount++;
        if (runCount === 1) {
          // Notify that request 1 has started the handler
          resolveRequest1?.();
          // Keep it blocked for a bit to let request 2 start polling
          await new Promise((resolve) => setTimeout(resolve, 300));
          throw new Error("Fail request 1 to release/delete lock");
        }
        return c.json({ runCount });
      }
    );

    const idemKey = "test-poll-delete-key";

    // Start request 1 asynchronously
    const req1Promise = harness.request("POST", "/test-idempotency/polling-acquire", {
      headers: { "Idempotency-Key": idemKey },
    });

    // Wait until request 1 has acquired lock and entered the handler
    await request1Started;

    // Start request 2 which should find it "in-progress" and start polling
    const res2 = await harness.request("POST", "/test-idempotency/polling-acquire", {
      headers: { "Idempotency-Key": idemKey },
    });

    // Request 1 should have failed
    const res1 = await req1Promise;
    expect(res1.status).toBe(500);

    // Request 2 should have taken over the lock when request 1 failed, and succeeded!
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.runCount).toBe(2);
  });

  it("polling times out: throws 409 conflict", async () => {
    // Mock setTimeout to fire callback immediately to speed up the polling loop
    const setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });

    registerRoute();
    const idemKey = "test-timeout-idem-key";
    const endpoint = "/test-idempotency/action";
    const redisKey = `idem:${endpoint}:${idemKey}`;

    // Manually set lock to "in-progress"
    await harness.redis.set(redisKey, JSON.stringify({ status: "in-progress" }), "EX", 30);

    const res = await harness.request("POST", endpoint, {
      headers: { "Idempotency-Key": idemKey },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("idempotency.conflict");

    setTimeoutSpy.mockRestore();
  });

  it("redis error: fail-soft and executes route normally", async () => {
    const brokenRedis = {
      set: async () => { throw new Error("Redis connection lost"); },
      get: async () => { throw new Error("Redis connection lost"); },
      del: async () => { throw new Error("Redis connection lost"); },
    } as any;

    let localCallCount = 0;
    harness.app.post(
      "/test-idempotency/broken-redis",
      createIdempotencyMiddleware(brokenRedis),
      async (c: any) => {
        localCallCount++;
        return c.json({ localCallCount });
      }
    );

    const res = await harness.request("POST", "/test-idempotency/broken-redis", {
      headers: { "Idempotency-Key": "some-key" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.localCallCount).toBe(1);
  });

  it("redis completed write failure: does NOT execute handler twice and returns original response", async () => {
    let handlerExecutions = 0;
    
    // Custom mock redis that fails on completed set write but succeeds on NX set lock
    const mockRedis = {
      set: async (...args: any[]) => {
        if (args.length === 5 && args[4] === "NX") {
          return "OK";
        }
        throw new Error("Redis write failure on completed state");
      },
      get: async () => null,
      del: async () => 1,
    } as any;

    harness.app.post(
      "/test-idempotency/redis-post-fail",
      createIdempotencyMiddleware(mockRedis),
      async (c: any) => {
        handlerExecutions++;
        return c.json({ executions: handlerExecutions });
      }
    );

    const res = await harness.request("POST", "/test-idempotency/redis-post-fail", {
      headers: { "Idempotency-Key": "post-fail-key" },
    });

    // The response should be returned successfully (200) despite the Redis write failure
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.executions).toBe(1);
    
    // Crucially, the handler must only have executed ONCE, and not a second time via next()!
    expect(handlerExecutions).toBe(1);
  });

  it("caching client error responses: caches and replays BizError/4xx successfully", async () => {
    let handlerExecutions = 0;

    harness.app.post(
      "/test-idempotency/biz-error-caching",
      createIdempotencyMiddleware(harness.redis),
      async (_c: any) => {
        handlerExecutions++;
        throw new BizError("validation.invalid_input", "Some client validation failed", {
          httpStatus: 400,
          details: { field: "name" },
        });
      }
    );

    const idemKey = "biz-error-idem-key";

    // First call: returns 400
    const res1 = await harness.request("POST", "/test-idempotency/biz-error-caching", {
      headers: { "Idempotency-Key": idemKey },
    });
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error.code).toBe("validation.invalid_input");
    expect(body1.error.message).toBe("Some client validation failed");
    expect(body1.error.details).toEqual({ field: "name" });
    expect(handlerExecutions).toBe(1);

    // Second call: replays 400 from cache, and does not execute handler again
    const res2 = await harness.request("POST", "/test-idempotency/biz-error-caching", {
      headers: { "Idempotency-Key": idemKey },
    });
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error.code).toBe("validation.invalid_input");
    expect(body2.error.message).toBe("Some client validation failed");
    expect(body2.error.details).toEqual({ field: "name" });
    
    // Verify handler ran only once!
    expect(handlerExecutions).toBe(1);
  });

  it("handleHandlerError: covers exception bubbling path when next() throws", async () => {
    const middleware = createIdempotencyMiddleware(harness.redis);
    
    const mockCtx = {
      req: {
        header: () => "bubble-key",
        path: "/test-idempotency/bubble",
      },
      res: null,
      var: {
        log: {
          warn: () => {},
        },
      },
      status: () => {},
      json: (data: any, status: number) => {
        return {
          status: status || 400,
          clone: function() { return this; },
          text: async () => JSON.stringify(data),
          headers: { get: () => null },
        } as any;
      },
    } as any;

    const mockNext = async () => {
      throw new BizError("validation.invalid_input", "Bubbled validation error", {
        httpStatus: 400,
      });
    };

    // Execute the middleware directly
    await middleware(mockCtx, mockNext);

    // Verify it caught the error, called errorHandler, and cached/assigned response
    expect(mockCtx.res).toBeDefined();
    expect(mockCtx.res.status).toBe(400);

    // Clean up Redis
    await harness.redis.del(`idem:/test-idempotency/bubble:bubble-key`);
  });

  it("handleHandlerError: deletes lock and rethrows for bubbled 500 errors", async () => {
    const middleware = createIdempotencyMiddleware(harness.redis);
    const mockCtx = {
      req: {
        header: () => "bubble-500-key",
        path: "/test-idempotency/bubble-500",
      },
      var: {
        log: {
          warn: () => {},
        },
      },
    } as any;

    const mockNext = async () => {
      throw new Error("Bubbled server error");
    };

    await expect(middleware(mockCtx, mockNext)).rejects.toThrow("Bubbled server error");
    
    // Verify lock key is deleted
    const val = await harness.redis.get("idem:/test-idempotency/bubble-500:bubble-500-key");
    expect(val).toBeNull();
  });

  it("polling Redis failure: fail-soft and executes route normally", async () => {
    const mockRedis = {
      set: async (...args: any[]) => {
        if (args.length === 5 && args[4] === "NX") {
          return null; // lock not acquired, go to polling
        }
        return "OK";
      },
      get: async () => {
        throw new Error("Redis connection lost during polling");
      },
    } as any;

    let runCount = 0;
    harness.app.post(
      "/test-idempotency/polling-redis-fail",
      createIdempotencyMiddleware(mockRedis),
      async (c: any) => {
        runCount++;
        return c.json({ runCount });
      }
    );

    const res = await harness.request("POST", "/test-idempotency/polling-redis-fail", {
      headers: { "Idempotency-Key": "poll-fail-key" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.runCount).toBe(1);
    expect(runCount).toBe(1);
  });

  it("polling lock disappeared but acquired by someone else: continues polling", async () => {
    let getCalls = 0;
    const mockRedis = {
      set: async (...args: any[]) => {
        if (args.length === 5 && args[4] === "NX") {
          // Lock not acquired initially, and not acquired when polling either
          return null;
        }
        return "OK";
      },
      get: async () => {
        getCalls++;
        if (getCalls === 1) {
          return JSON.stringify({ status: "in-progress" });
        }
        if (getCalls === 2) {
          return null; // simulating lock deleted/expired
        }
        // subsequent calls return completed
        return JSON.stringify({
          status: "completed",
          response: { status: 200, body: JSON.stringify({ completed: true }), headers: { "content-type": "application/json" } },
        });
      },
    } as any;

    harness.app.get(
      "/test-idempotency/polling-takeover-fail",
      createIdempotencyMiddleware(mockRedis),
      async (c: any) => {
        return c.json({ ok: true });
      }
    );

    const res = await harness.request("GET", "/test-idempotency/polling-takeover-fail", {
      headers: { "Idempotency-Key": "takeover-fail-key" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ completed: true });
  });
});

