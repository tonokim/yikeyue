import { createMiddleware } from "hono/factory";
import { AppEnv } from "../types.js";
import { createChildLogger } from "../logger/index.js";

/**
 * Logger Middleware.
 * Design Invariant: Binds request_id child logger to c.var.log (5.3, 7.2)
 * Logs request method, path, status, latency, and optional user identifiers on completion (7.2, 11.1)
 * Does not log full request/response bodies at info level (11.1)
 */
export const loggerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const reqId = c.var.requestId;
  if (!reqId) {
    throw new Error("requestId must be initialized before running the logger middleware");
  }

  const childLogger = createChildLogger(reqId);
  c.set("log", childLogger);

  const start = Date.now();
  await next();
  const latency = Date.now() - start;

  const user = c.var.user;
  const logData: Record<string, any> = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    latency_ms: latency,
  };
  
  if (user) {
    logData.user_id = user.id;
    logData.uid = user.uid;
  }

  // Enforce no-body logging at info level
  childLogger.info(logData, `${c.req.method} ${c.req.path} completed with status ${c.res.status}`);
});
