import { Hono } from "hono";
import { AppEnv } from "../../types.js";
import { BizError } from "../../errors.js";
import { requireRole } from "../../auth/middleware.js";
import {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  categoryResponseSchema,
} from "@yikey/shared";
import {
  createServiceCategory,
  updateServiceCategory,
  listServiceCategories,
} from "./service.js";

/**
 * Creates the admin router for Service Categories.
 * Root is mounted at /api/v1/admin/service-categories
 */
export function createAdminCategoryRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["super_admin"]));

  // 1. POST /
  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parseResult = createCategoryRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid category creation data", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const category = await createServiceCategory(db, parseResult.data);
    const response = categoryResponseSchema.parse(category);

    return c.json(response);
  });

  // 2. PUT /:id
  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parseResult = updateCategoryRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid category update data", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const now = c.var.now;
    const category = await updateServiceCategory(db, id, parseResult.data, now);
    const response = categoryResponseSchema.parse(category);

    return c.json(response);
  });

  // 3. GET /
  router.get("/", async (c) => {
    const db = c.var.db;
    const categories = await listServiceCategories(db);
    const response = categories.map((cat) => categoryResponseSchema.parse(cat));

    return c.json(response);
  });

  return router;
}

/**
 * Creates the public/general router for Service Categories.
 * Root is mounted at /api/v1/service-categories
 */
export function createPublicCategoryRouter() {
  const router = new Hono<AppEnv>();

  // 1. GET / (Public / Store Admin lookup: returns enabled-only categories)
  router.get("/", async (c) => {
    const db = c.var.db;
    const categories = await listServiceCategories(db, { enabledOnly: true });
    const response = categories.map((cat) => categoryResponseSchema.parse(cat));

    return c.json(response);
  });

  return router;
}
