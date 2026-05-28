import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { requireAuth } from "../middleware/jwt.js";
import {
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  updateProfileRequestSchema,
} from "@yikey/shared";
import { getWeChatService, WeChatApiError } from "../wechat/index.js";
import { findOrCreateUser } from "./service.js";
import { user } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";

/**
 * Generate a signed access JWT token containing UserPayload.
 */
async function generateAccessToken(userId: string, userUid: string, jwtSecret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  return await new SignJWT({
    id: userId,
    uid: userUid,
    role: "user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey);
}

export function createUserRouter(jwtSecret: string) {
  const router = new Hono<AppEnv>();

  // 1. WeChat code login
  router.post("/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    const parseResult = loginRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid login credentials", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const { code } = parseResult.data;
    const wechat = getWeChatService();

    let openid: string;
    try {
      const session = await wechat.login.code2Session(code);
      openid = session.openid;
    } catch (err) {
      if (err instanceof WeChatApiError) {
        throw new BizError("auth.invalid_code", err.message, { httpStatus: 400 });
      }
      throw err;
    }

    const db = c.var.db;
    const now = c.var.now;

    // Find or create user
    const dbUser = await findOrCreateUser(db, openid, now);

    // Sign JWT
    const token = await generateAccessToken(dbUser.id, dbUser.uid, jwtSecret);

    // Explicitly parse and format the response at the boundary
    const responsePayload = loginResponseSchema.parse({
      accessToken: token,
      user: {
        uid: dbUser.uid,
        nickname: dbUser.nickname,
        avatar: dbUser.avatar,
        phone: dbUser.phone,
        city: dbUser.city,
        status: dbUser.status,
      },
    });

    return c.json(responsePayload);
  });

  // 2. GET /me - Get personal profile details
  router.get("/me", requireAuth, async (c) => {
    const db = c.var.db;
    const currentUserId = c.var.user!.id;

    const result = await db
      .select()
      .from(user)
      .where(eq(user.id, currentUserId))
      .limit(1);

    if (result.length === 0) {
      throw new BizError("user.not_found", "Current logged in user not found", {
        httpStatus: 404,
      });
    }

    const dbUser = result[0];
    const profile = meResponseSchema.parse({
      uid: dbUser.uid,
      nickname: dbUser.nickname,
      avatar: dbUser.avatar,
      phone: dbUser.phone,
      city: dbUser.city,
      status: dbUser.status,
    });

    return c.json(profile);
  });

  // 3. Profile editing (accepts POST /me, POST /me/profile, and PUT /me to be completely robust)
  const updateProfileHandler = async (c: any) => {
    const body = await c.req.json().catch(() => ({}));

    // Zod schema strictly filters out disallowed fields (like uid, status)
    const parseResult = updateProfileRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid profile update inputs", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const updateData: Record<string, any> = {
      updatedAt: c.var.now,
    };

    // Only update nickname and/or avatar if explicitly passed in the request
    if (data.nickname !== undefined) {
      updateData.nickname = data.nickname;
    }
    if (data.avatar !== undefined) {
      updateData.avatar = data.avatar;
    }

    const db = c.var.db;
    const currentUserId = c.var.user.id;

    await db
      .update(user)
      .set(updateData)
      .where(eq(user.id, currentUserId));

    // Return the updated user details
    const result = await db
      .select()
      .from(user)
      .where(eq(user.id, currentUserId))
      .limit(1);

    const dbUser = result[0];
    const profile = meResponseSchema.parse({
      uid: dbUser.uid,
      nickname: dbUser.nickname,
      avatar: dbUser.avatar,
      phone: dbUser.phone,
      city: dbUser.city,
      status: dbUser.status,
    });

    return c.json(profile);
  };

  router.post("/me", requireAuth, updateProfileHandler);
  router.post("/me/profile", requireAuth, updateProfileHandler);
  router.put("/me", requireAuth, updateProfileHandler);

  return router;
}
