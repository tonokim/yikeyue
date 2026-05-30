import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { consultant, consultantTag, tag, user, store } from "../db/schema.js";
import { findUserByUidInternal } from "../user/uid.js";
import { validateConsultantTags } from "./tag-service.js";
import { notify } from "../wechat/subscribe.js";
import { logger } from "../logger/index.js";
import { BizError } from "../errors.js";
import { shanghaiDate } from "../utils/date.js";

export interface ConsultantDetail {
  id: string;
  storeId: string;
  name: string;
  avatar: string | null;
  experienceYears: number;
  level: string;
  rating: number;
  status: string;
  autoConfirm: boolean;
  createdAt: Date;
  updatedAt: Date;
  userUid: string;
  tags: {
    id: string;
    name: string;
    type: "consultant" | "review";
    sortOrder: number;
    enabled: boolean;
  }[];
}

export async function addConsultant(
  db: DatabaseInstance,
  storeId: string,
  data: {
    uid: string;
    name: string;
    avatar?: string | null;
    experienceYears: number;
    level: string;
    tagIds?: string[];
  },
  now: Date
): Promise<ConsultantDetail> {
  // 1. Resolve user by UID
  let targetUser;
  try {
    targetUser = await findUserByUidInternal(db, data.uid);
  } catch (err) {
    if (err instanceof BizError && err.code === "user.not_found") {
      throw new BizError("consultant.user_not_found", `User with UID '${data.uid}' not found`, { httpStatus: 404 });
    }
    throw err;
  }

  // Deduplicate tagIds to prevent primary key collision
  const tagIds = data.tagIds ? Array.from(new Set(data.tagIds)) : [];

  // 2. Create consultant inside a transaction
  let newConsultant;
  try {
    newConsultant = await db.transaction(async (tx) => {
      // Check unique constraint inside tx
      const existing = await tx
        .select()
        .from(consultant)
        .where(and(eq(consultant.userId, targetUser.id), eq(consultant.storeId, storeId)))
        .limit(1);

      if (existing.length > 0) {
        throw new BizError("consultant.already_bound", "User is already bound as a consultant in this store", {
          httpStatus: 409,
        });
      }

      // 3. Validate consultant tags inside transaction
      if (tagIds.length > 0) {
        await validateConsultantTags(tx, tagIds);
      }

      const inserted = await tx
        .insert(consultant)
        .values({
          userId: targetUser.id,
          storeId,
          name: data.name,
          avatar: data.avatar ?? null,
          experienceYears: data.experienceYears,
          level: data.level,
          rating: 0,
          status: "active",
          autoConfirm: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const cObj = inserted[0];

      if (tagIds.length > 0) {
        await tx.insert(consultantTag).values(
          tagIds.map((tagId) => ({
            consultantId: cObj.id,
            tagId,
          }))
        );
      }

      return cObj;
    });
  } catch (err: any) {
    if (err && err.constraint === "consultant_user_store_unique") {
      throw new BizError("consultant.already_bound", "User is already bound as a consultant in this store", {
        httpStatus: 409,
      });
    }
    throw err;
  }

  // 5. Send WeChat notification asynchronously
  const openid = targetUser.openid;

  const storeResult = await db
    .select({ name: store.name })
    .from(store)
    .where(eq(store.id, storeId))
    .limit(1);
  const storeName = storeResult[0]?.name || "";

  if (openid) {
    const today = shanghaiDate(now);

    await notify
      .send("consultant.bound", openid, {
        storeId,
        storeName,
        consultantName: data.name,
        date: today,
      })
      .catch((err) => {
        logger.error({ err }, "Failed to send consultant.bound notification");
      });
  }

  return await getConsultantDetail(db, newConsultant.id, storeId);
}

export async function updateConsultant(
  db: DatabaseInstance,
  id: string,
  storeId: string,
  data: {
    name?: string;
    avatar?: string | null;
    experienceYears?: number;
    level?: string;
    tagIds?: string[];
  },
  now: Date
): Promise<ConsultantDetail> {
  const tagIds = data.tagIds ? Array.from(new Set(data.tagIds)) : undefined;

  return await db.transaction(async (tx) => {
    // 1. Verify existence & store ownership
    const existing = await tx
      .select()
      .from(consultant)
      .where(and(eq(consultant.id, id), eq(consultant.storeId, storeId)))
      .limit(1);

    if (existing.length === 0 || existing[0].status === "left") {
      throw new BizError("consultant.consultant_not_found", "Consultant not found", { httpStatus: 404 });
    }

    // 2. Validate tags if provided
    if (tagIds !== undefined) {
      await validateConsultantTags(tx, tagIds);
    }

    // 3. Update consultant properties
    const updatePayload: any = {
      updatedAt: now,
    };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.avatar !== undefined) updatePayload.avatar = data.avatar;
    if (data.experienceYears !== undefined) updatePayload.experienceYears = data.experienceYears;
    if (data.level !== undefined) updatePayload.level = data.level;

    await tx
      .update(consultant)
      .set(updatePayload)
      .where(eq(consultant.id, id));

    // 4. Update tags mapping if provided
    if (tagIds !== undefined) {
      // Delete existing
      await tx.delete(consultantTag).where(eq(consultantTag.consultantId, id));
      // Insert new
      if (tagIds.length > 0) {
        await tx.insert(consultantTag).values(
          tagIds.map((tagId) => ({
            consultantId: id,
            tagId,
          }))
        );
      }
    }

    // 5. Return updated object (re-fetch with user uid and tags)
    return await getConsultantDetail(tx, id, storeId);
  });
}

export async function getConsultantDetail(
  db: DatabaseInstance,
  id: string,
  storeId: string
): Promise<ConsultantDetail> {
  const cResult = await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
      name: consultant.name,
      avatar: consultant.avatar,
      experienceYears: consultant.experienceYears,
      level: consultant.level,
      rating: consultant.rating,
      status: consultant.status,
      autoConfirm: consultant.autoConfirm,
      createdAt: consultant.createdAt,
      updatedAt: consultant.updatedAt,
      userUid: user.uid,
    })
    .from(consultant)
    .innerJoin(user, eq(consultant.userId, user.id))
    .where(and(eq(consultant.id, id), eq(consultant.storeId, storeId)))
    .limit(1);

  if (cResult.length === 0) {
    throw new BizError("consultant.consultant_not_found", "Consultant not found", { httpStatus: 404 });
  }

  const cObj = cResult[0];

  // Fetch tags
  const tagsResult = await db
    .select({
      id: tag.id,
      name: tag.name,
      type: tag.type,
      sortOrder: tag.sortOrder,
      enabled: tag.enabled,
    })
    .from(consultantTag)
    .innerJoin(tag, eq(consultantTag.tagId, tag.id))
    .where(eq(consultantTag.consultantId, id))
    .orderBy(asc(tag.sortOrder), desc(tag.createdAt));

  return {
    ...cObj,
    tags: tagsResult.map((t) => ({
      ...t,
      type: t.type as "consultant" | "review",
    })),
  };
}

