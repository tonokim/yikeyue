import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import { AppEnv, UserPayload } from "../types.js";
import { BizError } from "../errors.js";
import { ERROR_CODES } from "@yikey/shared";

/**
 * JWT Verification Middleware.
 * Design Invariant: 7.4 - jose/HS256, only verifies and populates c.var.user.
 * Does not block request if missing/invalid (allows public endpoints to proceed).
 */
export function createJwtMiddleware(jwtSecret: string) {
  const secretKey = new TextEncoder().encode(jwtSecret);

  return createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    c.set("user", null);

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const { payload } = await jwtVerify(token, secretKey, {
          algorithms: ["HS256"],
        });
        
        // Assert basic shape compatibility
        if (
          payload &&
          typeof payload.id === "string" &&
          typeof payload.role === "string"
        ) {
          const user: UserPayload = {
            id: payload.id,
            uid: typeof payload.uid === "string" ? payload.uid : undefined,
            role: payload.role,
            storeId: typeof payload.storeId === "string" ? payload.storeId : null,
            typ: typeof payload.typ === "string" ? payload.typ : undefined,
          };
          c.set("user", user);
        }
      } catch (err) {
        const log = c.var.log;
        if (log) {
          log.warn({ err }, "JWT token verification failed");
        }
      }
    }

    await next();
  });
}

/**
 * requireAuth guard middleware.
 * Design Invariant: 7.4 - Blocks unauthenticated requests with 401 auth.unauthorized.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user;
  if (!user) {
    throw new BizError(ERROR_CODES.AUTH_UNAUTHORIZED, "Unauthorized access", {
      httpStatus: 401,
    });
  }
  await next();
});
