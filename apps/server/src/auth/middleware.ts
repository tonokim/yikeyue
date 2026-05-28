import { createMiddleware } from "hono/factory";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { ERROR_CODES } from "@yikey/shared";

/**
 * Middleware to restrict route access to specific roles.
 * Verifies the c.var.user is logged in, has the typ = 'admin',
 * and the user's role is in the allowed roles list.
 */
export function requireRole(allowedRoles: string[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) {
      throw new BizError(ERROR_CODES.AUTH_UNAUTHORIZED, "Unauthorized access", {
        httpStatus: 401,
      });
    }

    if (user.typ !== "admin" || !allowedRoles.includes(user.role)) {
      throw new BizError(ERROR_CODES.AUTH_FORBIDDEN, "Forbidden access", {
        httpStatus: 403,
      });
    }

    await next();
  });
}

/**
 * Middleware to ensure that administrative store roles (store_owner, store_staff)
 * carry a valid storeId in their identity payload.
 * Blocks if a store role has a missing or empty storeId.
 */
export const requireStoreScope = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user;
  if (!user) {
    throw new BizError(ERROR_CODES.AUTH_UNAUTHORIZED, "Unauthorized access", {
      httpStatus: 401,
    });
  }

  // Only validate store roles (store_owner, store_staff)
  if (user.role === "store_owner" || user.role === "store_staff") {
    if (!user.storeId) {
      throw new BizError(ERROR_CODES.AUTH_FORBIDDEN, "Forbidden: Store role requires a valid store ID scope", {
        httpStatus: 403,
      });
    }
  }

  await next();
});
