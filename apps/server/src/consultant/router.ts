import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { requireRole, requireStoreScope } from "../auth/middleware.js";
import { requireAuth } from "../middleware/jwt.js";
import {
  createTagRequestSchema,
  updateTagRequestSchema,
  tagResponseSchema,
  addConsultantRequestSchema,
  updateConsultantRequestSchema,
  consultantResponseSchema,
} from "@yikey/shared";
import {
  createTag,
  updateTag,
  listTags,
} from "./tag-service.js";
import {
  addConsultant,
  updateConsultant,
  getConsultantDetail,
  listConsultants,
  softUnbindConsultant,
  listMyConsultantProfiles,
} from "./service.js";

export function createAdminTagRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["super_admin"]));

  // 1. POST / - Create a global tag
  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parseResult = createTagRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid tag creation input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const item = await createTag(db, parseResult.data);
    const response = tagResponseSchema.parse(item);
    return c.json(response);
  });

  // 2. PUT /:id - Update a global tag
  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parseResult = updateTagRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid tag update input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const item = await updateTag(db, id, parseResult.data, now);
    const response = tagResponseSchema.parse(item);
    return c.json(response);
  });

  // 3. GET / - List global tags by type
  router.get("/", async (c) => {
    const type = c.req.query("type") as "consultant" | "review" | undefined;
    const enabledStr = c.req.query("enabled");
    let enabled: boolean | undefined;
    if (enabledStr !== undefined) {
      enabled = enabledStr === "true";
    }

    const db = c.var.db;
    const items = await listTags(db, { type, enabled });
    const response = items.map((item) => tagResponseSchema.parse(item));
    return c.json(response);
  });

  return router;
}

export function createStoreAdminConsultantRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["store_owner"]));
  router.use(requireStoreScope);

  // 1. POST / - Add a consultant by User UID
  router.post("/", async (c) => {
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));
    const parseResult = addConsultantRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid consultant addition input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const item = await addConsultant(db, storeId, parseResult.data, now);
    const response = consultantResponseSchema.parse(item);
    return c.json(response);
  });

  // 2. GET / - List store consultants
  router.get("/", async (c) => {
    const storeId = c.var.user!.storeId!;
    const status = c.req.query("status");
    if (status !== undefined && !["active", "inactive", "left"].includes(status)) {
      throw new BizError("validation.invalid_input", "Invalid status filter", {
        httpStatus: 400,
      });
    }
    const db = c.var.db;
    const items = await listConsultants(db, storeId, { status });
    const response = items.map((item) => consultantResponseSchema.parse(item));
    return c.json(response);
  });

  // 3. GET /:id - Get consultant detail
  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const db = c.var.db;
    const item = await getConsultantDetail(db, id, storeId);
    const response = consultantResponseSchema.parse(item);
    return c.json(response);
  });

  // 4. PUT /:id - Edit consultant details
  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));
    const parseResult = updateConsultantRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid consultant update input", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const item = await updateConsultant(db, id, storeId, parseResult.data, now);
    const response = consultantResponseSchema.parse(item);
    return c.json(response);
  });

  // 5. DELETE /:id - Soft unbind consultant (set status to 'left')
  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const storeId = c.var.user!.storeId!;
    const db = c.var.db;
    const now = c.var.now;
    await softUnbindConsultant(db, id, storeId, now);
    return c.json({ success: true });
  });

  return router;
}

export function createPublicConsultantRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireAuth);

  // GET /weapp/consultants/me - List my bound consultant profiles
  router.get("/", async (c) => {
    const currentUserId = c.var.user!.id;
    const db = c.var.db;
    const items = await listMyConsultantProfiles(db, currentUserId);
    const response = items.map((item) => consultantResponseSchema.parse(item));
    return c.json(response);
  });

  return router;
}
