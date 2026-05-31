import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { requireRole, requireStoreScope } from "../auth/middleware.js";
import {
  replaceServicesRequestSchema,
  serviceListItemSchema,
  weappServiceListItemSchema,
  consultantListItemSchema,
  weappConsultantListItemSchema,
} from "@yikey/shared";
import {
  replaceServices,
  unbind,
  listServicesByConsultantForStoreAdmin,
  listConsultantsByServiceForStoreAdmin,
  listConsultantsByServiceForWeapp,
  listServicesByConsultantForWeapp,
} from "./service.js";

/**
 * 1. Store-Admin (B-Side) Consultant-Service Binding Router
 * Mounted at: app.route("/store-admin/consultants", createStoreAdminConsultantServiceRouter())
 */
export function createStoreAdminConsultantServiceRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["store_owner"]), requireStoreScope);

  // PUT /:consultantId/services - Replace bound services
  router.put("/:consultantId/services", async (c) => {
    const consultantId = c.req.param("consultantId");
    const storeId = c.var.user!.storeId!;
    const body = await c.req.json().catch(() => ({}));

    const parseResult = replaceServicesRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid input services collection", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const db = c.var.db;
    const finalServices = await replaceServices(
      db,
      storeId,
      consultantId,
      parseResult.data.serviceIds
    );

    const response = finalServices.map((s) => serviceListItemSchema.parse(s));
    return c.json(response);
  });

  // DELETE /:consultantId/services/:serviceId - Remove single binding
  router.delete("/:consultantId/services/:serviceId", async (c) => {
    const consultantId = c.req.param("consultantId");
    const serviceId = c.req.param("serviceId");
    const storeId = c.var.user!.storeId!;

    const db = c.var.db;
    await unbind(db, storeId, consultantId, serviceId);

    c.status(204);
    return c.body(null);
  });

  // GET /:consultantId/services - Read bound services for store-admin
  router.get("/:consultantId/services", async (c) => {
    const consultantId = c.req.param("consultantId");
    const storeId = c.var.user!.storeId!;

    const db = c.var.db;
    const services = await listServicesByConsultantForStoreAdmin(db, storeId, consultantId);

    const response = services.map((s) => serviceListItemSchema.parse(s));
    return c.json(response);
  });

  return router;
}

/**
 * 2. Store-Admin (B-Side) Service-Consultants Router
 * Mounted at: app.route("/store-admin/services", createStoreAdminServiceConsultantsRouter())
 */
export function createStoreAdminServiceConsultantsRouter() {
  const router = new Hono<AppEnv>();

  router.use(requireRole(["store_owner"]), requireStoreScope);

  // GET /:serviceId/consultants - Read consultants active for a service
  router.get("/:serviceId/consultants", async (c) => {
    const serviceId = c.req.param("serviceId");
    const storeId = c.var.user!.storeId!;

    const db = c.var.db;
    const consultants = await listConsultantsByServiceForStoreAdmin(db, storeId, serviceId);

    const response = consultants.map((con) => consultantListItemSchema.parse(con));
    return c.json(response);
  });

  return router;
}

/**
 * 3. WeApp (C-Side) Store Service Consultants Router
 * Mounted at: app.route("/weapp/stores", createWeappStoreServiceConsultantsRouter())
 */
export function createWeappStoreServiceConsultantsRouter() {
  const router = new Hono<AppEnv>();

  // GET /:storeId/services/:serviceId/consultants - Active consultants for online store & active service
  router.get("/:storeId/services/:serviceId/consultants", async (c) => {
    const storeId = c.req.param("storeId");
    const serviceId = c.req.param("serviceId");

    const db = c.var.db;
    const consultants = await listConsultantsByServiceForWeapp(db, storeId, serviceId);

    const response = consultants.map((con) => weappConsultantListItemSchema.parse(con));
    return c.json(response);
  });

  return router;
}

/**
 * 4. WeApp (C-Side) Consultant Services Router
 * Mounted at: app.route("/weapp/consultants", createWeappConsultantServicesRouter())
 */
export function createWeappConsultantServicesRouter() {
  const router = new Hono<AppEnv>();

  // GET /:consultantId/services - Active services for active consultant & online store
  router.get("/:consultantId/services", async (c) => {
    const consultantId = c.req.param("consultantId");

    const db = c.var.db;
    const services = await listServicesByConsultantForWeapp(db, consultantId);

    const response = services.map((s) => weappServiceListItemSchema.parse(s));
    return c.json(response);
  });

  return router;
}
