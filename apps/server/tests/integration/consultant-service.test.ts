import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { generateTestToken } from "../helpers/jwt.js";
import {
  serviceListItemClientSchema,
  weappServiceListItemClientSchema,
  consultantListItemClientSchema,
  weappConsultantListItemClientSchema,
} from "@yikey/shared";
import { user as userTable, consultant as consultantTable, consultantService as consultantServiceTable } from "../../src/db/schema.js";
import { eq, and } from "drizzle-orm";

describe("Consultant Service Binding Integration Tests", () => {
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

  it("Full binding flow and validations", async () => {
    const adminToken = await getSuperAdminToken();

    // 1. Setup: Create Store A, Store B
    const storeARes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "Store A", address: "南京路", phone: "123", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdA = (await storeARes.json()).data.id;
    const ownerAToken = await getStoreOwnerToken(storeIdA);

    const storeBRes = await harness.request("POST", "/admin/stores", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "Store B", address: "北京路", phone: "456", open_at: "09:00:00", close_at: "21:00:00" },
    });
    const storeIdB = (await storeBRes.json()).data.id;
    const ownerBToken = await getStoreOwnerToken(storeIdB);

    // Create Category
    const catRes = await harness.request("POST", "/admin/service-categories", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "美容美发", enabled: true },
    });
    const catId = (await catRes.json()).data.id;

    // Link stores to category
    await harness.request("PUT", `/admin/stores/${storeIdA}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "Store A", address: "南京路", phone: "123", open_at: "09:00:00", close_at: "21:00:00", category_ids: [catId] },
    });
    await harness.request("PUT", `/admin/stores/${storeIdB}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: "Store B", address: "北京路", phone: "456", open_at: "09:00:00", close_at: "21:00:00", category_ids: [catId] },
    });

    // Create User A (Store A), User B (Store B)
    const [dbUserA] = await harness.db.insert(userTable).values({ openid: "openid_a", uid: "EKY2026100001", nickname: "User A" }).returning();
    const [dbUserB] = await harness.db.insert(userTable).values({ openid: "openid_b", uid: "EKY2026100002", nickname: "User B" }).returning();

    // Create Consultant A (Store A), Consultant B (Store B)
    const [c1] = await harness.db.insert(consultantTable).values({
      userId: dbUserA.id,
      storeId: storeIdA,
      name: "设计师A",
      experienceYears: 5,
      level: "资深",
      status: "active",
    }).returning();

    const [c2] = await harness.db.insert(consultantTable).values({
      userId: dbUserB.id,
      storeId: storeIdB,
      name: "设计师B",
      experienceYears: 3,
      level: "高级",
      status: "active",
    }).returning();

    // Create Services in Store A: S1 (Active), S2 (Active), S3 (Inactive)
    const s1Res = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { category_id: catId, name: "剪发S1", price_cents: 3000, duration_minutes: 30 },
    });
    const s1Id = (await s1Res.json()).data.id;

    const s2Res = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { category_id: catId, name: "烫发S2", price_cents: 12000, duration_minutes: 60 },
    });
    const s2Id = (await s2Res.json()).data.id;

    const s3Res = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { category_id: catId, name: "染发S3", price_cents: 15000, duration_minutes: 90, status: "inactive" },
    });
    const s3Id = (await s3Res.json()).data.id;

    // Create Service in Store B: S4 (Active)
    const s4Res = await harness.request("POST", "/store-admin/services", {
      headers: { Authorization: `Bearer ${ownerBToken}` },
      body: { category_id: catId, name: "按摩S4", price_cents: 8000, duration_minutes: 45 },
    });
    const s4Id = (await s4Res.json()).data.id;

    // ====================================================
    // 7.1 PUT replacement edit: [A, B, C] -> [A, C, D]
    // ====================================================
    const putRes1 = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [s1Id, s2Id] },
    });
    expect(putRes1.status).toBe(200);
    const services1 = (await putRes1.json()).data;
    expect(services1.length).toBe(2);
    expect(services1.map((s: any) => s.id)).toContain(s1Id);
    expect(services1.map((s: any) => s.id)).toContain(s2Id);

    // 10.1 & 10.2: Zod response schema validation
    expect(serviceListItemClientSchema.safeParse(services1[0]).success).toBe(true);

    // 7.1 (cont): Edit bindings
    const putRes2 = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [s1Id] },
    });
    expect(putRes2.status).toBe(200);
    const services2 = (await putRes2.json()).data;
    expect(services2.length).toBe(1);
    expect(services2[0].id).toBe(s1Id);

    // ====================================================
    // 7.2 PUT empty collection
    // ====================================================
    const putEmptyRes = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [] },
    });
    expect(putEmptyRes.status).toBe(200);
    expect((await putEmptyRes.json()).data.length).toBe(0);

    // ====================================================
    // 7.3 PUT with cross-store service_id -> 404 (or service_not_found)
    // ====================================================
    // S4 belongs to Store B, so Store A owner shouldn't see it (IDOR) -> 404
    const putCrossRes1 = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: ["non-existent-service-id"] },
    });
    expect(putCrossRes1.status).toBe(404);
    const errObj1 = (await putCrossRes1.json()).error;
    expect(errObj1.code).toBe("consultant_service.service_not_found"); // 10.3 Assert error namespace

    // ====================================================
    // 7.6 PUT with cross-store consultant/service check -> 404 (IDOR)
    // ====================================================
    // S4 exists but belongs to Store B. Owner A tries to bind it to Consultant A (Store A).
    // Because Owner A is logged in, but passes S4 (Store B). S4 belongs to another store.
    const putCrossRes2 = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [s4Id] },
    });
    expect(putCrossRes2.status).toBe(404);
    expect((await putCrossRes2.json()).error.code).toBe("consultant_service.service_not_found");

    // ====================================================
    // 7.4 PUT with inactive service -> 409
    // ====================================================
    const putInactiveRes = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [s3Id] },
    });
    expect(putInactiveRes.status).toBe(409);
    expect((await putInactiveRes.json()).error.code).toBe("consultant_service.service_inactive");

    // ====================================================
    // 7.5 PUT with left consultant -> 409
    // ====================================================
    // Soft unbind Consultant A first
    await harness.db.update(consultantTable).set({ status: "left" }).where(eq(consultantTable.id, c1.id));
    const putLeftRes = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [s1Id] },
    });
    expect(putLeftRes.status).toBe(409);
    expect((await putLeftRes.json()).error.code).toBe("consultant_service.consultant_left");

    // Re-activate Consultant A for other tests
    await harness.db.update(consultantTable).set({ status: "active" }).where(eq(consultantTable.id, c1.id));

    // Bind S1, S2, S3 (S3 is inactive but we can insert it directly via SQL to verify that inactive remains bound)
    await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { service_ids: [s1Id, s2Id] },
    });
    // Manually link S3 via SQL to simulate a previously bound service becoming inactive
    await harness.db.insert(consultantServiceTable).values({ consultantId: c1.id, serviceId: s3Id });

    // ====================================================
    // 7.10 联合主键去重: 重复 insert 同对 (consultant_id, service_id) 不报错且无重复行
    // ====================================================
    await harness.db.insert(consultantServiceTable).values({ consultantId: c1.id, serviceId: s1Id }).onConflictDoNothing();
    const duplicateRows = await harness.db.select().from(consultantServiceTable).where(
      and(eq(consultantServiceTable.consultantId, c1.id), eq(consultantServiceTable.serviceId, s1Id))
    );
    expect(duplicateRows.length).toBe(1);

    // ====================================================
    // 7.7 & 7.8 & 7.9 DELETE Single Binding / Idempotency / IDOR
    // ====================================================
    // 7.9 DELETE他店 service id -> 404
    const delCrossRes = await harness.request("DELETE", `/store-admin/consultants/${c1.id}/services/${s4Id}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(delCrossRes.status).toBe(404);

    // 7.7 DELETE success -> 204
    const delRes1 = await harness.request("DELETE", `/store-admin/consultants/${c1.id}/services/${s2Id}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(delRes1.status).toBe(204);

    // Verify row is deleted
    const rows = await harness.db.select().from(consultantServiceTable).where(eq(consultantServiceTable.serviceId, s2Id));
    expect(rows.length).toBe(0);

    // 7.8 DELETE idempotency -> 204
    const delRes2 = await harness.request("DELETE", `/store-admin/consultants/${c1.id}/services/${s2Id}`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(delRes2.status).toBe(204);

    // ====================================================
    // 7.11 & 7.12 - Consultant left / Service inactive -> bound row remains
    // ====================================================
    // S3 is inactive, but is still in the join table. Let's make consultant left
    await harness.db.update(consultantTable).set({ status: "left" }).where(eq(consultantTable.id, c1.id));
    // Verify relation still exists in DB
    const csRows = await harness.db.select().from(consultantServiceTable).where(eq(consultantServiceTable.consultantId, c1.id));
    expect(csRows.map(r => r.serviceId)).toContain(s1Id);
    expect(csRows.map(r => r.serviceId)).toContain(s3Id);

    // Reactivate consultant for listing tests
    await harness.db.update(consultantTable).set({ status: "active" }).where(eq(consultantTable.id, c1.id));

    // ====================================================
    // 8.1 store-admin GET consultant -> services (active & inactive)
    // ====================================================
    const getRes1 = await harness.request("GET", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(getRes1.status).toBe(200);
    const getServices1 = (await getRes1.json()).data;
    expect(getServices1.length).toBe(2); // S1 (active), S3 (inactive)
    expect(getServices1.map((s: any) => s.id)).toContain(s1Id);
    expect(getServices1.map((s: any) => s.id)).toContain(s3Id);

    // ====================================================
    // 8.2 store-admin GET service -> consultants (only active, no user_id/openid)
    // ====================================================
    const getRes2 = await harness.request("GET", `/store-admin/services/${s1Id}/consultants`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(getRes2.status).toBe(200);
    const consultantsResult = (await getRes2.json()).data;
    expect(consultantsResult.length).toBe(1);
    expect(consultantsResult[0].id).toBe(c1.id);
    expect(consultantsResult[0].user_id).toBeUndefined();
    expect(consultantsResult[0].openid).toBeUndefined();
    expect(consultantListItemClientSchema.safeParse(consultantsResult[0]).success).toBe(true);

    // ====================================================
    // 8.3 store-admin GET cross-store -> 404
    // ====================================================
    // Consultant B belongs to Store B. Owner A tries to query it -> 404
    const getCrossAdmin = await harness.request("GET", `/store-admin/consultants/${c2.id}/services`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    expect(getCrossAdmin.status).toBe(404);

    // ====================================================
    // 8.4 & 8.5 weapp GET service -> consultants
    // ====================================================
    // 8.5 weapp GET service -> consultants: store offline -> 404
    const weappGetC1 = await harness.request("GET", `/weapp/stores/${storeIdA}/services/${s1Id}/consultants`);
    expect(weappGetC1.status).toBe(404);
    expect((await weappGetC1.json()).error.code).toBe("consultant_service.service_not_found");

    // Make store online
    await harness.request("PUT", `/admin/stores/${storeIdA}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: "online" },
    });

    // 8.4 weapp GET service -> consultants: online & active -> returns consultants list
    const weappGetC2 = await harness.request("GET", `/weapp/stores/${storeIdA}/services/${s1Id}/consultants`);
    expect(weappGetC2.status).toBe(200);
    const weappConsultants = (await weappGetC2.json()).data;
    expect(weappConsultants.length).toBe(1);
    expect(weappConsultants[0].id).toBe(c1.id);
    expect(weappConsultants[0].user_id).toBeUndefined();
    expect(weappConsultants[0].openid).toBeUndefined();
    expect(weappConsultantListItemClientSchema.safeParse(weappConsultants[0]).success).toBe(true);

    // 8.5 weapp GET service -> consultants: service inactive (S3) -> 404
    const weappGetInactiveS = await harness.request("GET", `/weapp/stores/${storeIdA}/services/${s3Id}/consultants`);
    expect(weappGetInactiveS.status).toBe(404);
    expect((await weappGetInactiveS.json()).error.code).toBe("consultant_service.service_not_found");

    // 8.5 weapp GET service -> consultants: service not in store (S4 belongs to Store B, but Store A requested) -> 404
    const weappGetOtherS = await harness.request("GET", `/weapp/stores/${storeIdA}/services/${s4Id}/consultants`);
    expect(weappGetOtherS.status).toBe(404);
    expect((await weappGetOtherS.json()).error.code).toBe("consultant_service.service_not_found");

    // ====================================================
    // 8.6 & 8.7 weapp GET consultant -> services
    // ====================================================
    // 8.6 weapp GET consultant -> services: active consultant & online store -> returns active services (excluding inactive S3)
    const weappGetS1 = await harness.request("GET", `/weapp/consultants/${c1.id}/services`);
    expect(weappGetS1.status).toBe(200);
    const weappServices = (await weappGetS1.json()).data;
    expect(weappServices.length).toBe(1); // S1 is active. S3 is inactive so it is filtered out.
    expect(weappServices[0].id).toBe(s1Id);
    expect(weappServices[0].status).toBeUndefined(); // weappServiceListItem doesn't contain status field
    expect(weappServiceListItemClientSchema.safeParse(weappServices[0]).success).toBe(true);

    // 8.7 weapp GET consultant -> services: consultant left -> 404
    await harness.db.update(consultantTable).set({ status: "left" }).where(eq(consultantTable.id, c1.id));
    const weappGetSLeft = await harness.request("GET", `/weapp/consultants/${c1.id}/services`);
    expect(weappGetSLeft.status).toBe(404);
    expect((await weappGetSLeft.json()).error.code).toBe("consultant_service.consultant_not_found");

    // Reactivate consultant
    await harness.db.update(consultantTable).set({ status: "active" }).where(eq(consultantTable.id, c1.id));

    // 8.7 (cont) weapp GET consultant -> services: store offline -> 404
    await harness.request("PUT", `/admin/stores/${storeIdA}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: "offline" },
    });
    const weappGetSOffline = await harness.request("GET", `/weapp/consultants/${c1.id}/services`);
    expect(weappGetSOffline.status).toBe(404);
    expect((await weappGetSOffline.json()).error.code).toBe("consultant_service.consultant_not_found");

    // Make store online again
    await harness.request("PUT", `/admin/stores/${storeIdA}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: "online" },
    });

    // ====================================================
    // 9.1 & 9.2 RBAC and Store Scope Checks
    // ====================================================
    // 9.1 Store staff role -> 403
    const staffToken = await getStoreStaffToken(storeIdA);
    const putStaffRes = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      body: { service_ids: [s1Id] },
    });
    expect(putStaffRes.status).toBe(403);

    // 9.2 No store scope (e.g. admin without store context trying to use store-admin route) -> 403/401
    const ownerNoStoreToken = await generateTestToken({ id: "owner_no_store", role: "store_owner", typ: "admin" }, jwtSecret);
    const putNoStoreRes = await harness.request("PUT", `/store-admin/consultants/${c1.id}/services`, {
      headers: { Authorization: `Bearer ${ownerNoStoreToken}` },
      body: { service_ids: [s1Id] },
    });
    expect(putNoStoreRes.status).toBe(403);
  });
});
