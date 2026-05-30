import { DatabaseInstance } from "../db/index.js";
import { uidSequence, user } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";
import { BizError } from "../errors.js";

/**
 * Generates a unique, atomic variable-length UID for a new user.
 * Format: EKY + YYYY + at least 6-digit zero-padded sequence.
 * Increments the yearly sequence atomicaly inside a transaction.
 */
export async function generateNextUid(db: DatabaseInstance, now: Date): Promise<string> {
  const year = now.getFullYear();

  return await db.transaction(async (tx) => {
    const result = await tx
      .insert(uidSequence)
      .values({ year, lastSeq: 1 })
      .onConflictDoUpdate({
        target: uidSequence.year,
        set: { lastSeq: sql`${uidSequence.lastSeq} + 1` },
      })
      .returning({ lastSeq: uidSequence.lastSeq });

    if (!result || result.length === 0) {
      throw new Error("Failed to generate sequence for UID");
    }

    const lastSeq = result[0].lastSeq;
    const seqStr = String(lastSeq).padStart(6, "0");
    return `EKY${year}${seqStr}`;
  });
}

/**
 * Look up user profile details by UID.
 * Returns profile details (including internal ID for backend use, but strictly omitting WeChat openid).
 * Throws a BizError if the user is not found.
 */
export async function findUserByUid(db: DatabaseInstance, uid: string) {
  const result = await db
    .select({
      id: user.id,
      uid: user.uid,
      nickname: user.nickname,
      avatar: user.avatar,
      phone: user.phone,
      city: user.city,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(eq(user.uid, uid))
    .limit(1);

  if (result.length === 0) {
    throw new BizError("user.not_found", `User with UID '${uid}' not found`, {
      httpStatus: 404,
    });
  }

  return result[0];
}

/**
 * Internal-only helper to look up user details by UID, including WeChat openid.
 */
export async function findUserByUidInternal(db: DatabaseInstance, uid: string) {
  const result = await db
    .select({
      id: user.id,
      openid: user.openid,
      uid: user.uid,
      nickname: user.nickname,
      avatar: user.avatar,
      phone: user.phone,
      city: user.city,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(eq(user.uid, uid))
    .limit(1);

  if (result.length === 0) {
    throw new BizError("user.not_found", `User with UID '${uid}' not found`, {
      httpStatus: 404,
    });
  }

  return result[0];
}
