import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { createApp } from "../../src/app.js";

describe("/health integration tests", () => {
  const harness = createTestHarness();

  it("returns 200 and healthy details when both Postgres and Redis are reachable", async () => {
    const res = await harness.request("GET", "/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe("healthy");
    expect(body.data.postgres).toBe("up");
    expect(body.data.redis).toBe("up");
  });

  it("returns 503 when postgres is unreachable", async () => {
    // Create a mock DB that throws on execution
    const failingDb = {
      execute: async () => {
        throw new Error("PostgreSQL connection timeout simulation");
      },
    } as any;

    // Build Hono app instance with the failing DB dependency injected
    const customApp = createApp({
      db: failingDb,
      redis: harness.redis,
      clock: () => new Date(),
      jwtSecret: "test-secret",
    });

    const res = await customApp.request("/health");
    expect(res.status).toBe(503);

    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("health.unhealthy");
    expect(body.error.details.postgres).toBe("down");
    expect(body.error.details.redis).toBe("up");
  });

  it("returns 503 when redis is unreachable", async () => {
    // Create a mock Redis that throws on ping
    const failingRedis = {
      ping: async () => {
        throw new Error("Redis connection dropped simulation");
      },
    } as any;

    // Build Hono app instance with the failing Redis dependency injected
    const customApp = createApp({
      db: harness.db,
      redis: failingRedis,
      clock: () => new Date(),
      jwtSecret: "test-secret",
    });

    const res = await customApp.request("/health");
    expect(res.status).toBe(503);

    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("health.unhealthy");
    expect(body.error.details.postgres).toBe("up");
    expect(body.error.details.redis).toBe("down");
  });
});
