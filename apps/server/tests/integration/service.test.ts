import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { generateTestToken } from "../helpers/jwt.js";
import { serviceClientResponseSchema } from "@yikey/shared";

describe("Service Item Integration Tests", () => {
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

  it("6.1 & 6.2 - Price and Duration validation rules", async () => {
    const adminToken = await getSuperAdminToken();

    // Setup: Create store and category
    const catRes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分类A", enabled: true },
    });
    const catId = (await catRes.json()).data.id;

    const storeRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "门店A",
        address: "南京路",
        phone: "12345",
        open_at: "09:00:00",
        close_at: "18:00:00",
        category_ids: [catId],
      },
    });
    const storeId = (await storeRes.json()).data.id;
    const ownerToken = await getStoreOwnerToken(storeId);

    // Test case 6.1: Negative price
    const resNegPrice = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "剪发",
        price_cents: -500,
        duration_minutes: 30,
      },
    });
    expect(resNegPrice.status).toBe(400);
    expect((await resNegPrice.json()).error.code).toBe("validation.invalid_input");

    // Test case 6.1: Float price (not allowed by schema/integer constraints)
    const resFloatPrice = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "剪发",
        price_cents: 45.5,
        duration_minutes: 30,
      },
    });
    expect(resFloatPrice.status).toBe(400);

    // Test case 6.2: Missing duration
    const resMissDur = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "剪发",
        price_cents: 5800,
      },
    });
    expect(resMissDur.status).toBe(400);

    // Test case 6.2: Non-positive duration (0)
    const resZeroDur = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "剪发",
        price_cents: 5800,
        duration_minutes: 0,
      },
    });
    expect(resZeroDur.status).toBe(400);

    // Valid create
    const resSuccess = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "普通剪发",
        price_cents: 5800,
        duration_minutes: 30,
      },
    });
    expect(resSuccess.status).toBe(200);
    const body = await resSuccess.json();
    expect(body.data.price_cents).toBe(5800);
    expect(body.data.duration_minutes).toBe(30);
    expect(body.data.currency).toBe("CNY");
    expect(body.data.status).toBe("active");
  });

  it("6.3 - Category constraints validations", async () => {
    const adminToken = await getSuperAdminToken();

    // Create Category A (enabled) and Category B (disabled)
    const catARes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分类A", enabled: true },
    });
    const catAId = (await catARes.json()).data.id;

    const catBRes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分类B", enabled: false },
    });
    const catBId = (await catBRes.json()).data.id;

    // Create Store A, linked ONLY to Category A
    const storeRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "门店A",
        address: "南京路",
        phone: "12345",
        open_at: "09:00:00",
        close_at: "18:00:00",
        category_ids: [catAId],
      },
    });
    const storeId = (await storeRes.json()).data.id;
    const ownerToken = await getStoreOwnerToken(storeId);

    // Try to link service to disabled Category B -> throws service.invalid_category
    const resDisabledCat = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catBId,
        name: "服务B",
        price_cents: 5000,
        duration_minutes: 45,
      },
    });
    expect(resDisabledCat.status).toBe(400);
    expect((await resDisabledCat.json()).error.code).toBe("service.invalid_category");

    // Try to link to non-existent Category ID -> throws service.invalid_category
    const resNonExistentCat = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: "non-existent-cat-id",
        name: "服务C",
        price_cents: 5000,
        duration_minutes: 45,
      },
    });
    expect(resNonExistentCat.status).toBe(400);
    expect((await resNonExistentCat.json()).error.code).toBe("service.invalid_category");

    // Create Category C (enabled) but NOT linked to Store A
    const catCRes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分类C", enabled: true },
    });
    const catCId = (await catCRes.json()).data.id;

    // Try to link service to Category C -> throws service.category_not_in_store
    const resNotInStoreCat = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catCId,
        name: "服务D",
        price_cents: 5000,
        duration_minutes: 45,
      },
    });
    expect(resNotInStoreCat.status).toBe(400);
    expect((await resNotInStoreCat.json()).error.code).toBe("service.category_not_in_store");
  });

  it("6.4 - Store CRUD permissions & IDOR protection", async () => {
    const adminToken = await getSuperAdminToken();

    // Create Category A
    const catRes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分类A", enabled: true },
    });
    const catId = (await catRes.json()).data.id;

    // Create Store A & Store B
    const storeARes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "门店A",
        address: "长寿路",
        phone: "111",
        open_at: "09:00:00",
        close_at: "18:00:00",
        category_ids: [catId],
      },
    });
    const storeIdA = (await storeARes.json()).data.id;

    const storeBRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "门店B",
        address: "延安路",
        phone: "222",
        open_at: "09:00:00",
        close_at: "18:00:00",
        category_ids: [catId],
      },
    });
    const storeIdB = (await storeBRes.json()).data.id;

    const ownerAToken = await getStoreOwnerToken(storeIdA);
    const ownerBToken = await getStoreOwnerToken(storeIdB);

    // 1. Owner A creates a service in Store A
    const createRes = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: {
        category_id: catId,
        name: "本店剪发",
        price_cents: 6800,
        duration_minutes: 30,
      },
    });
    expect(createRes.status).toBe(200);
    const serviceIdA = (await createRes.json()).data.id;

    // 2. Owner B tries to update Owner A's service -> throws 404 (IDOR protection)
    const updateRes = await harness.request("PUT", `/store-admin/services/${serviceIdA}`, {
      headers: { Authorization: `Bearer ${ownerBToken}` },
      body: { name: "越权篡改" },
    });
    expect(updateRes.status).toBe(404);
    expect((await updateRes.json()).error.code).toBe("service.service_not_found");

    // 3. Owner B tries to delete Owner A's service -> throws 404 (IDOR protection)
    const deleteRes = await harness.request("DELETE", `/store-admin/services/${serviceIdA}`, {
      headers: { Authorization: `Bearer ${ownerBToken}` },
    });
    expect(deleteRes.status).toBe(404);

    // 4. Non-store roles (store_staff) blocked from store-admin service CRUD
    const staffToken = await getStoreStaffToken(storeIdA);
    const staffRes = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${staffToken}` },
      body: {
        category_id: catId,
        name: "员工篡权服务",
        price_cents: 1000,
        duration_minutes: 10,
      },
    });
    expect(staffRes.status).toBe(403);
  });

  it("6.5 & 6.6 & 6.7 & 6.8 - Up/down-架, Visibility, Admin read, Contract checks", async () => {
    const adminToken = await getSuperAdminToken();

    // Create Category A
    const catRes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "分类A", enabled: true },
    });
    const catId = (await catRes.json()).data.id;

    // Create Store A
    const storeRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: "门店A",
        address: "长寿路",
        phone: "111",
        open_at: "09:00:00",
        close_at: "18:00:00",
        category_ids: [catId],
      },
    });
    const storeId = (await storeRes.json()).data.id;
    const ownerToken = await getStoreOwnerToken(storeId);

    // Create active service & inactive service
    const resActive = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "在线项目",
        price_cents: 8000,
        duration_minutes: 40,
        status: "active",
      },
    });
    const serviceIdActive = (await resActive.json()).data.id;

    const resInactive = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        category_id: catId,
        name: "下线项目",
        price_cents: 12000,
        duration_minutes: 60,
        status: "inactive",
      },
    });
    const serviceIdInactive = (await resInactive.json()).data.id;

    // 6.6: Fetch services for draft store as a user -> returns 404 (store is currently draft)
    const resDraftUser = await harness.request("GET", `/weapp/stores/${storeId}/services`);
    expect(resDraftUser.status).toBe(404);

    // Put store online
    await harness.request("PUT", `/admin/stores/${storeId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: "online" },
    });

    // Fetch online store's services as user
    const resOnlineUser = await harness.request("GET", `/weapp/stores/${storeId}/services`);
    expect(resOnlineUser.status).toBe(200);
    const userServices = (await resOnlineUser.json()).data;

    // 6.5: Verify only active services are returned to user
    const userIds = userServices.map((s: any) => s.id);
    expect(userIds).toContain(serviceIdActive);
    expect(userIds).not.toContain(serviceIdInactive);

    // 6.8: Contract Schema check on user response
    expect(serviceClientResponseSchema.safeParse(userServices[0]).success).toBe(true);

    // 6.7: Admin read - get all services (active & inactive)
    const resAdminQuery = await harness.request("GET", `/admin/stores/${storeId}/services`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resAdminQuery.status).toBe(200);
    const adminServices = (await resAdminQuery.json()).data;
    const adminIds = adminServices.map((s: any) => s.id);
    expect(adminIds).toContain(serviceIdActive);
    expect(adminIds).toContain(serviceIdInactive);
  });
});
