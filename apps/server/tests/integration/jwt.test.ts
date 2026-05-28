import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { requireAuth } from "../../src/middleware/jwt.js";
import { generateTestToken } from "../helpers/jwt.js";
import { UserPayload } from "../../src/types.js";

describe("JWT / requireAuth Integration Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  const testUser: UserPayload = {
    id: "usr_12345",
    uid: "EKY2026040123",
    role: "super_admin",
    storeId: "store_abc",
  };

  it("public endpoint: missing token defaults c.var.user to null", async () => {
    harness.app.get("/test-jwt/public", (c: any) => {
      return c.json({ user: c.var.user });
    });

    const res = await harness.request("GET", "/test-jwt/public");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user).toBeNull();
  });

  it("public endpoint: valid token populates c.var.user", async () => {
    harness.app.get("/test-jwt/public", (c: any) => {
      return c.json({ user: c.var.user });
    });

    const token = await generateTestToken(testUser, jwtSecret);
    const res = await harness.request("GET", "/test-jwt/public", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user).toEqual(testUser);
  });

  it("public endpoint: invalid signature sets c.var.user to null", async () => {
    harness.app.get("/test-jwt/public", (c: any) => {
      return c.json({ user: c.var.user });
    });

    // Sign with different key
    const token = await generateTestToken(testUser, "wrong-secret-key-that-does-not-match");
    const res = await harness.request("GET", "/test-jwt/public", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user).toBeNull();
  });

  it("protected endpoint: missing token returns 401 auth.unauthorized", async () => {
    harness.app.get("/test-jwt/protected", requireAuth, (c: any) => {
      return c.json({ user: c.var.user });
    });

    const res = await harness.request("GET", "/test-jwt/protected");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe("auth.unauthorized");
  });

  it("protected endpoint: invalid signature token returns 401 auth.unauthorized", async () => {
    harness.app.get("/test-jwt/protected", requireAuth, (c: any) => {
      return c.json({ user: c.var.user });
    });

    const token = await generateTestToken(testUser, "wrong-secret-key-that-does-not-match");
    const res = await harness.request("GET", "/test-jwt/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe("auth.unauthorized");
  });

  it("protected endpoint: valid token permits access and returns data", async () => {
    harness.app.get("/test-jwt/protected", requireAuth, (c: any) => {
      return c.json({ user: c.var.user });
    });

    const token = await generateTestToken(testUser, jwtSecret);
    const res = await harness.request("GET", "/test-jwt/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user).toEqual(testUser);
  });
});
