import { createMiddleware } from "hono/factory";
import { createId } from "@paralleldrive/cuid2";
import { AppEnv } from "../types.js";

/**
 * Request ID Middleware.
 * Design Invariant: Generates a unique 'req_<cuid2>' for each request,
 * writes 'X-Request-Id' response header, and injects 'c.var.requestId'.
 */
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const reqId = `req_${createId()}`;
  c.set("requestId", reqId);
  c.header("X-Request-Id", reqId);
  await next();
});
