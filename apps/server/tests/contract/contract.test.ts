import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { HealthResponseSchema } from "@yikey/shared";

describe("Contract integration tests", () => {
  const harness = createTestHarness();

  it("GET /health matches the shared Zod schema contract", async () => {
    const res = await harness.request("GET", "/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    
    // Design Invariant: 11.8 - Validate endpoint response against shared packages schema
    const parsed = HealthResponseSchema.parse(body);
    
    expect(parsed.request_id).toBeDefined();
    expect(parsed.data).toBeDefined();
    expect(parsed.data.status).toBe("healthy");
    expect(parsed.data.postgres).toBe("up");
    expect(parsed.data.redis).toBe("up");
  });
});
