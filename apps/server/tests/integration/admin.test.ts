import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { adminUser, user } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";
import { changePassword, seedSuperAdmin, getDummyHash } from "../../src/auth/service.js";
import { withStore } from "../../src/auth/store-scope.js";
import { generateTestToken } from "../helpers/jwt.js";
import {
  adminLoginResponseSchema,
  adminUserQueryResponseSchema,
} from "@yikey/shared";

describe("Admin Authentication & RBAC Integration Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  describe("8.2 Password & Argon2id Utility", () => {
    it("hashes password with Argon2id parameters and verifies correctly", async () => {
      const password = "MySecurePassword123!";
      const hash = await hashPassword(password);

      // Verify Argon2id format elements
      expect(hash).toContain("$argon2id$");
      expect(hash).toContain("m=1024");
      expect(hash).toContain("t=1");
      expect(hash).toContain("p=1");

      // Verify correctness
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword("wrong_password", hash)).toBe(false);
    });

    it("fails db insert if super_admin has a storeId or store roles lack a storeId", async () => {
      // 1. super_admin with a storeId
      await expect(
        harness.db.insert(adminUser).values({
          phone: "18800001000",
          passwordHash: "dummy_hash",
          role: "super_admin",
          storeId: "store_123",
          name: "Invalid Super Admin",
          status: "active",
        })
      ).rejects.toThrow();

      // 2. store_owner without a storeId
      await expect(
        harness.db.insert(adminUser).values({
          phone: "18800001001",
          passwordHash: "dummy_hash",
          role: "store_owner",
          storeId: null,
          name: "Invalid Store Owner",
          status: "active",
        })
      ).rejects.toThrow();
    });

    it("verifies and changes password, rejecting invalid old passwords", async () => {
      const now = new Date("2026-05-28T12:00:00Z");
      // Seed user
      const inserted = await harness.db
        .insert(adminUser)
        .values({
          phone: "18800000001",
          passwordHash: await hashPassword("old_pass_123"),
          role: "super_admin",
          name: "Test Admin",
          status: "active",
        })
        .returning();

      const adminId = inserted[0].id;

      // Fail to change with wrong old password
      await expect(
        changePassword(harness.db, adminId, "wrong_old", "new_pass_456", now)
      ).rejects.toThrowError("Invalid old password");

      // Change successfully with correct old password
      await changePassword(harness.db, adminId, "old_pass_123", "new_pass_456", now);

      // Verify DB contains new hash and matches new password
      const updated = await harness.db
        .select()
        .from(adminUser)
        .where(eq(adminUser.id, adminId));

      expect(await verifyPassword("new_pass_456", updated[0].passwordHash)).toBe(true);
      expect(await verifyPassword("old_pass_123", updated[0].passwordHash)).toBe(false);
    });
  });

  describe("8.1 & 8.5 & 8.7 Admin Login & Seeding", () => {
    it("seeds super_admin, does not overwrite existing password on subsequent seeds, and corrects invalid roles", async () => {
      // 1. First seed
      await seedSuperAdmin(harness.db, "18888888888", "SuperSecret123!", "Primary Admin");

      // 2. Try duplicate seeding with new password (should preserve the old password)
      await seedSuperAdmin(harness.db, "18888888888", "UpdatedSecret456!", "Updated Admin");

      // 3. Attempt login via POST with the original password
      const res = await harness.request("POST", "/admin/auth/login", {
        body: {
          phone: "18888888888",
          password: "SuperSecret123!",
        },
      });

      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.data.token).toBeDefined();
      expect(resBody.data.role).toBe("super_admin");
      expect(resBody.data.store_id).toBeUndefined();

      // Contract check
      const parseResult = adminLoginResponseSchema.safeParse(resBody.data);
      expect(parseResult.success).toBe(true);

      // 4. Test that seeding on a conflict account with invalid configuration fails loud
      // Create a store staff
      await harness.db.insert(adminUser).values({
        phone: "18800002222",
        passwordHash: await hashPassword("staff_pass"),
        role: "store_staff",
        storeId: "store_abc",
        name: "Staff",
        status: "active",
      });

      // Seeding with that phone should reject
      await expect(
        seedSuperAdmin(harness.db, "18800002222", "some_seed_pass", "Forced Super")
      ).rejects.toThrowError("Seeding failed");
    });

    it("rejects login with uniform failure and verifies dummy hashing successfully", async () => {
      const res = await harness.request("POST", "/admin/auth/login", {
        body: {
          phone: "19999999999", // doesn't exist
          password: "any_password",
        },
      });

      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.invalid_credentials");
      expect(resBody.error.message).toContain("Invalid phone number or password");

      // Verify that getDummyHash returns a valid hash that verifyPassword can parse
      const dummyHash = await getDummyHash();
      // Mismatched password returns false (proving no formatting exceptions occurred during verify)
      expect(await verifyPassword("any_password", dummyHash)).toBe(false);
      // Correct password returns true
      expect(await verifyPassword("__dummy_password__", dummyHash)).toBe(true);
    });

    it("denies login for suspended admin accounts", async () => {
      // Seed suspended user
      await harness.db
        .insert(adminUser)
        .values({
          phone: "18800000002",
          passwordHash: await hashPassword("suspended_pass"),
          role: "store_owner",
          storeId: "store_abc",
          name: "Suspended Owner",
          status: "frozen",
        });

      const res = await harness.request("POST", "/admin/auth/login", {
        body: {
          phone: "18800000002",
          password: "suspended_pass",
        },
      });

      expect(res.status).toBe(403);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.user_frozen");
    });
  });

  describe("8.3 requireRole Middleware Guard", () => {
    it("allows request when role matches list", async () => {
      // Sign token for store_owner
      const token = await generateTestToken(
        {
          id: "admin_owner_id",
          role: "store_owner",
          storeId: "store_123",
          typ: "admin",
        },
        jwtSecret
      );

      // Hit users/by-uid endpoint
      const res = await harness.request("GET", "/store-admin/users/by-uid?uid=EKY2026000001", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Should query and return 404 user.not_found because uid doesn't exist
      expect(res.status).toBe(404);
    });

    it("blocks request with 403 when role is not in allowed list", async () => {
      const weappToken = await generateTestToken(
        {
          id: "weapp_user_id",
          uid: "EKY2026000001",
          role: "user",
          typ: "weapp",
        },
        jwtSecret
      );

      const res = await harness.request("GET", "/store-admin/users/by-uid?uid=EKY2026000001", {
        headers: { Authorization: `Bearer ${weappToken}` },
      });

      expect(res.status).toBe(403);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.forbidden");
    });

    it("blocks request with 401 when not authenticated", async () => {
      const res = await harness.request("GET", "/store-admin/users/by-uid?uid=EKY2026000001");
      expect(res.status).toBe(401);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.unauthorized");
    });
  });

  describe("8.4 & 8.6 store-admin endpoints & withStore Data Isolation", () => {
    it("restricts store roles to their store scope via withStore", async () => {
      // Mock Hono context variables
      const ctxStore1 = {
        var: {
          user: {
            id: "owner_1",
            role: "store_owner",
            storeId: "store_1",
            typ: "admin",
          },
        },
      } as any;

      const ctxSuperAdmin = {
        var: {
          user: {
            id: "super_1",
            role: "super_admin",
            typ: "admin",
          },
        },
      } as any;

      // Table mock
      const table = { storeId: "store_id_col" };

      // Query mock
      const mockQuery = () => {
        let whereClause: any = null;
        return {
          config: {},
          where(condition: any) {
            whereClause = condition;
            return this;
          },
          getWhere() {
            return whereClause;
          },
        };
      };

      // Test withStore injection
      const q1 = mockQuery();
      withStore(ctxStore1, q1, table as any);
      expect(q1.getWhere()).toBeDefined();

      const q2 = mockQuery();
      withStore(ctxSuperAdmin, q2, table as any);
      expect(q2.getWhere()).toBeNull(); // super_admin gets no store filter
    });

    it("allows store admin to fetch user by UID, omitting sensitive columns (openid, id)", async () => {
      // 1. Create WeChat user in DB
      await harness.db
        .insert(user)
        .values({
          openid: "wechat_openid_abc",
          uid: "EKY2026777777",
          nickname: "WeChat Client",
          avatar: "https://avatar.url/wechat",
          phone: "13333333333",
          status: "active",
        });

      // 2. Sign token for store_owner
      const token = await generateTestToken(
        {
          id: "owner_id",
          role: "store_owner",
          storeId: "store_1",
          typ: "admin",
        },
        jwtSecret
      );

      // 3. Request
      const res = await harness.request("GET", "/store-admin/users/by-uid?uid=EKY2026777777", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const resBody = await res.json();
      const data = resBody.data;

      expect(data.uid).toBe("EKY2026777777");
      expect(data.nickname).toBe("WeChat Client");
      expect(data.phone).toBe("13333333333");
      expect(data.openid).toBeUndefined();
      expect(data.id).toBeUndefined();

      // Contract validation
      const parseResult = adminUserQueryResponseSchema.safeParse(data);
      expect(parseResult.success).toBe(true);
    });

    it("returns 404 when UID is not found", async () => {
      const token = await generateTestToken(
        {
          id: "owner_id",
          role: "store_owner",
          storeId: "store_1",
          typ: "admin",
        },
        jwtSecret
      );

      const res = await harness.request("GET", "/store-admin/users/by-uid?uid=EKY2026888888", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(404);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("user.not_found");
    });

    it("blocks store roles that lack a storeId with 403 via requireStoreScope", async () => {
      const token = await generateTestToken(
        {
          id: "owner_id",
          role: "store_owner",
          storeId: null, // missing storeId
          typ: "admin",
        },
        jwtSecret
      );

      const res = await harness.request("GET", "/store-admin/users/by-uid?uid=EKY2026888888", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.forbidden");
    });
  });
});
