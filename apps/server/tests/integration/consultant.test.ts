import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { generateTestToken } from "../helpers/jwt.js";
import { QueueRegistry, createQueueConnection, registerPayloadSchema } from "../../src/queue/index.js";
import { QueueTestHarness } from "./queue/harness.js";
import { wechatSubscribeJobSchema, consultantClientResponseSchema } from "@yikey/shared";
import { user as userTable, consultant as consultantTable } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { initWeChatService } from "../../src/wechat/index.js";

describe("Consultant and Tag Library Integration Tests", () => {
  const harness = createTestHarness();
  const jwtSecret = process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long";

  const getSuperAdminToken = async () =>
    await generateTestToken(
      {
        id: "super_admin_1",
        role: "super_admin",
        typ: "admin",
      },
      jwtSecret
    );

  const getStoreOwnerToken = async (storeId: string) =>
    await generateTestToken(
      {
        id: "store_owner_1",
        role: "store_owner",
        storeId,
        typ: "admin",
      },
      jwtSecret
    );

  const getStoreStaffToken = async (storeId: string) =>
    await generateTestToken(
      {
        id: "store_staff_1",
        role: "store_staff",
        storeId,
        typ: "admin",
      },
      jwtSecret
    );

  const getWeappUserToken = async (userId: string, userUid: string) =>
    await generateTestToken(
      {
        id: userId,
        uid: userUid,
        role: "user",
        typ: "weapp",
      },
      jwtSecret
    );

  beforeAll(async () => {
    const redisUrl = process.env.TEST_REDIS_URL;
    if (!redisUrl) {
      throw new Error("TEST_REDIS_URL is missing.");
    }
    const connection = createQueueConnection(redisUrl);
    QueueRegistry.setConnection(connection);
    QueueRegistry.register("notify:wechat-subscribe");

    // Register payload schema
    registerPayloadSchema("notify:wechat-subscribe", wechatSubscribeJobSchema);
  });

  afterAll(async () => {
    await QueueRegistry.closeAll().catch(() => {});
  });

  beforeEach(async () => {
    initWeChatService(harness.redis);
  });

  it("7.1 - Tag Library CRUD permissions and unique names", async () => {
    const adminToken = await getSuperAdminToken();
    const ownerToken = await getStoreOwnerToken("any-store");

    // 1. Create a tag as admin
    const createRes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "不推销",
        type: "consultant",
        sort_order: 1,
        enabled: true,
      },
    });
    expect(createRes.status).toBe(200);
    const tagObj = (await createRes.json()).data;
    expect(tagObj.name).toBe("不推销");
    expect(tagObj.type).toBe("consultant");

    // 2. Edit the tag
    const updateRes = await harness.request("PUT", `/admin/tags/${tagObj.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "极速服务",
        sort_order: 2,
      },
    });
    expect(updateRes.status).toBe(200);
    const updatedTag = (await updateRes.json()).data;
    expect(updatedTag.name).toBe("极速服务");
    expect(updatedTag.sort_order).toBe(2);

    // 3. Prevent duplicate type+name
    const duplicateRes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "极速服务",
        type: "consultant",
      },
    });
    expect(duplicateRes.status).toBe(400);
    expect((await duplicateRes.json()).error.code).toBe("tag.name_exists");

    // 4. List tags by type
    const listRes = await harness.request("GET", "/admin/tags?type=consultant", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status).toBe(200);
    const tagsList = (await listRes.json()).data;
    expect(tagsList.some((t: any) => t.id === tagObj.id)).toBe(true);

    // 5. Check permissions (store owner blocked)
    const blockRes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        name: "偷懒",
        type: "consultant",
      },
    });
    expect(blockRes.status).toBe(403);
  });

  it("7.2 & 7.3 & 7.7 - Add consultant, tag validation, auto_confirm defaults", async () => {
    const adminToken = await getSuperAdminToken();

    // 1. Create a store and two global tags
    const storeRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "门店X",
        address: "测试路 123 号",
        phone: "12345678901",
        open_at: "09:00:00",
        close_at: "21:00:00",
      },
    });
    const storeIdX = (await storeRes.json()).data.id;
    const ownerToken = await getStoreOwnerToken(storeIdX);

    // Create Tag A (consultant, enabled)
    const tagARes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "技术大牛", type: "consultant", enabled: true },
    });
    const tagAId = (await tagARes.json()).data.id;

    // Create Tag B (review, enabled)
    const tagBRes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "准时", type: "review", enabled: true },
    });
    const tagBId = (await tagBRes.json()).data.id;

    // Create Tag C (consultant, disabled)
    const tagCRes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "话痨", type: "consultant", enabled: false },
    });
    const tagCId = (await tagCRes.json()).data.id;

    // 2. Insert test users directly into the DB
    await harness.db
      .insert(userTable)
      .values({
        openid: "openid_user_a",
        uid: "EKY2026000001",
        nickname: "用户A",
        status: "active",
      });

    // 3. Add userA as consultant with invalid tags (review tag) -> 400
    const failTagRes1 = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        uid: "EKY2026000001",
        name: "艺名A",
        experience_years: 5,
        level: "资深设计师",
        tag_ids: [tagBId],
      },
    });
    expect(failTagRes1.status).toBe(400);
    expect((await failTagRes1.json()).error.code).toBe("consultant.invalid_tag");

    // 4. Add userA as consultant with disabled tag -> 400
    const failTagRes2 = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        uid: "EKY2026000001",
        name: "艺名A",
        experience_years: 5,
        level: "资深设计师",
        tag_ids: [tagCId],
      },
    });
    expect(failTagRes2.status).toBe(400);

    // 5. Add userA with non-existent UID -> 404
    const failUidRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        uid: "EKY2026000999",
        name: "艺名A",
        experience_years: 5,
        level: "资深设计师",
      },
    });
    expect(failUidRes.status).toBe(404);
    expect((await failUidRes.json()).error.code).toBe("consultant.user_not_found");

    // 6. Valid add userA -> 200 (with duplicate tag IDs to verify deduplication)
    const successRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        uid: "EKY2026000001",
        name: "艺名A",
        experience_years: 5,
        level: "资深设计师",
        tag_ids: [tagAId, tagAId],
      },
    });
    expect(successRes.status).toBe(200);
    const consultantObj = (await successRes.json()).data;
    expect(consultantObj.user_uid).toBe("EKY2026000001");
    expect(consultantObj.name).toBe("艺名A");
    expect(consultantObj.auto_confirm).toBe(false); // 7.7 Verify auto_confirm default
    expect(consultantObj.rating).toBe(0);
    expect(consultantObj.tags.length).toBe(1);
    expect(consultantObj.tags[0].id).toBe(tagAId);
    expect(consultantObj.user_id).toBeUndefined(); // Verify user.id is hidden
    expect(consultantObj.openid).toBeUndefined(); // Verify openid is hidden

    // 7. Duplicate add -> 409
    const dupRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        uid: "EKY2026000001",
        name: "又一次艺名",
        experience_years: 5,
        level: "资深设计师",
      },
    });
    expect(dupRes.status).toBe(409);
    expect((await dupRes.json()).error.code).toBe("consultant.already_bound");
  });

  it("7.4 & 7.5 - Consultant Info Management & Soft Unbinding", async () => {
    const adminToken = await getSuperAdminToken();

    // Setup: Create store A and store B
    const storeARes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "门店A", address: "地址A", phone: "1", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdA = (await storeARes.json()).data.id;

    const storeBRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "门店B", address: "地址B", phone: "2", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdB = (await storeBRes.json()).data.id;

    const ownerAToken = await getStoreOwnerToken(storeIdA);
    const ownerBToken = await getStoreOwnerToken(storeIdB);

    // Create Tag A (consultant, enabled)
    const tagARes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "星级大师", type: "consultant", enabled: true },
    });
    const tagAId = (await tagARes.json()).data.id;

    // Create userA
    await harness.db
      .insert(userTable)
      .values({
        openid: "openid_a",
        uid: "EKY2026000002",
        nickname: "用户A",
        status: "active",
      });

    // 1. Owner A adds User A as consultant
    const addRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: {
        uid: "EKY2026000002",
        name: "艺名A",
        experience_years: 3,
        level: "普通顾问",
      },
    });
    expect(addRes.status).toBe(200);
    const consultantId = (await addRes.json()).data.id;

    // 2. Owner B tries to update Owner A's consultant -> 404 (IDOR)
    const updateFailRes = await harness.request("PUT", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerBToken}` },
      body: { name: "篡改名字" },
    });
    expect(updateFailRes.status).toBe(404);

    // 3. Owner A updates consultant successfully (with duplicate tags to verify deduplication)
    const updateSuccessRes = await harness.request("PUT", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { name: "升级艺名A", level: "总监", tag_ids: [tagAId, tagAId] },
    });
    expect(updateSuccessRes.status).toBe(200);
    const updatedObj = (await updateSuccessRes.json()).data;
    expect(updatedObj.name).toBe("升级艺名A");
    expect(updatedObj.tags.length).toBe(1);
    expect(updatedObj.tags[0].id).toBe(tagAId);

    // 4. Staff blocked from store-admin consultants endpoints -> 403
    const staffToken = await getStoreStaffToken(storeIdA);
    const staffListRes = await harness.request("GET", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(staffListRes.status).toBe(403);

    // 5. Owner A soft-unbinds consultant (DELETE)
    const deleteRes = await harness.request("DELETE", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(deleteRes.status).toBe(200);

    // Check status in DB is 'left'
    const dbRecord = await harness.db
      .select()
      .from(consultantTable)
      .where(eq(consultantTable.id, consultantId))
      .limit(1);
    expect(dbRecord[0].status).toBe("left");
  });

  it("7.6 & 7.8 & 7.9 - Notifications, User Workbench entrance query, and Contracts check", async () => {
    const adminToken = await getSuperAdminToken();

    // 1. Setup: Create store and test user
    const storeRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "名店", address: "名路", phone: "123", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeId = (await storeRes.json()).data.id;
    const ownerToken = await getStoreOwnerToken(storeId);

    // Clean Redis keys for deduplication
    await harness.redis.del(`notify:dedup:consultant.bound:openid_c:${storeId}`);
    await harness.redis.del(`notify:dedup:consultant.unbound:openid_c:${storeId}`);

    const [userC] = await harness.db
      .insert(userTable)
      .values({
        openid: "openid_c",
        uid: "EKY2026000003",
        nickname: "用户C",
        status: "active",
      })
      .returning();

    // 2. Add consultant to Store A -> expect consultant.bound enqueued in BullMQ
    const addRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { uid: "EKY2026000003", name: "艺名C", experience_years: 1, level: "初级" },
    });
    const consultantId = (await addRes.json()).data.id;

    const waitingBound = await QueueTestHarness.getWaitingJobs("notify:wechat-subscribe");
    const boundJob = waitingBound.find(
      (j) => j.data.event === "consultant.bound" && j.data.touser === "openid_c" && j.data.data.storeName === "名店"
    );
    expect(boundJob).toBeDefined();
    expect(boundJob?.data.data.consultantName).toBe("艺名C");

    // 2b. Add the same consultant to Store B (within 5 minutes, without clearing Redis) -> expect consultant.bound enqueued again
    const storeBRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分店", address: "分路", phone: "456", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdB = (await storeBRes.json()).data.id;
    const ownerBToken = await getStoreOwnerToken(storeIdB);

    await harness.redis.del(`notify:dedup:consultant.bound:openid_c:${storeIdB}`);

    const addBRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerBToken}` },
      body: { uid: "EKY2026000003", name: "分店艺名", experience_years: 2, level: "高级" },
    });
    expect(addBRes.status).toBe(200);

    const waitingBoundAfter = await QueueTestHarness.getWaitingJobs("notify:wechat-subscribe");
    const boundJobB = waitingBoundAfter.find(
      (j) => j.data.event === "consultant.bound" && j.data.touser === "openid_c" && j.data.data.storeName === "分店"
    );
    expect(boundJobB).toBeDefined();
    expect(boundJobB?.data.data.consultantName).toBe("分店艺名");

    // 3. User C queries their consultant workbench list -> GET /weapp/consultants/me
    const userCToken = await getWeappUserToken(userC.id, userC.uid);
    const weappMeRes = await harness.request("GET", "/weapp/consultants/me", {
      headers: { Authorization: `Bearer ${userCToken}` },
    });
    expect(weappMeRes.status).toBe(200);
    const workbenchProfiles = (await weappMeRes.json()).data;
    expect(workbenchProfiles.length).toBe(2);
    const profileA = workbenchProfiles.find((p: any) => p.id === consultantId);
    expect(profileA).toBeDefined();
    expect(profileA.status).toBe("active");
    expect(profileA.store.name).toBe("名店");

    // 7.9: Contract check against shared Zod schemas (asserting no user_id/openid)
    expect(consultantClientResponseSchema.safeParse(profileA).success).toBe(true);
    expect(profileA.user_id).toBeUndefined();
    expect(profileA.openid).toBeUndefined();

    // 4. Regular non-consultant user queries GET /weapp/consultants/me -> returns empty
    const [userD] = await harness.db
      .insert(userTable)
      .values({ openid: "openid_d", uid: "EKY2026000004", nickname: "用户D", status: "active" })
      .returning();
    const userDToken = await getWeappUserToken(userD.id, userD.uid);
    const weappEmptyRes = await harness.request("GET", "/weapp/consultants/me", {
      headers: { Authorization: `Bearer ${userDToken}` },
    });
    expect(weappEmptyRes.status).toBe(200);
    expect((await weappEmptyRes.json()).data.length).toBe(0);

    // 5. Unbind consultant -> expect consultant.unbound enqueued
    await harness.request("DELETE", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    const waitingUnbound = await QueueTestHarness.getWaitingJobs("notify:wechat-subscribe");
    const unboundJob = waitingUnbound.find((j) => j.data.event === "consultant.unbound" && j.data.touser === "openid_c");
    expect(unboundJob).toBeDefined();
    expect(unboundJob?.data.data.storeName).toBe("名店");
  });

  it("8 - Additional constraints: disabled tag association, IDOR checks, unbind idempotency, and terminal left update protection", async () => {
    const adminToken = await getSuperAdminToken();

    // Setup: Create store A and store B
    const storeARes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "Store A", address: "地址A", phone: "1", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdA = (await storeARes.json()).data.id;

    const storeBRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "Store B", address: "地址B", phone: "2", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdB = (await storeBRes.json()).data.id;

    const ownerAToken = await getStoreOwnerToken(storeIdA);
    const ownerBToken = await getStoreOwnerToken(storeIdB);

    // Create Tag A (consultant, enabled)
    const tagARes = await harness.request("POST", "/admin/tags", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "标签A", type: "consultant", enabled: true },
    });
    const tagAId = (await tagARes.json()).data.id;

    // Create userA
    await harness.db
      .insert(userTable)
      .values({
        openid: "openid_a_additional",
        uid: "EKY2026000008",
        nickname: "用户A_Additional",
        status: "active",
      });

    // 1. Owner A adds User A as consultant with Tag A
    const addRes = await harness.request("POST", "/store-admin/consultants", {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: {
        uid: "EKY2026000008",
        name: "艺名A_Add",
        experience_years: 3,
        level: "普通顾问",
        tag_ids: [tagAId],
      },
    });
    expect(addRes.status).toBe(200);
    const consultantId = (await addRes.json()).data.id;

    // S1: Disable Tag A via admin PUT, re-fetch consultant and verify Tag A remains associated.
    const disableTagRes = await harness.request("PUT", `/admin/tags/${tagAId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { enabled: false },
    });
    expect(disableTagRes.status).toBe(200);

    const getRes = await harness.request("GET", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(getRes.status).toBe(200);
    const fetchedObj = (await getRes.json()).data;
    expect(fetchedObj.tags.some((t: any) => t.id === tagAId)).toBe(true);

    // S2: Owner B (Store B) tries to GET or DELETE Owner A's consultant -> 404 (IDOR)
    const getFailRes = await harness.request("GET", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerBToken}` },
    });
    expect(getFailRes.status).toBe(404);

    const deleteFailRes = await harness.request("DELETE", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerBToken}` },
    });
    expect(deleteFailRes.status).toBe(404);

    // List endpoint enum validation query check
    const listInvalidFilterRes = await harness.request("GET", `/store-admin/consultants?status=invalid_status`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(listInvalidFilterRes.status).toBe(400);

    // Soft-unbind consultant (DELETE) via owner A -> 200
    const deleteSuccessRes = await harness.request("DELETE", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(deleteSuccessRes.status).toBe(200);

    // Idempotency: call DELETE again on the soft-unbound consultant -> 404
    const deleteIdempotenceRes = await harness.request("DELETE", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(deleteIdempotenceRes.status).toBe(404);

    // Terminal left state: PUT updates to the soft-unbound consultant must receive 404
    const putTerminalRes = await harness.request("PUT", `/store-admin/consultants/${consultantId}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { name: "尝试更新已离职" },
    });
    expect(putTerminalRes.status).toBe(404);
  });
});