export async function listConsultants(
  db: DatabaseInstance,
  storeId: string,
  options?: {
    status?: string;
  }
): Promise<ConsultantDetail[]> {
  const conditions = [eq(consultant.storeId, storeId)];
  if (options?.status) {
    conditions.push(eq(consultant.status, options.status));
  }

  const results = await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
      name: consultant.name,
      avatar: consultant.avatar,
      experienceYears: consultant.experienceYears,
      level: consultant.level,
      rating: consultant.rating,
      status: consultant.status,
      autoConfirm: consultant.autoConfirm,
      createdAt: consultant.createdAt,
      updatedAt: consultant.updatedAt,
      userUid: user.uid,
    })
    .from(consultant)
    .innerJoin(user, eq(consultant.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(consultant.createdAt));

  if (results.length === 0) {
    return [];
  }

  const consultantIds = results.map((r) => r.id);

  // Fetch all tags for these consultants in a single query (optimized N+1)
  const allTags = await db
    .select({
      consultantId: consultantTag.consultantId,
      id: tag.id,
      name: tag.name,
      type: tag.type,
      sortOrder: tag.sortOrder,
      enabled: tag.enabled,
    })
    .from(consultantTag)
    .innerJoin(tag, eq(consultantTag.tagId, tag.id))
    .where(inArray(consultantTag.consultantId, consultantIds))
    .orderBy(asc(tag.sortOrder), desc(tag.createdAt));

  // Map consultantId to their tags
  const tagsMap = new Map<
    string,
    Array<{
      id: string;
      name: string;
      type: "consultant" | "review";
      sortOrder: number;
      enabled: boolean;
    }>
  >();

  for (const t of allTags) {
    if (!tagsMap.has(t.consultantId)) {
      tagsMap.set(t.consultantId, []);
    }
    tagsMap.get(t.consultantId)!.push({
      id: t.id,
      name: t.name,
      type: t.type as "consultant" | "review",
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    });
  }

  return results.map((item) => ({
    ...item,
    tags: tagsMap.get(item.id) || [],
  }));
}

export async function softUnbindConsultant(
  db: DatabaseInstance,
  id: string,
  storeId: string,
  now: Date
): Promise<void> {
  // 1. Verify existence & ownership
  const existing = await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
      userId: consultant.userId,
      name: consultant.name,
      status: consultant.status,
    })
    .from(consultant)
    .where(and(eq(consultant.id, id), eq(consultant.storeId, storeId)))
    .limit(1);

  if (existing.length === 0 || existing[0].status === "left") {
    throw new BizError("consultant.consultant_not_found", "Consultant not found", { httpStatus: 404 });
  }

  // 2. Set status to 'left'
  await db
    .update(consultant)
    .set({
      status: "left",
      updatedAt: now,
    })
    .where(eq(consultant.id, id));

  // 3. Retrieve user openid and store name in a single query
  const details = await db
    .select({
      openid: user.openid,
      storeName: store.name,
    })
    .from(user)
    .innerJoin(store, eq(store.id, storeId))
    .where(eq(user.id, existing[0].userId))
    .limit(1);

  const openid = details[0]?.openid;
  const storeName = details[0]?.storeName || "";

  if (openid) {
    const today = shanghaiDate(now);

    await notify
      .send("consultant.unbound", openid, {
        storeId,
        storeName,
        consultantName: existing[0].name,
        date: today,
      })
      .catch((err) => {
        logger.error({ err }, "Failed to send consultant.unbound notification");
      });
  }
}

export async function listMyConsultantProfiles(db: DatabaseInstance, userId: string): Promise<any[]> {
  return await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
      name: consultant.name,
      avatar: consultant.avatar,
      experienceYears: consultant.experienceYears,
      level: consultant.level,
      rating: consultant.rating,
      status: consultant.status,
      autoConfirm: consultant.autoConfirm,
      createdAt: consultant.createdAt,
      updatedAt: consultant.updatedAt,
      store: {
        id: store.id,
        name: store.name,
      },
    })
    .from(consultant)
    .innerJoin(store, eq(consultant.storeId, store.id))
    .where(eq(consultant.userId, userId))
    .orderBy(desc(consultant.createdAt));
}
