import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { requireRole, requireStoreScope } from "../auth/middleware.js";
import {
  createServiceRequestSchema,
  updateServiceRequestSchema,
  serviceResponseSchema,
} from "@yikey/shared";
import {
  createService,
  updateService,
  getService,
  listServices,
  updateServiceStatus,
  deleteService,
} from "./service.js";
import { store } from "../db/schema.js";
import { eq } from "drizzle-orm";

export function createStoreAdminServiceRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["store_owner"]));
  router.use(requireStoreScope);

  // 1. POST / - Create a service item
  router.post("/", async (c) => {
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));
    const parseResult = createServiceRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid service creation input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const item = await createService(db, storeId, parseResult.data);
    const response = serviceResponseSchema.parse(item);
    return c.json(response);
  });

  // 2. GET / - List services for own store
  router.get("/", async (c) => {
    const storeId = c.var.user!.storeId!;
    const db = c.var.db;
    const items = await listServices(db, storeId);
    const response = items.map((item) => serviceResponseSchema.parse(item));
    return c.json(response);
  });

  // 3. GET /:id - Get service item details
  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const db = c.var.db;
    const item = await getService(db, id, storeId);
    const response = serviceResponseSchema.parse(item);
    return c.json(response);
  });

  // 4. PUT /:id - Update service item metadata
  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));
    const parseResult = updateServiceRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid service update input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const item = await updateService(db, id, storeId, parseResult.data, now);
    const response = serviceResponseSchema.parse(item);
    return c.json(response);
  });

  // 5. PUT /:id/status - Update service status
  router.put("/:id/status", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));
    const status = body.status;
    if (!status) {
      throw new BizError("validation.invalid_input", "Status parameter is required", {
        httpStatus: 400,
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const item = await updateServiceStatus(db, id, storeId, status, now);
    const response = serviceResponseSchema.parse(item);
    return c.json(response);
  });

  // 6. DELETE /:id - Delete service item
  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const db = c.var.db;
    await deleteService(db, id, storeId);
    return c.json({ success: true });
  });

  return router;
}

export function createPublicServiceRouter() {
  const router = new Hono<AppEnv>();

  // GET / (which resolves to /weapp/stores/:storeId/services)
  router.get("/", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId) {
      throw new BizError("validation.invalid_input", "Store ID is required", { httpStatus: 400 });
    }
    const db = c.var.db;

    // Check store exists and is online
    const storeObj = await db
      .select()
      .from(store)
      .where(eq(store.id, storeId))
      .limit(1);

    if (storeObj.length === 0 || storeObj[0].status !== "online") {
      throw new BizError("store.store_not_found", "Store not found", { httpStatus: 404 });
    }

    const items = await listServices(db, storeId, { status: "active" });
    const response = items.map((item) => serviceResponseSchema.parse(item));
    return c.json(response);
  });

  return router;
}

export function createAdminServiceRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["super_admin"]));

  // GET / (which resolves to /admin/stores/:storeId/services)
  router.get("/", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId) {
      throw new BizError("validation.invalid_input", "Store ID is required", { httpStatus: 400 });
    }
    const db = c.var.db;

    // Check store exists
    const storeObj = await db
      .select()
      .from(store)
      .where(eq(store.id, storeId))
      .limit(1);

    if (storeObj.length === 0) {
      throw new BizError("store.store_not_found", "Store not found", { httpStatus: 404 });
    }

    const items = await listServices(db, storeId);
    const response = items.map((item) => serviceResponseSchema.parse(item));
    return c.json(response);
  });

  return router;
}
