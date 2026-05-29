import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { requireRole, requireStoreScope } from "../auth/middleware.js";
import {
  adminCreateStoreRequestSchema,
  adminUpdateStoreRequestSchema,
  storeOwnerUpdateStoreRequestSchema,
  storeResponseSchema,
} from "@yikey/shared";
import {
  createStore,
  updateStore,
  getStore,
  listStores,
  updateStoreStatus,
} from "./service.js";

/**
 * Creates the admin router for stores.
 * Root is mounted at /api/v1/admin/stores
 */
export function createAdminStoreRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["super_admin"]));

  // 1. POST /
  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parseResult = adminCreateStoreRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid store creation input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const storeObj = await createStore(db, parseResult.data);
    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  // 2. PUT /:id
  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parseResult = adminUpdateStoreRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid store update input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const storeObj = await updateStore(db, id, parseResult.data, now);
    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  // 3. PUT /:id/status
  router.put("/:id/status", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const status = body.status;
    if (!status) {
      throw new BizError("validation.invalid_input", "Status parameter is required", {
        httpStatus: 400,
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const storeObj = await updateStoreStatus(db, id, status, now);
    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  // 4. GET /
  router.get("/", async (c) => {
    const status = c.req.query("status");
    const db = c.var.db;
    const stores = await listStores(db, { status });
    const response = stores.map((s) => storeResponseSchema.parse(s));

    return c.json(response);
  });

  // 5. GET /:id
  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = c.var.db;
    const storeObj = await getStore(db, id);
    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  return router;
}

/**
 * Creates the store-admin router for store self-management.
 * Root is mounted at /api/v1/store-admin/store
 */
export function createStoreAdminStoreRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["store_owner"]));
  router.use(requireStoreScope);

  // 1. GET /
  router.get("/", async (c) => {
    const storeId = c.var.user!.storeId!;
    const db = c.var.db;
    const storeObj = await getStore(db, storeId);
    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  // 2. PUT /
  router.put("/", async (c) => {
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));
    const parseResult = storeOwnerUpdateStoreRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid store self-update input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const storeObj = await updateStore(db, storeId, parseResult.data, now);
    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  return router;
}

/**
 * Creates the public router for stores on WeChat app.
 * Root is mounted at /api/v1/weapp/stores
 */
export function createPublicStoreRouter() {
  const router = new Hono<AppEnv>();

  // 1. GET / (Returns only online stores)
  router.get("/", async (c) => {
    const categoryId = c.req.query("category_id");
    const db = c.var.db;
    const stores = await listStores(db, { categoryId, enabledOnly: true });
    const response = stores.map((s) => storeResponseSchema.parse(s));

    return c.json(response);
  });

  // 2. GET /:id (Only online stores allowed)
  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = c.var.db;
    const storeObj = await getStore(db, id);

    if (storeObj.status !== "online") {
      throw new BizError("store.store_not_found", "Store not found", { httpStatus: 404 });
    }

    const response = storeResponseSchema.parse(storeObj);

    return c.json(response);
  });

  return router;
}
