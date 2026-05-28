import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { createRateLimitMiddleware } from "../../src/middleware/rate-limit.js";
import { generateTestToken } from "../helpers/jwt.js";
import { UserPayload } from "../../src/types.js";

describe("Rate Limiting Middleware Integration Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  const userA: UserPayload = { id: "usr_A", uid: "EKYA", role: "store_staff" };
  const userB: UserPayload = { id: "usr_B", uid: "EKYB", role: "store_staff" };

  function registerRoute() {
    harness.app.get(
      "/test-ratelimit/action",
      createRateLimitMiddleware(harness.redis, {
        windowSeconds: 10,
        maxRequests: 2,
      }),
      (c: any) => {
        return c.json({ ok: true });
      },
    );
  }

  it("below threshold passes, exceeding threshold returns 429 rate_limit.exceeded & Retry-After", async () => {
    registerRoute();
    const token = await generateTestToken(userA, jwtSecret);
    const headers = { Authorization: `Bearer ${token}` };

    // Request 1: OK
    const res1 = await harness.request("GET", "/test-ratelimit/action", { headers });
    expect(res1.status).toBe(200);

    // Request 2: OK
    const res2 = await harness.request("GET", "/test-ratelimit/action", { headers });
    expect(res2.status).toBe(200);

    // Request 3: Exceeded -> 429
    const res3 = await harness.request("GET", "/test-ratelimit/action", { headers });
    expect(res3.status).toBe(429);

    const retryAfter = res3.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);

    const body = await res3.json();
    expect(body.error.code).toBe("rate_limit.exceeded");
  });

  it("different identities count independently", async () => {
    registerRoute();
    const tokenA = await generateTestToken(userA, jwtSecret);
    const tokenB = await generateTestToken(userB, jwtSecret);

    // Consume limits of User A
    await harness.request("GET", "/test-ratelimit/action", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    await harness.request("GET", "/test-ratelimit/action", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    
    const resA3 = await harness.request("GET", "/test-ratelimit/action", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(resA3.status).toBe(429); // User A is limited

    // User B request: OK (independent limit)
    const resB1 = await harness.request("GET", "/test-ratelimit/action", {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(resB1.status).toBe(200);
  });

  it("healthcheck endpoint /health is never rate limited", async () => {
    registerRoute();
    // Consume User A limits on target route
    const token = await generateTestToken(userA, jwtSecret);
    const headers = { Authorization: `Bearer ${token}` };

    await harness.request("GET", "/test-ratelimit/action", { headers });
    await harness.request("GET", "/test-ratelimit/action", { headers });
    
    // Target route is limited
    const resTarget = await harness.request("GET", "/test-ratelimit/action", { headers });
    expect(resTarget.status).toBe(429);

    // Health check endpoint still works under same identity
    const resHealth = await harness.request("GET", "/health", { headers });
    expect(resHealth.status).toBe(200);
  });
});
