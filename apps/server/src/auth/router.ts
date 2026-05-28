import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { SignJWT } from "jose";
import {
  adminLoginRequestSchema,
  adminLoginResponseSchema,
  changePasswordRequestSchema,
  adminUserQueryResponseSchema,
} from "@yikey/shared";
import { authenticateAdminUser, changePassword } from "./service.js";
import { requireRole, requireStoreScope } from "./middleware.js";
import { findUserByUid } from "../user/uid.js";

/**
 * Generate a signed access JWT token containing UserPayload for admin.
 */
async function generateAdminAccessToken(
  adminUserId: string,
  role: string,
  storeId: string | null,
  jwtSecret: string
): Promise<string> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  return await new SignJWT({
    id: adminUserId,
    role,
    storeId,
    typ: "admin",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminUserId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey);
}

export function createAdminAuthRouter(jwtSecret: string) {
  const router = new Hono<AppEnv>();

  // 1. POST /admin/auth/login
  router.post("/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parseResult = adminLoginRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid credentials format", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const { phone, password } = parseResult.data;
    const db = c.var.db;

    const user = await authenticateAdminUser(db, phone, password);
    const token = await generateAdminAccessToken(user.id, user.role, user.storeId, jwtSecret);

    const responsePayload = adminLoginResponseSchema.parse({
      token,
      role: user.role,
      storeId: user.storeId,
    });

    return c.json(responsePayload);
  });

  // 2. POST /admin/auth/password
  router.post("/password", requireRole(["super_admin", "store_owner", "store_staff"]), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parseResult = changePasswordRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid password change format", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const { oldPassword, newPassword } = parseResult.data;
    const db = c.var.db;
    const now = c.var.now;
    const currentUser = c.var.user!;

    await changePassword(db, currentUser.id, oldPassword, newPassword, now);

    return c.json({ success: true });
  });

  return router;
}

export function createStoreAdminRouter() {
  const router = new Hono<AppEnv>();

  // 1. GET /store-admin/users/by-uid
  router.get("/users/by-uid", requireRole(["store_owner", "store_staff"]), requireStoreScope, async (c) => {
    const uid = c.req.query("uid");
    if (!uid) {
      throw new BizError("validation.invalid_input", "Missing uid query parameter", {
        httpStatus: 400,
      });
    }

    const db = c.var.db;
    const dbUser = await findUserByUid(db, uid);

    const responsePayload = adminUserQueryResponseSchema.parse({
      uid: dbUser.uid,
      nickname: dbUser.nickname,
      avatar: dbUser.avatar,
      phone: dbUser.phone,
      city: dbUser.city,
      status: dbUser.status,
    });

    return c.json(responsePayload);
  });

  return router;
}
