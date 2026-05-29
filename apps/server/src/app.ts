import { Hono } from "hono";
import { AppEnv } from "./types.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { createJwtMiddleware } from "./middleware/jwt.js";
import { errorHandler } from "./middleware/error.js";
import { createHealthRouter } from "./health/index.js";
import { createStorageRouter } from "./storage/router.js";
import { createUserRouter } from "./user/router.js";
import { createAdminAuthRouter, createStoreAdminRouter } from "./auth/router.js";
import { createAdminCategoryRouter, createPublicCategoryRouter } from "./store/service-category/router.js";
import { createAdminStoreRouter, createStoreAdminStoreRouter, createPublicStoreRouter } from "./store/router.js";
import { DatabaseInstance } from "./db/index.js";
import { Redis } from "ioredis";
import { BizError } from "./errors.js";

export interface CreateAppOptions {
  db: DatabaseInstance;
  redis: Redis;
  clock: () => Date;
  jwtSecret: string;
}

/**
 * App Factory function.
 * Design Invariant: D2, D3, D4 - Explicit dependencies injected.
 * Configures the core global middleware pipeline: request_id -> context bindings -> logger -> jwt.
 * Registers Hono app.onError for global BizError serialization.
 * Mounts the /health router.
 */
export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const { db, redis, clock, jwtSecret } = options;
  const app = new Hono<AppEnv>();

  // Global error handler (onError) (D4)
  app.onError(errorHandler);

  // 1. request_id middleware (D4)
  app.use("*", requestIdMiddleware);

  // Context bindings for injectable clock and db
  app.use("*", async (c, next) => {
    c.set("now", clock());
    c.set("db", db);
    await next();
  });

  // 2. logger middleware (requires request_id) (D4)
  app.use("*", loggerMiddleware);

  // 3. jwt verification middleware (populates c.var.user) (D4)
  app.use("*", createJwtMiddleware(jwtSecret));

  // 4. Auto-wrap successful JSON responses (unified response format)
  app.use("*", async (c, next) => {
    await next();
    if (c.res && c.res.status >= 200 && c.res.status < 300) {
      const contentType = c.res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        try {
          const cloned = c.res.clone();
          const body = await cloned.json();
          // Check if already wrapped in success/error standard format
          const isWrapped = 
            body && 
            typeof body === "object" && 
            "request_id" in body && 
            ("data" in body || "error" in body);
            
          if (!isWrapped) {
            c.res = c.json(
              {
                request_id: c.var.requestId,
                data: body,
              },
              c.res.status as any,
            );
          }
        } catch {
          // If response body is not valid JSON, ignore
        }
      }
    }
  });

  // Mount endpoints
  app.route("/health", createHealthRouter(redis));
  app.route("/upload", createStorageRouter());
  app.route("/weapp", createUserRouter(jwtSecret));
  app.route("/admin/auth", createAdminAuthRouter(jwtSecret));
  app.route("/store-admin", createStoreAdminRouter());
  app.route("/admin/service-categories", createAdminCategoryRouter());
  app.route("/service-categories", createPublicCategoryRouter());
  app.route("/admin/stores", createAdminStoreRouter());
  app.route("/store-admin/store", createStoreAdminStoreRouter());
  app.route("/weapp/stores", createPublicStoreRouter());

  // Custom 404 handler (uniform contract)
  app.notFound((c) => {
    throw new BizError("router.not_found", `Route not found: ${c.req.method} ${c.req.path}`, {
      httpStatus: 404,
    });
  });

  return app;
}
