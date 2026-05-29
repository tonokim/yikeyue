import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { store, storeCategory, upload } from "../../src/db/schema.js";
import { eq, and } from "drizzle-orm";
import { generateTestToken } from "../helpers/jwt.js";
import { z } from "zod";

// Local API-level response schemas to validate actual returned JSON contract (snake_case format)
const categoryApiResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const storeApiResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  phone: z.string(),
  photos: z.array(z.string()),
  open_at: z.string(),
  close_at: z.string(),
  status: z.string(),
  area: z.number().optional(),
  seat_count: z.number().optional(),
  description: z.string().optional(),
  granularity_min: z.number(),
  max_advance_days: z.number(),
  min_advance_min: z.number(),
  cancel_deadline_min: z.number(),
  no_show_threshold: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ).optional(),
});

describe("Store & Category CRUD Integration Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  const getSuperAdminToken = () =>
    generateTestToken(
      {
        id: "super_admin_1",
        role: "super_admin",
        typ: "admin",
      },
      jwtSecret
    );

  const getStoreOwnerToken = (storeId: string) =>
    generateTestToken(
      {
        id: "store_owner_1",
        role: "store_owner",
        storeId,
        typ: "admin",
      },
      jwtSecret
    );

  const getWeappUserToken = () =>
    generateTestToken(
      {
        id: "user_1",
        uid: "EKY2026111111",
        role: "user",
        typ: "weapp",
      },
      jwtSecret
    );

  describe("8.1 服务分类测试 (Category CRUD & Permissions)", () => {
    it("allows super_admin to create, update, and list categories", async () => {
      const token = await getSuperAdminToken();

      // 1. Create category
      const createRes = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: "美发沙龙",
          sort_order: 10,
          enabled: true,
        },
      });

      expect(createRes.status).toBe(200);
      const createBody = await createRes.json();
      expect(createBody.data.name).toBe("美发沙龙");
      expect(createBody.data.sort_order).toBe(10);
      expect(createBody.data.enabled).toBe(true);
      expect(createBody.data.id).toBeDefined();

      // Contract check (assert that returned JSON format matches API schema)
      expect(categoryApiResponseSchema.safeParse(createBody.data).success).toBe(true);

      const catId = createBody.data.id;

      // 2. Update category
      const updateRes = await harness.request("PUT", `/admin/service-categories/${catId}`, {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: "高端美发沙龙",
          sort_order: 5,
          enabled: false,
        },
      });

      expect(updateRes.status).toBe(200);
      const updateBody = await updateRes.json();
      expect(updateBody.data.name).toBe("高端美发沙龙");
      expect(updateBody.data.sort_order).toBe(5);
      expect(updateBody.data.enabled).toBe(false);

      // 3. List categories as admin (includes disabled ones)
      const listRes = await harness.request("GET", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      const found = listBody.data.find((c: any) => c.id === catId);
      expect(found).toBeDefined();
      expect(found.name).toBe("高端美发沙龙");
    });

    it("rejects category creation with duplicate name", async () => {
      const token = await getSuperAdminToken();

      // Create first
      await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${token}` },
        body: { name: "美甲美睫" },
      });

      // Create second with duplicate name
      const res = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${token}` },
        body: { name: "美甲美睫" },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("store.category_name_exists");
    });

    it("blocks non-super_admin from managing categories", async () => {
      const ownerToken = await getStoreOwnerToken("store_abc");
      const userToken = await getWeappUserToken();

      // Store owner tries to create
      const res1 = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { name: "美容Spa" },
      });
      expect(res1.status).toBe(403);

      // WeChat user tries to create
      const res2 = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { name: "美容Spa" },
      });
      expect(res2.status).toBe(403);
    });

    it("public categories route only returns enabled categories", async () => {
      const token = await getSuperAdminToken();

      // Create one enabled and one disabled
      await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${token}` },
        body: { name: "分类A", enabled: true, sort_order: 1 },
      });
      await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${token}` },
        body: { name: "分类B", enabled: false, sort_order: 2 },
      });

      // Fetch public
      const res = await harness.request("GET", "/service-categories");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const names = body.data.map((c: any) => c.name);
      expect(names).toContain("分类A");
      expect(names).not.toContain("分类B");
    });
  });

  describe("8.2 & 8.3 & 8.5 Store Creation, Default Rules, and Reservation Rule Validation", () => {
    it("creates a store with default reservation rules and saves open_at/close_at as time fields", async () => {
      const adminToken = await getSuperAdminToken();

      const res = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "静安店",
          address: "南京西路 1000 号",
          phone: "021-12345678",
          open_at: "09:00:00",
          close_at: "21:30:00",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("静安店");
      expect(body.data.status).toBe("draft"); // Draft by default
      expect(body.data.open_at).toBe("09:00:00");
      expect(body.data.close_at).toBe("21:30:00");

      // Default reservation rules
      expect(body.data.granularity_min).toBe(30);
      expect(body.data.max_advance_days).toBe(7);
      expect(body.data.min_advance_min).toBe(30);
      expect(body.data.cancel_deadline_min).toBe(60);
      expect(body.data.no_show_threshold).toBe(3);

      // Contract checks
      expect(storeApiResponseSchema.safeParse(body.data).success).toBe(true);

      // Verify db storage representation of time (should be "09:00:00", "21:30:00")
      const dbStore = await harness.db
        .select()
        .from(store)
        .where(eq(store.id, body.data.id))
        .limit(1);

      expect(dbStore[0].openAt).toBe("09:00:00");
      expect(dbStore[0].closeAt).toBe("21:30:00");
    });

    it("rejects store creation with invalid granularity", async () => {
      const adminToken = await getSuperAdminToken();

      const res = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "静安店",
          address: "南京西路 1000 号",
          phone: "021-12345678",
          open_at: "09:00",
          close_at: "21:30",
          granularity_min: 45, // Invalid (only 15, 30, 60 allowed)
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("validation.invalid_input");
    });

    it("rejects store creation with invalid cancel_deadline_min (above 24 hours)", async () => {
      const adminToken = await getSuperAdminToken();

      const res = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "静安店",
          address: "南京西路 1000 号",
          phone: "021-12345678",
          open_at: "09:00",
          close_at: "21:30",
          cancel_deadline_min: 1441, // Invalid (max 1440 allowed)
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("validation.invalid_input");
    });
  });

  describe("8.3 Super Admin Store Operations, Status Transition, and Permissions", () => {
    it("allows super_admin to perform all store operations and status updates", async () => {
      const adminToken = await getSuperAdminToken();

      // 1. Create a store
      const createRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "徐汇店",
          address: "衡山路 200 号",
          phone: "021-87654321",
          open_at: "10:00:00",
          close_at: "22:00:00",
        },
      });
      const storeId = (await createRes.json()).data.id;

      // 2. Put update metadata
      const updateRes = await harness.request("PUT", `/admin/stores/${storeId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "徐汇旗舰店",
          area: 120,
        },
      });
      expect(updateRes.status).toBe(200);
      const updateBody = await updateRes.json();
      expect(updateBody.data.name).toBe("徐汇旗舰店");
      expect(updateBody.data.area).toBe(120);

      // 3. Put status change -> online
      const statusRes = await harness.request("PUT", `/admin/stores/${storeId}/status`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: "online" },
      });
      expect(statusRes.status).toBe(200);
      const statusBody = await statusRes.json();
      expect(statusBody.data.status).toBe("online");

      // 4. Get lists as admin filtering by status
      const listRes = await harness.request("GET", `/admin/stores?status=online`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.data.some((s: any) => s.id === storeId)).toBe(true);

      const listDraftRes = await harness.request("GET", `/admin/stores?status=draft`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listDraftRes.status).toBe(200);
      const listDraftBody = await listDraftRes.json();
      expect(listDraftBody.data.some((s: any) => s.id === storeId)).toBe(false);
    });

    it("blocks non-super_admin from calling admin store endpoints", async () => {
      const ownerToken = await getStoreOwnerToken("store_123");

      const res = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          name: "非法店",
          address: "南京路",
          phone: "110",
          open_at: "09:00",
          close_at: "18:00",
        },
      });

      expect(res.status).toBe(403);
    });
  });

  describe("8.4 Store Owner Self-management & Data Isolation", () => {
    it("allows store owner to view and edit only their own store, ignoring status modifications", async () => {
      const adminToken = await getSuperAdminToken();

      // Create a store first as admin
      const storeRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "普陀店",
          address: "长寿路 500 号",
          phone: "021-66668888",
          open_at: "09:00:00",
          close_at: "21:00:00",
        },
      });
      const storeObj = (await storeRes.json()).data;
      const storeId = storeObj.id;

      // Make owner token bound to this store
      const ownerToken = await getStoreOwnerToken(storeId);

      // 1. GET /store-admin/store (reads own store)
      const getOwnRes = await harness.request("GET", "/store-admin/store", {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      expect(getOwnRes.status).toBe(200);
      const getOwnBody = await getOwnRes.json();
      expect(getOwnBody.data.id).toBe(storeId);

      // 2. PUT /store-admin/store (edits own store, tries to change status -> should be rejected with 400)
      const updateOwnRes = await harness.request("PUT", "/store-admin/store", {
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          name: "普陀自营店",
          seat_count: 8,
          status: "online",
        },
      });
      expect(updateOwnRes.status).toBe(400);
      const errBody = await updateOwnRes.json();
      expect(errBody.error.code).toBe("validation.invalid_input");

      // Verify valid update works
      const updateValidRes = await harness.request("PUT", "/store-admin/store", {
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          name: "普陀自营店",
          seat_count: 8,
        },
      });
      expect(updateValidRes.status).toBe(200);
      const updatedBody = await updateValidRes.json();
      const updatedData = updatedBody.data;
      expect(updatedData.name).toBe("普陀自营店");
      expect(updatedData.seat_count).toBe(8);
      expect(updatedData.status).toBe("draft");

      // 3. Verify store owner gets blocked when trying to access admin endpoints for their store or other stores
      const adminEditRes = await harness.request("PUT", `/admin/stores/${storeId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { name: "越权修改" },
      });
      expect(adminEditRes.status).toBe(403);
    });

    it("blocks store_staff from viewing or editing the store details", async () => {
      const adminToken = await getSuperAdminToken();

      // Create store
      const storeRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "普陀店",
          address: "长寿路 500 号",
          phone: "021-66668888",
          open_at: "09:00:00",
          close_at: "21:00:00",
        },
      });
      const storeId = (await storeRes.json()).data.id;

      // Make staff token bound to this store
      const staffToken = await generateTestToken(
        {
          id: "store_staff_1",
          role: "store_staff",
          storeId,
          typ: "admin",
        },
        jwtSecret
      );

      // GET /store-admin/store -> should return 403
      const getRes = await harness.request("GET", "/store-admin/store", {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(getRes.status).toBe(403);

      // PUT /store-admin/store -> should return 403
      const putRes = await harness.request("PUT", "/store-admin/store", {
        headers: { Authorization: `Bearer ${staffToken}` },
        body: { name: "店员尝试修改" },
      });
      expect(putRes.status).toBe(403);
    });
  });

  describe("8.6 Photo Upload Intent & confirmUpload E2E Integration", () => {
    it("marks newly added photos as confirmed and ignores already confirmed ones", async () => {
      const adminToken = await getSuperAdminToken();

      const keyPending1 = "store/store_123/202605/img1.png";
      const keyPending2 = "store/store_123/202605/img2.png";

      // 1. Insert two pending upload records in DB
      await harness.db.insert(upload).values([
        {
          key: keyPending1,
          status: "pending",
          capability: "store",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        {
          key: keyPending2,
          status: "pending",
          capability: "store",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      ]);

      // 2. Create store with photos containing keyPending1
      const resStore1 = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "照片测试店",
          address: "五角场 1 号",
          phone: "13566667777",
          open_at: "09:00:00",
          close_at: "21:00:00",
          photos: [keyPending1],
        },
      });
      expect(resStore1.status).toBe(200);
      const store1Body = await resStore1.json();
      const storeId = store1Body.data.id;

      // Verify keyPending1 is now confirmed and bound to storeId
      const rec1 = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, keyPending1));
      expect(rec1[0].status).toBe("confirmed");
      expect(rec1[0].entityId).toBe(storeId);

      // Verify keyPending2 is still pending
      const rec2 = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, keyPending2));
      expect(rec2[0].status).toBe("pending");

      // 3. Update store to add keyPending2
      const resStore2 = await harness.request("PUT", `/admin/stores/${storeId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          photos: [keyPending1, keyPending2], // keyPending1 is old/already confirmed, keyPending2 is new
        },
      });
      expect(resStore2.status).toBe(200);

      // Verify keyPending2 is now confirmed and bound
      const rec2After = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, keyPending2));
      expect(rec2After[0].status).toBe("confirmed");
      expect(rec2After[0].entityId).toBe(storeId);

      // 4. Update store to remove keyPending1 (only keep keyPending2)
      const resStore3 = await harness.request("PUT", `/admin/stores/${storeId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          photos: [keyPending2], // keyPending1 is removed
        },
      });
      expect(resStore3.status).toBe(200);

      // Verify keyPending1 is now marked as pending, unbound (entityId: null), and expiresAt is in the past
      const rec1AfterRemove = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, keyPending1));
      expect(rec1AfterRemove[0].status).toBe("pending");
      expect(rec1AfterRemove[0].entityId).toBeNull();
      expect(new Date(rec1AfterRemove[0].expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("rejects store creation/update with 400 if a photo key capability is not 'store'", async () => {
      const adminToken = await getSuperAdminToken();
      const nonStoreKey = "profile/user_123/202605/avatar.png";

      // 1. Insert a pending upload record with a different capability (e.g. "profile")
      await harness.db.insert(upload).values({
        key: nonStoreKey,
        status: "pending",
        capability: "profile",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // 2. Try to create a store with the non-store capability key
      const resStore = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "越权照片店",
          address: "五角场",
          phone: "13566667777",
          open_at: "09:00:00",
          close_at: "21:00:00",
          photos: [nonStoreKey],
        },
      });
      expect(resStore.status).toBe(400);
      const resBody = await resStore.json();
      expect(resBody.error.code).toBe("validation.invalid_input");

      // Verify the store was NOT created in DB (transaction rolled back)
      const dbStores = await harness.db
        .select()
        .from(store)
        .where(eq(store.name, "越权照片店"));
      expect(dbStores.length).toBe(0);

      // Verify that the store creation rolled back, but the upload record remains pending (nested savepoint rolled back)
      const rec = await harness.db
        .select()
        .from(upload)
        .where(eq(upload.key, nonStoreKey));
      expect(rec.length).toBe(1);
      expect(rec[0].status).toBe("pending");
      expect(rec[0].entityId).toBeNull();
    });

    it("rejects store creation/update with 400 if a confirmed photo key is bound to another store", async () => {
      const adminToken = await getSuperAdminToken();
      const confirmedKey = "store/store_123/202605/img-confirmed.png";

      // 1. Insert a confirmed upload record bound to another entity
      await harness.db.insert(upload).values({
        key: confirmedKey,
        status: "confirmed",
        capability: "store",
        entityId: "other_store_id",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // 2. Try to create a new store with this confirmed key -> should fail with 400
      const resStore = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "越权照片店2",
          address: "五角场",
          phone: "13566667777",
          open_at: "09:00:00",
          close_at: "21:00:00",
          photos: [confirmedKey],
        },
      });
      expect(resStore.status).toBe(400);
      const resBody = await resStore.json();
      expect(resBody.error.code).toBe("validation.invalid_input");
    });
  });

  describe("8.7 Client-side (WeChat App) Visibility Rules & Filtering", () => {
    it("returns only online stores to user queries, and denies detail queries for non-online stores", async () => {
      const adminToken = await getSuperAdminToken();

      // 1. Create a draft store
      const storeDraftRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "草稿店",
          address: "地址1",
          phone: "021-11112222",
          open_at: "09:00:00",
          close_at: "21:00:00",
        },
      });
      const draftBody = await storeDraftRes.json();
      const draftId = draftBody.data.id;

      // 2. Create an online store
      const storeOnlineRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "上线店",
          address: "地址2",
          phone: "021-33334444",
          open_at: "09:00:00",
          close_at: "21:00:00",
        },
      });
      const onlineBody = await storeOnlineRes.json();
      const onlineId = onlineBody.data.id;
      await harness.request("PUT", `/admin/stores/${onlineId}/status`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: "online" },
      });

      // 3. User lists stores
      const listUserRes = await harness.request("GET", "/weapp/stores");
      expect(listUserRes.status).toBe(200);
      const listUserBody = await listUserRes.json();

      const ids = listUserBody.data.map((s: any) => s.id);
      expect(ids).toContain(onlineId);
      expect(ids).not.toContain(draftId);

      // 4. User queries online store detail
      const detailOnlineRes = await harness.request("GET", `/weapp/stores/${onlineId}`);
      expect(detailOnlineRes.status).toBe(200);
      const detailOnlineBody = await detailOnlineRes.json();
      expect(detailOnlineBody.data.id).toBe(onlineId);

      // 5. User queries draft store detail -> returns 404
      const detailDraftRes = await harness.request("GET", `/weapp/stores/${draftId}`);
      expect(detailDraftRes.status).toBe(404);
    });

    it("filters online stores by category_id on client-side", async () => {
      const adminToken = await getSuperAdminToken();

      // 1. Create a category
      const catRes = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: "分类TestFilter", enabled: true },
      });
      const catId = (await catRes.json()).data.id;

      // 2. Create another category
      const catRes2 = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: "分类TestFilter2", enabled: true },
      });
      const catId2 = (await catRes2.json()).data.id;

      // 3. Create store linked to catId, and make it online
      const storeRes1 = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "有该分类的店",
          address: "地址A",
          phone: "11111",
          open_at: "09:00:00",
          close_at: "18:00:00",
          category_ids: [catId],
        },
      });
      const storeId1 = (await storeRes1.json()).data.id;
      await harness.request("PUT", `/admin/stores/${storeId1}/status`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: "online" },
      });

      // 4. Create store linked to catId2, and make it online
      const storeRes2 = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "无该分类的店",
          address: "地址B",
          phone: "22222",
          open_at: "09:00:00",
          close_at: "18:00:00",
          category_ids: [catId2],
        },
      });
      const storeId2 = (await storeRes2.json()).data.id;
      await harness.request("PUT", `/admin/stores/${storeId2}/status`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: "online" },
      });

      // 5. Query /weapp/stores?category_id=catId
      const res = await harness.request("GET", `/weapp/stores?category_id=${catId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      
      const ids = body.data.map((s: any) => s.id);
      expect(ids).toContain(storeId1);
      expect(ids).not.toContain(storeId2);
    });
  });


  describe("8.8 Category Association Constraints & Cascading Checks", () => {
    it("successfully links store to active categories, and rejects non-existent/disabled categories", async () => {
      const adminToken = await getSuperAdminToken();

      // Create an active and a disabled category
      const catActiveRes = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: "启用的分类", enabled: true },
      });
      const activeCatBody = await catActiveRes.json();
      const activeCatId = activeCatBody.data.id;

      const catDisabledRes = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: "禁用的分类", enabled: false },
      });
      const disabledCatBody = await catDisabledRes.json();
      const disabledCatId = disabledCatBody.data.id;

      // 1. Link active category during store creation -> success
      const storeRes1 = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "分类关联店",
          address: "五角场",
          phone: "13333333333",
          open_at: "09:00:00",
          close_at: "21:00:00",
          category_ids: [activeCatId],
        },
      });
      expect(storeRes1.status).toBe(200);
      const store1Body = await storeRes1.json();
      const store1Data = store1Body.data;
      expect(store1Data.categories.map((c: any) => c.id)).toContain(activeCatId);

      // 2. Link disabled category during creation -> 400 bad request
      const storeRes2 = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "分类关联店B",
          address: "五角场",
          phone: "13333333333",
          open_at: "09:00:00",
          close_at: "21:00:00",
          category_ids: [disabledCatId],
        },
      });
      expect(storeRes2.status).toBe(400);
      const store2Body = await storeRes2.json();
      expect(store2Body.error.code).toBe("store.invalid_category");

      // 3. Link non-existent category ID -> 400 bad request
      const storeRes3 = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "分类关联店C",
          address: "五角场",
          phone: "13333333333",
          open_at: "09:00:00",
          close_at: "21:00:00",
          category_ids: ["non-existent-cat-id"],
        },
      });
      expect(storeRes3.status).toBe(400);
    });

    it("retains relation entries when linked category is disabled, but not deleted", async () => {
      const adminToken = await getSuperAdminToken();

      // Create a category
      const catRes = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: "分类X", enabled: true },
      });
      const catBody = await catRes.json();
      const catId = catBody.data.id;

      // Link to a store
      const storeRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "门店X",
          address: "路X",
          phone: "11111",
          open_at: "09:00:00",
          close_at: "18:00:00",
          category_ids: [catId],
        },
      });
      const storeBody = await storeRes.json();
      const storeId = storeBody.data.id;

      // Verify link exists in join table
      const linksBefore = await harness.db
        .select()
        .from(storeCategory)
        .where(and(eq(storeCategory.storeId, storeId), eq(storeCategory.categoryId, catId)));
      expect(linksBefore.length).toBe(1);

      // Disable category
      await harness.request("PUT", `/admin/service-categories/${catId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { enabled: false },
      });

      // Verify link STILL exists in join table
      const linksAfter = await harness.db
        .select()
        .from(storeCategory)
        .where(and(eq(storeCategory.storeId, storeId), eq(storeCategory.categoryId, catId)));
      expect(linksAfter.length).toBe(1);
    });

    it("deduplicates categoryIds during store creation and update within a transaction to prevent constraint errors", async () => {
      const adminToken = await getSuperAdminToken();

      // Create a category
      const catRes = await harness.request("POST", "/admin/service-categories", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: "分类Deduplicate", enabled: true },
      });
      const catId = (await catRes.json()).data.id;

      // Create store with duplicate categoryIds
      const storeRes = await harness.request("POST", "/admin/stores", {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: "去重测试店",
          address: "南京路",
          phone: "11111",
          open_at: "09:00:00",
          close_at: "18:00:00",
          category_ids: [catId, catId], // Duplicate values!
        },
      });
      expect(storeRes.status).toBe(200);
      const storeData = (await storeRes.json()).data;
      expect(storeData.categories.length).toBe(1);
      expect(storeData.categories[0].id).toBe(catId);

      // Update store with duplicate categoryIds
      const updateRes = await harness.request("PUT", `/admin/stores/${storeData.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          category_ids: [catId, catId, catId], // Duplicate values!
        },
      });
      expect(updateRes.status).toBe(200);
      const updateData = (await updateRes.json()).data;
      expect(updateData.categories.length).toBe(1);
      expect(updateData.categories[0].id).toBe(catId);
    });
  });
});
