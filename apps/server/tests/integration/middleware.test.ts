import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { BizError } from "../../src/errors.js";

describe("Middleware Integration Tests", () => {
  const harness = createTestHarness();

  it("request_id header matches response body and wraps successful JSON responses", async () => {
    // Register test endpoint
    harness.app.get("/test/success", (c: any) => {
      return c.json({ result: "success_data" });
    });

    const res = await harness.request("GET", "/test/success");
    expect(res.status).toBe(200);

    const reqIdHeader = res.headers.get("X-Request-Id");
    expect(reqIdHeader).toBeDefined();
    expect(reqIdHeader?.startsWith("req_")).toBe(true);

    const body = await res.json();
    // Success response shape: { request_id, data }
    expect(body.request_id).toBe(reqIdHeader);
    expect(body.data).toEqual({ result: "success_data" });
  });

  it("BizError maps to custom HTTP status and unified error structure", async () => {
    harness.app.get("/test/biz-error", () => {
      throw new BizError("auth.forbidden", "Access denied for this resource", {
        httpStatus: 403,
        details: { required_role: "super_admin" },
      });
    });

    const res = await harness.request("GET", "/test/biz-error");
    expect(res.status).toBe(403);

    const reqIdHeader = res.headers.get("X-Request-Id");
    const body = await res.json();

    // Error response shape: { request_id, error: { code, message, details } }
    expect(body.request_id).toBe(reqIdHeader);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("auth.forbidden");
    expect(body.error.message).toBe("Access denied for this resource");
    expect(body.error.details).toEqual({ required_role: "super_admin" });
  });

  it("unhandled exception maps to 500 and does not leak stack trace", async () => {
    harness.app.get("/test/unhandled-error", () => {
      throw new Error("Db connection timeout or internal code bug!");
    });

    const res = await harness.request("GET", "/test/unhandled-error");
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.request_id).toBeDefined();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("internal.server_error");
    expect(body.error.message).toBe("An internal server error occurred.");
    // Stack trace should not be leaked in error message or details
    expect(body.error.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Db connection timeout");
  });

  it("non-existent route returns 404 and unified error structure", async () => {
    const res = await harness.request("GET", "/test/non-existent-route-path");
    expect(res.status).toBe(404);

    const reqIdHeader = res.headers.get("X-Request-Id");
    const body = await res.json();

    expect(body.request_id).toBe(reqIdHeader);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("router.not_found");
    expect(body.error.message).toContain("Route not found");
  });
});
