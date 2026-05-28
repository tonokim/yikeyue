import { DatabaseInstance } from "../db/index.js";
import { user } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateNextUid } from "./uid.js";
import { BizError } from "../errors.js";

/**
 * Find or create a user by WeChat openid.
 * Under high concurrency, first-time login utilizes PostgreSQL's unique key constraint
 * to prevent duplicate user creation.
 */
export async function findOrCreateUser(db: DatabaseInstance, openid: string, now: Date) {
  // 1. Try to find the user
  const existingUser = await db
    .select()
    .from(user)
    .where(eq(user.openid, openid))
    .limit(1);

  if (existingUser.length > 0) {
    const usr = existingUser[0];
    if (usr.status === "frozen") {
      throw new BizError("auth.user_frozen", "User account is frozen", {
        httpStatus: 403,
      });
    }
    return usr;
  }

  // 2. User does not exist, generate UID and insert in a single transaction
  try {
    return await db.transaction(async (tx) => {
      const uid = await generateNextUid(tx, now);
      const result = await tx
        .insert(user)
        .values({
          openid,
          uid,
          status: "active",
        })
        .returning();

      return result[0];
    });
  } catch (err: any) {
    // Check for PostgreSQL unique violation error code
    if (err && (err.code === "23505" || err.constraint?.includes("openid"))) {
      // Re-query in case of concurrent insert race condition
      const retriedUser = await db
        .select()
        .from(user)
        .where(eq(user.openid, openid))
        .limit(1);

      if (retriedUser.length > 0) {
        const usr = retriedUser[0];
        if (usr.status === "frozen") {
          throw new BizError("auth.user_frozen", "User account is frozen", {
            httpStatus: 403,
          });
        }
        return usr;
      }
    }
    throw err;
  }
}
