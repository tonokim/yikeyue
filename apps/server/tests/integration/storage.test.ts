import { describe, it, expect, beforeEach } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { generateUploadToken } from "../../src/storage/token.js";
import { generateStorageKey } from "../../src/storage/key.js";
import { getPublicUrl, privateDownloadUrl } from "../../src/storage/url.js";
import { confirmUpload } from "../../src/storage/upload-intent.js";
import { cleanupOrphanUploads } from "../../src/storage/cleanup.js";
import { FakeQiniuClient } from "../helpers/qiniu-mock.js";
import { setQiniuClient } from "../../src/storage/client.js";
import { upload } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { generateTestToken } from "../helpers/jwt.js";
import { UserPayload } from "../../src/types.js";
import { getUploadPolicy } from "../../src/storage/policy.js";

describe("Storage Capability Integration & Unit Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  const testUser: UserPayload = {
    id: "usr_12345",
    uid: "EKY2026040123",
    role: "super_admin",
    storeId: "store_abc",
  };

  let fakeQiniuClient: FakeQiniuClient;

  beforeEach(() => {
    fakeQiniuClient = new FakeQiniuClient();
    setQiniuClient(fakeQiniuClient);
  });

  // 9.1 token 签发单测
  describe("9.1 Upload Token Generation Unit Tests", () => {
    it("generates a valid scoped upload token with correct parameters", () => {
      const token = generateUploadToken({
        bucket: "yikey-public",
        key: "demo/temp/202605/file.png",
        expiresInSeconds: 120,
        fsizeLimit: 1024 * 1024,
        mimeLimit: ["image/png", "image/jpeg"],
      });

      expect(token).toBeDefined();
      const parts = token.split(":");
      expect(parts.length).toBe(3);

      const encodedPolicy = parts[2];
      const policyStr = Buffer.from(encodedPolicy, "base64").toString("utf-8");
      const policy = JSON.parse(policyStr);

      expect(policy.scope).toBe("yikey-public:demo/temp/202605/file.png");
      expect(policy.fsizeLimit).toBe(1024 * 1024);
      expect(policy.mimeLimit).toBe("image/png;image/jpeg");
      // Deadline is set to now + expiresInSeconds
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(policy.deadline).toBeGreaterThanOrEqual(nowSeconds + 115);
      expect(policy.deadline).toBeLessThanOrEqual(nowSeconds + 125);
    });

    it("throws an error if expiration time exceeds 5 minutes (300 seconds)", () => {
      expect(() => {
        generateUploadToken({
          bucket: "yikey-public",
          key: "demo/temp/202605/file.png",
          expiresInSeconds: 301,
        });
      }).toThrow("Upload token deadline cannot exceed 5 minutes (300 seconds)");
    });
  });

  // 9.2 key 命名单测
  describe("9.2 Key Naming Unit Tests", () => {
    it("generates key in the format: <capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>", () => {
      const capability = "demo";
      const entityId = "entity_789";
      const ext = "jpg";

      const key = generateStorageKey(capability, entityId, ext);

      // Pattern check: demo/entity_789/YYYYMM/<cuid2>.jpg
      const parts = key.split("/");
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe(capability);
      expect(parts[1]).toBe(entityId);

      const yyyymmPattern = /^\d{6}$/;
      expect(yyyymmPattern.test(parts[2])).toBe(true);

      const fileParts = parts[3].split(".");
      expect(fileParts.length).toBe(2);
      expect(fileParts[1]).toBe(ext);
      expect(fileParts[0].length).toBeGreaterThan(10); // cuid2 format check
    });

    it("uses 'temp' as entity_id if not specified or empty", () => {
      const key1 = generateStorageKey("demo", null, "png");
      expect(key1.split("/")[1]).toBe("temp");

      const key2 = generateStorageKey("demo", "   ", "png");
      expect(key2.split("/")[1]).toBe("temp");
    });

    it("removes leading dots from extension if provided", () => {
      const key = generateStorageKey("demo", "ent", ".png");
      expect(key.endsWith(".png")).toBe(true);
      expect(key.endsWith("..png")).toBe(false);
    });
  });

  // 9.3 URL 单测
  describe("9.3 Download URL Unit Tests", () => {
    it("generates correct public URL straight from the CDN domain", () => {
      const key = "demo/temp/202605/file.png";
      const url = getPublicUrl(key);
      // CDN Domain is set in config
      expect(url).toContain(key);
      expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
    });

    it("generates signed private URL containing deadline parameter and token signature", () => {
      const key = "demo/temp/202605/file.png";
      const expiresInSeconds = 200;
      const url = privateDownloadUrl(key, expiresInSeconds);

      expect(url).toContain(key);
      expect(url).toContain("?e=");
      expect(url).toContain("&token=");
      expect(url.startsWith("http://mock-private-cdn.yikeyue.com")).toBe(true);

      const urlObj = new URL(url);
      const eParam = parseInt(urlObj.searchParams.get("e") || "0", 10);
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(eParam).toBeGreaterThanOrEqual(nowSeconds + 195);
      expect(eParam).toBeLessThanOrEqual(nowSeconds + 205);
    });
  });

  // 9.4 /upload/token 集成测试
  describe("9.4 /upload/token API Integration Tests", () => {
    it("returns 401 if missing Authorization header", async () => {
      const res = await harness.request("POST", "/upload/token", {
        body: {
          capability: "demo",
          entityId: "123",
          mimeType: "image/png",
          ext: "png",
        },
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for unregistered capability", async () => {
      const token = await generateTestToken(testUser, jwtSecret);
      const res = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "unregistered_cap",
          entityId: "123",
          mimeType: "image/png",
          ext: "png",
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("storage.capability_not_registered");
    });

    it("returns 400 for disallowed MIME type", async () => {
      const token = await generateTestToken(testUser, jwtSecret);
      const res = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "123",
          mimeType: "image/webp", // in Zod allowlist, but not in demo policy
          ext: "webp",
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("storage.mime_type_not_allowed");
    });

    it("succeeds for valid request and inserts pending record", async () => {
      const token = await generateTestToken(testUser, jwtSecret);
      const res = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "entity_999",
          mimeType: "image/png",
          ext: "png",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.token).toBeDefined();
      expect(body.data.key).toBeDefined();
      expect(body.data.upload_host).toBeDefined();

      const createdKey = body.data.key;
      expect(createdKey).toContain("demo/entity_999/");

      // Check DB contains pending record
      const dbRecord = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, createdKey));

      expect(dbRecord.length).toBe(1);
      expect(dbRecord[0].status).toBe("pending");
      expect(dbRecord[0].capability).toBe("demo");
      expect(dbRecord[0].entityId).toBe("entity_999");
    });

    it("rejects entityId containing invalid characters like slash", async () => {
      const token = await generateTestToken(testUser, jwtSecret);
      const res = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "a/b",
          mimeType: "image/png",
          ext: "png",
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("validation.invalid_input");
    });

    it("rejects ext containing invalid format or disallowed values", async () => {
      const token = await generateTestToken(testUser, jwtSecret);
      const res1 = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "ent",
          mimeType: "image/png",
          ext: "png/evil",
        },
      });
      expect(res1.status).toBe(400);

      const res2 = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "ent",
          mimeType: "image/png",
          ext: "pdf",
        },
      });
      expect(res2.status).toBe(400);
    });

    it("accepts uppercase ext and transforms it to lowercase", async () => {
      const token = await generateTestToken(testUser, jwtSecret);
      const res = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "ent",
          mimeType: "image/png",
          ext: "PNG",
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.key.endsWith(".png")).toBe(true);
    });
  });

  // 9.5 confirmUpload 集成测试
  describe("9.5 confirmUpload Integration Tests", () => {
    it("confirms an upload successfully and backfills entity ID if provided", async () => {
      const key = "demo/temp/202605/to-confirm.png";

      // Insert initial pending record
      await harness.db.insert(upload).values({
        status: "pending",
        key,
        capability: "demo",
        entityId: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await confirmUpload(harness.db, key, "backfilled_id");

      // Verify status is confirmed in DB
      const dbRecord = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, key));

      expect(dbRecord.length).toBe(1);
      expect(dbRecord[0].status).toBe("confirmed");
      expect(dbRecord[0].entityId).toBe("backfilled_id");
    });

    it("throws BizError when trying to confirm a non-existent key", async () => {
      await expect(
        confirmUpload(harness.db, "demo/temp/202605/non-existent.png", "ent")
      ).rejects.toThrow("Upload intent not found or already confirmed");
    });

    it("throws BizError when trying to confirm an already confirmed key", async () => {
      const key = "demo/temp/202605/already-confirmed.png";
      await harness.db.insert(upload).values({
        status: "confirmed",
        key,
        capability: "demo",
        entityId: "ent",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await expect(
        confirmUpload(harness.db, key, "ent")
      ).rejects.toThrow("Upload intent not found or already confirmed");
    });
  });

  // 9.6 孤儿清理集成测试
  describe("9.6 Storage Orphan Cleanup Integration Tests", () => {
    it("cleans up expired pending records and deletes their files, leaving confirmed and non-expired records untouched", async () => {
      const now = new Date("2026-05-28T12:00:00Z");
      harness.setClock(now);

      const expiredPendingKey = "demo/temp/202605/expired-pending.png";
      const activePendingKey = "demo/temp/202605/active-pending.png";
      const expiredConfirmedKey = "demo/temp/202605/expired-confirmed.png";

      const demoPolicy = getUploadPolicy("demo");

      // Seed mock client files
      fakeQiniuClient.addFile(demoPolicy.bucket, expiredPendingKey, { fsize: 1000, mimeType: "image/png" });
      fakeQiniuClient.addFile(demoPolicy.bucket, activePendingKey, { fsize: 1000, mimeType: "image/png" });
      fakeQiniuClient.addFile(demoPolicy.bucket, expiredConfirmedKey, { fsize: 1000, mimeType: "image/png" });

      // Insert test records into DB
      // 1. Expired pending: expiresAt is 1 hour in the past
      await harness.db.insert(upload).values({
        status: "pending",
        key: expiredPendingKey,
        capability: "demo",
        expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
      });

      // 2. Active pending: expiresAt is 1 hour in the future
      await harness.db.insert(upload).values({
        status: "pending",
        key: activePendingKey,
        capability: "demo",
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      });

      // 3. Expired confirmed: expiresAt is 1 hour in the past, but status is confirmed
      await harness.db.insert(upload).values({
        status: "confirmed",
        key: expiredConfirmedKey,
        capability: "demo",
        expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
      });

      // Run cleanup
      await cleanupOrphanUploads(harness.db, fakeQiniuClient, now);

      // Assert expired pending is deleted from DB and Qiniu
      const expiredPendingRecord = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, expiredPendingKey));
      expect(expiredPendingRecord.length).toBe(0);
      expect(fakeQiniuClient.files.has(`${demoPolicy.bucket}:${expiredPendingKey}`)).toBe(false);
      expect(fakeQiniuClient.deletedKeys).toContain(`${demoPolicy.bucket}:${expiredPendingKey}`);

      // Assert active pending is NOT deleted
      const activePendingRecord = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, activePendingKey));
      expect(activePendingRecord.length).toBe(1);
      expect(fakeQiniuClient.files.has(`${demoPolicy.bucket}:${activePendingKey}`)).toBe(true);

      // Assert expired confirmed is NOT deleted
      const expiredConfirmedRecord = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, expiredConfirmedKey));
      expect(expiredConfirmedRecord.length).toBe(1);
      expect(fakeQiniuClient.files.has(`${demoPolicy.bucket}:${expiredConfirmedKey}`)).toBe(true);
    });
  });

  // 9.7 demo 策略闭环测试
  describe("9.7 Demo Policy Upload E2E Closed Loop Tests", () => {
    it("flows through token request, simulated direct upload, and confirmUpload", async () => {
      const token = await generateTestToken(testUser, jwtSecret);

      // Step 1: Request token
      const res = await harness.request("POST", "/upload/token", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          capability: "demo",
          entityId: "user_456",
          mimeType: "image/jpeg",
          ext: "jpg",
        },
      });
      expect(res.status).toBe(200);
      const { key } = (await res.json()).data;

      // Verify pending in DB
      const recordPending = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, key));
      expect(recordPending.length).toBe(1);
      expect(recordPending[0].status).toBe("pending");

      // Step 2: Simulate file upload completion to Qiniu
      const demoPolicy = getUploadPolicy("demo");
      fakeQiniuClient.addFile(demoPolicy.bucket, key, { fsize: 500 * 1024, mimeType: "image/jpeg" });

      // Step 3: Confirm upload
      await confirmUpload(harness.db, key, "user_456");

      // Verify confirmed in DB
      const recordConfirmed = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, key));
      expect(recordConfirmed.length).toBe(1);
      expect(recordConfirmed[0].status).toBe("confirmed");
      expect(recordConfirmed[0].entityId).toBe("user_456");
    });
  });
});
