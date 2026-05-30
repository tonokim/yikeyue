import { describe, it, expect, beforeEach } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { generateNextUid, findUserByUid, findUserByUidInternal } from "../../src/user/uid.js";
import { findOrCreateUser } from "../../src/user/service.js";
import { uidSequence, user } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { generateTestToken } from "../helpers/jwt.js";
import { initWeChatService } from "../../src/wechat/index.js";
import {
  UID_REGEXP,
  uidValidationSchema,
  userProfileSchema,
  meResponseSchema
} from "@yikey/shared";

describe("User & Profile Integration Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  beforeEach(async () => {
    // Clean up Redis keys used by WeChat access token manager to ensure isolation
    await harness.redis.del("wechat:access_token");
    await harness.redis.del("wechat:access_token:lock");

    // Initialize WeChatService with a custom mock fetch
    const mockHttpClient = async (input: any, _init?: RequestInit): Promise<Response> => {
      const url = new URL(input.toString());
      const path = url.pathname;
      if (path === "/sns/jscode2session") {
        const code = url.searchParams.get("js_code");
        if (code === "invalid_code") {
          return new Response(
            JSON.stringify({ errcode: 40029, errmsg: "invalid code" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        // Dynamic openid from code
        return new Response(
          JSON.stringify({
            openid: `openid_${code}`,
            session_key: `session_key_${code}`,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    };

    initWeChatService(harness.redis, {
      apiBaseUrl: "https://api.weixin.qq.com",
      payBaseUrl: "https://api.mch.weixin.qq.com",
      httpClient: mockHttpClient,
    });
  });

  describe("6.1 & 6.9 UID Generation and Validation", () => {
    it("generates UID with correct prefix, year, and at least 6 digits zero-padded", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const now = new Date("2026-05-28T12:00:00Z");
      const uid1 = await generateNextUid(harness.db, now);
      expect(uid1).toBe("EKY2026000001");

      const uid2 = await generateNextUid(harness.db, now);
      expect(uid2).toBe("EKY2026000002");
    });

    it("resets sequence back to 1 when year changes", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // Use mid-year dates to avoid timezone conversion crossing year boundaries
      const now2026 = new Date("2026-06-01T12:00:00Z");
      const uid2026 = await generateNextUid(harness.db, now2026);
      expect(uid2026).toBe("EKY2026000001");

      const now2027 = new Date("2027-06-01T12:00:00Z");
      const uid2027 = await generateNextUid(harness.db, now2027);
      expect(uid2027).toBe("EKY2027000001");
    });

    it("generates unique sequential UIDs", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const now = new Date("2026-05-28T12:00:00Z");

      const uids: string[] = [];
      for (let i = 0; i < 5; i++) {
        uids.push(await generateNextUid(harness.db, now));
      }

      // Verify all generated UIDs are unique and sequential
      const uniqueUids = new Set(uids);
      expect(uniqueUids.size).toBe(5);
      expect(uids[0]).toBe("EKY2026000001");
      expect(uids[4]).toBe("EKY2026000005");
    });

    it("naturally scales sequence beyond 6 digits without truncating or reusing (overflow safety)", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const now = new Date("2026-05-28T12:00:00Z");

      // Seed the year 2026 in sequence table to be just below 1000000
      await harness.db
        .insert(uidSequence)
        .values({ year: 2026, lastSeq: 999999 })
        .onConflictDoUpdate({
          target: uidSequence.year,
          set: { lastSeq: 999999 },
        });

      // Next sequence should be 1000000 (7 digits sequence)
      const uidOverflow = await generateNextUid(harness.db, now);
      expect(uidOverflow).toBe("EKY20261000000"); // 14 characters total
      expect(uidOverflow.length).toBe(14);

      const uidOverflow2 = await generateNextUid(harness.db, now);
      expect(uidOverflow2).toBe("EKY20261000001");
    });

    it("validates UID schema regex against 13-char and 14-char UIDs", () => {
      // 13-character UID (6-digit seq)
      expect(UID_REGEXP.test("EKY2026000001")).toBe(true);
      expect(uidValidationSchema.safeParse("EKY2026000001").success).toBe(true);

      // 14-character UID (7-digit seq)
      expect(UID_REGEXP.test("EKY20261000000")).toBe(true);
      expect(uidValidationSchema.safeParse("EKY20261000000").success).toBe(true);

      // Invalid formats
      expect(UID_REGEXP.test("EKY202600000")).toBe(false); // only 5 digits seq
      expect(UID_REGEXP.test("EKY20205")).toBe(false);
      expect(UID_REGEXP.test("EKX2026000001")).toBe(false); // wrong prefix
      expect(UID_REGEXP.test("EKY202600000a")).toBe(false); // letter in seq
    });
  });

  describe("6.2 findUserByUid Service", () => {
    it("returns profile details and strictly omits openid when found", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // Create user directly
      const inserted = await harness.db
        .insert(user)
        .values({
          openid: "openid_find_test",
          uid: "EKY2026999999",
          nickname: "Find Me",
          avatar: "https://avatar.url/find",
          phone: "123456",
          city: "Shanghai",
          status: "active",
        })
        .returning();

      const found = await findUserByUid(harness.db, "EKY2026999999");
      expect(found).toBeDefined();
      expect(found.id).toBe(inserted[0].id);
      expect(found.uid).toBe("EKY2026999999");
      expect(found.nickname).toBe("Find Me");
      expect(found.avatar).toBe("https://avatar.url/find");
      expect(found.phone).toBe("123456");
      expect(found.city).toBe("Shanghai");
      expect(found.status).toBe("active");

      // Assert openid is omitted
      expect((found as any).openid).toBeUndefined();
    });

    it("throws a 404 BizError when user is not found", async () => {
      await expect(findUserByUid(harness.db, "EKY2026000404")).rejects.toThrowError(
        "User with UID 'EKY2026000404' not found"
      );
    });
  });

  describe("findUserByUidInternal Service", () => {
    it("returns profile details and includes openid when found", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // Create user directly
      const inserted = await harness.db
        .insert(user)
        .values({
          openid: "openid_internal_test",
          uid: "EKY2026888888",
          nickname: "Internal User",
          avatar: "https://avatar.url/internal",
          phone: "654321",
          city: "Beijing",
          status: "active",
        })
        .returning();

      const found = await findUserByUidInternal(harness.db, "EKY2026888888");
      expect(found).toBeDefined();
      expect(found.id).toBe(inserted[0].id);
      expect(found.openid).toBe("openid_internal_test");
      expect(found.uid).toBe("EKY2026888888");
      expect(found.nickname).toBe("Internal User");

      // Assert openid is NOT omitted
      expect(found.openid).toBe("openid_internal_test");
    });

    it("throws a 404 BizError when user is not found", async () => {
      await expect(findUserByUidInternal(harness.db, "EKY2026000404")).rejects.toThrowError(
        "User with UID 'EKY2026000404' not found"
      );
    });
  });

  describe("6.3 & 6.4 & 6.5 & 6.8 POST /weapp/auth/login", () => {
    it("registers and creates a new active user for a new valid WeChat code", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const res = await harness.request("POST", "/weapp/auth/login", {
        body: { code: "new_user_code" },
      });
      expect(res.status).toBe(200);

      const resBody = await res.json();
      expect(resBody.request_id).toBeDefined();

      // Contract checks on the response data (transforms to snake_case)
      const data = resBody.data;
      expect(data.access_token).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.user.uid).toMatch(UID_REGEXP);
      expect(data.user.nickname).toBeNull();
      expect(data.user.status).toBe("active");

      // Make sure neither internal ID nor openid are present in standard response
      expect(data.user.id).toBeUndefined();
      expect(data.user.openid).toBeUndefined();

      // Zod validation verification (validating user structure and access token presence)
      const parseUser = userProfileSchema.safeParse(data.user);
      expect(parseUser.success).toBe(true);
      expect(typeof data.access_token).toBe("string");

      // Verify stored in DB
      const dbUsers = await harness.db
        .select()
        .from(user)
        .where(eq(user.openid, "openid_new_user_code"));
      expect(dbUsers.length).toBe(1);
      expect(dbUsers[0].uid).toBe(data.user.uid);
    });

    it("returns an existing user profile and does not recreate user if already registered", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // Pre-insert user
      await harness.db
        .insert(user)
        .values({
          openid: "openid_old_user",
          uid: "EKY2026888888",
          nickname: "Old User",
          avatar: "https://avatar.url/old",
          status: "active",
        });

      const res = await harness.request("POST", "/weapp/auth/login", {
        body: { code: "old_user" },
      });
      expect(res.status).toBe(200);

      const resBody = await res.json();
      const data = resBody.data;
      expect(data.user.uid).toBe("EKY2026888888");
      expect(data.user.nickname).toBe("Old User");
      expect(data.user.avatar).toBe("https://avatar.url/old");

      // Verify only 1 exists
      const dbUsers = await harness.db
        .select()
        .from(user)
        .where(eq(user.openid, "openid_old_user"));
      expect(dbUsers.length).toBe(1);
    });

    it("fails with 400 when WeChat code is invalid or missing", async () => {
      // 1. Missing body/invalid validation
      const resVal = await harness.request("POST", "/weapp/auth/login", {
        body: {},
      });
      expect(resVal.status).toBe(400);
      const valBody = await resVal.json();
      expect(valBody.error.code).toBe("validation.invalid_input");

      // 2. Invalid code returned by WeChat code2Session mock
      const resWechat = await harness.request("POST", "/weapp/auth/login", {
        body: { code: "invalid_code" },
      });
      expect(resWechat.status).toBe(400);
      const wechatBody = await resWechat.json();
      expect(wechatBody.error.code).toBe("auth.invalid_code");
    });

    it("fails with 403 when trying to login a frozen user", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // Pre-insert frozen user
      await harness.db
        .insert(user)
        .values({
          openid: "openid_frozen_user",
          uid: "EKY2026777777",
          nickname: "Frozen User",
          status: "frozen",
        });

      const res = await harness.request("POST", "/weapp/auth/login", {
        body: { code: "frozen_user" },
      });
      expect(res.status).toBe(403);
      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.user_frozen");
      expect(resBody.error.message).toContain("frozen");
    });

    it("handles concurrent first-time login requests gracefully via unique constraint retry (simulated race condition)", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const openid = "openid_retry_test";
      const now = new Date("2026-05-28T12:00:00Z");

      // 1. Pre-insert the user so they exist in the DB (simulating that another thread succeeded in inserting them)
      const dbUser = await harness.db
        .insert(user)
        .values({
          openid,
          uid: "EKY2026111111",
          status: "active",
        })
        .returning();

      // 2. Mock DB client:
      // - select query: behaves normally (so we can find the user on retry)
      // - insert query: throws a 23505 unique violation error only for "user" table (simulating the concurrent insert collision)
      // - transaction: wraps execution in a callback
      const mockDb = {
        select: () => harness.db.select(),
        transaction: (cb: any) => cb(mockDb),
        insert: (table: any) => {
          if (table === user) {
            return {
              values: () => ({
                returning: () => {
                  const err = new Error("duplicate key value violates unique constraint");
                  (err as any).code = "23505";
                  throw err;
                }
              })
            };
          }
          return harness.db.insert(table);
        },
      } as any;

      // 3. Call findOrCreateUser, which will try to insert user, catch 23505, and select the existing user
      const result = await findOrCreateUser(mockDb, openid, now);
      expect(result).toBeDefined();
      expect(result.id).toBe(dbUser[0].id);
      expect(result.uid).toBe("EKY2026111111");
    });

    it("does not skip UID sequence numbers when concurrent logins for the same openid conflict", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const now = new Date("2026-05-28T12:00:00Z");

      // 1. Create first user normally. This consumes sequence #1 ("EKY2026000001")
      const user1 = await findOrCreateUser(harness.db, "openid_concurrent_test_1", now);
      expect(user1.uid).toBe("EKY2026000001");

      // 2. Mock DB client to simulate a concurrent request for "openid_concurrent_test_1"
      // the first select returns empty (simulating that the transaction started before it knew user1 existed)
      // but the real insert will fail because the user already exists.
      let selectCallCount = 0;
      const mockDb = {
        ...harness.db,
        select: (...args: any[]) => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return {
              from: () => ({
                where: () => ({
                  limit: () => Promise.resolve([])
                })
              })
            };
          }
          return (harness.db.select as any)(...args);
        },
        transaction: (cb: any) => harness.db.transaction((tx) => cb(tx)),
      } as any;

      // 3. Call findOrCreateUser with mockDb. It will try to insert, roll back, and return user1
      const resolvedUser = await findOrCreateUser(mockDb, "openid_concurrent_test_1", now);
      expect(resolvedUser.uid).toBe("EKY2026000001");

      // 4. Now create a new user with a different openid.
      // If the rollback worked, this user should get sequence #2 ("EKY2026000002"), NOT "EKY2026000003"
      const user2 = await findOrCreateUser(harness.db, "openid_concurrent_test_2", now);
      expect(user2.uid).toBe("EKY2026000002");
    });
  });

  describe("6.6 & 6.8 GET /weapp/me", () => {
    it("returns user profile details omitting user.id and openid when authenticated", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // Pre-insert user
      const dbUser = await harness.db
        .insert(user)
        .values({
          openid: "openid_me_test",
          uid: "EKY2026111111",
          nickname: "Me User",
          avatar: "https://avatar.url/me",
          city: "Beijing",
          status: "active",
        })
        .returning();

      // Sign JWT with helper
      const token = await generateTestToken(
        {
          id: dbUser[0].id,
          uid: dbUser[0].uid,
          role: "user",
        },
        jwtSecret
      );

      const res = await harness.request("GET", "/weapp/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const resBody = await res.json();
      const data = resBody.data;

      // Schema verification
      expect(data.uid).toBe("EKY2026111111");
      expect(data.nickname).toBe("Me User");
      expect(data.avatar).toBe("https://avatar.url/me");
      expect(data.city).toBe("Beijing");
      expect(data.status).toBe("active");

      // Verify no internal IDs or openid are present
      expect(data.id).toBeUndefined();
      expect(data.openid).toBeUndefined();

      const parse = meResponseSchema.safeParse(data);
      expect(parse.success).toBe(true);
    });

    it("returns 401 when not authenticated", async () => {
      const res = await harness.request("GET", "/weapp/me");
      expect(res.status).toBe(401);

      const resBody = await res.json();
      expect(resBody.error.code).toBe("auth.unauthorized");
    });

    it("successfully accesses /weapp/me using the access token returned from /weapp/auth/login (e2e integration verification)", async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      // 1. Perform login to create the user and sign a real token using the app's secret
      const loginRes = await harness.request("POST", "/weapp/auth/login", {
        body: { code: "login_flow_code" },
      });
      expect(loginRes.status).toBe(200);

      const loginBody = await loginRes.json();
      const token = loginBody.data.access_token;
      expect(token).toBeDefined();

      // 2. Directly request /weapp/me using the returned access token
      const meRes = await harness.request("GET", "/weapp/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(meRes.status).toBe(200);

      const meBody = await meRes.json();
      expect(meBody.data.uid).toBe(loginBody.data.user.uid);
      expect(meBody.data.status).toBe("active");
    });
  });

  describe("6.7 Profile Editing", () => {
    let testUserToken: string;
    let dbUserId: string;

    beforeEach(async () => {
      // Clean table first
      await harness.db.delete(user);
      await harness.db.delete(uidSequence);

      const dbUser = await harness.db
        .insert(user)
        .values({
          openid: "openid_profile_edit",
          uid: "EKY2026222222",
          nickname: "Original Name",
          avatar: "https://avatar.url/original",
          status: "active",
        })
        .returning();

      dbUserId = dbUser[0].id;
      testUserToken = await generateTestToken(
        {
          id: dbUserId,
          uid: dbUser[0].uid,
          role: "user",
        },
        jwtSecret
      );
    });

    it("allows editing nickname and/or avatar and returns updated profile", async () => {
      // Test POST /weapp/me
      const res1 = await harness.request("POST", "/weapp/me", {
        body: {
          nickname: "New Name",
          avatar: "https://avatar.url/new",
        },
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      expect(res1.status).toBe(200);

      const resBody1 = await res1.json();
      expect(resBody1.data.nickname).toBe("New Name");
      expect(resBody1.data.avatar).toBe("https://avatar.url/new");

      // Test POST /weapp/me/profile
      const res2 = await harness.request("POST", "/weapp/me/profile", {
        body: {
          nickname: "New Name 2",
        },
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      expect(res2.status).toBe(200);

      const resBody2 = await res2.json();
      expect(resBody2.data.nickname).toBe("New Name 2");
      expect(resBody2.data.avatar).toBe("https://avatar.url/new"); // unchanged

      // Test PUT /weapp/me
      const res3 = await harness.request("PUT", "/weapp/me", {
        body: {
          avatar: "https://avatar.url/new3",
        },
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      expect(res3.status).toBe(200);

      const resBody3 = await res3.json();
      expect(resBody3.data.nickname).toBe("New Name 2"); // unchanged
      expect(resBody3.data.avatar).toBe("https://avatar.url/new3");
    });

    it("filters out disallowed fields (like uid, status) from update data", async () => {
      const res = await harness.request("POST", "/weapp/me", {
        body: {
          nickname: "Attempt Hack",
          uid: "EKY2026999999",
          status: "frozen",
          openid: "hacked_openid",
          id: "hacked_id",
        },
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      expect(res.status).toBe(200);

      // Verify the response is updated nickname but ignored disallowed fields
      const resBody = await res.json();
      expect(resBody.data.nickname).toBe("Attempt Hack");
      expect(resBody.data.uid).toBe("EKY2026222222"); // unchanged
      expect(resBody.data.status).toBe("active"); // unchanged

      // Verify DB directly
      const dbUsers = await harness.db
        .select()
        .from(user)
        .where(eq(user.id, dbUserId));
      expect(dbUsers[0].nickname).toBe("Attempt Hack");
      expect(dbUsers[0].uid).toBe("EKY2026222222");
      expect(dbUsers[0].status).toBe("active");
      expect(dbUsers[0].openid).toBe("openid_profile_edit");
      expect(dbUsers[0].id).toBe(dbUserId);
    });

    it("validates request body via updateProfileRequestSchema", async () => {
      // 1. empty nickname
      const res1 = await harness.request("POST", "/weapp/me", {
        body: { nickname: "" },
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      expect(res1.status).toBe(400);
      const resBody1 = await res1.json();
      expect(resBody1.error.code).toBe("validation.invalid_input");

      // 2. invalid avatar URL format
      const res2 = await harness.request("POST", "/weapp/me", {
        body: { avatar: "not_a_valid_url" },
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      expect(res2.status).toBe(400);
      const resBody2 = await res2.json();
      expect(resBody2.error.code).toBe("validation.invalid_input");
    });
  });
});
