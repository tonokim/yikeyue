import { eq, and, inArray } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { store, storeCategory, serviceCategory, upload } from "../db/schema.js";
import { BizError } from "../errors.js";
import { confirmUpload } from "../storage/upload-intent.js";

function validateReservationRules(rules: {
  granularityMin?: number;
  maxAdvanceDays?: number;
  minAdvanceMin?: number;
  cancelDeadlineMin?: number;
}) {
  if (rules.granularityMin !== undefined && ![15, 30, 60].includes(rules.granularityMin)) {
    throw new BizError("validation.invalid_input", "Granularity must be 15, 30, or 60 minutes", { httpStatus: 400 });
  }
  if (rules.cancelDeadlineMin !== undefined && (rules.cancelDeadlineMin < 0 || rules.cancelDeadlineMin > 1440)) {
    throw new BizError("validation.invalid_input", "Cancel deadline must be between 0 and 1440 minutes (24 hours)", { httpStatus: 400 });
  }
  if (rules.minAdvanceMin !== undefined && rules.minAdvanceMin < 0) {
    throw new BizError("validation.invalid_input", "Minimum advance minutes must be greater than or equal to 0", { httpStatus: 400 });
  }
  if (rules.maxAdvanceDays !== undefined && (rules.maxAdvanceDays < 1 || rules.maxAdvanceDays > 30)) {
    throw new BizError("validation.invalid_input", "Maximum advance days must be between 1 and 30", { httpStatus: 400 });
  }
}

async function validateCategories(db: DatabaseInstance, categoryIds: string[]) {
  for (const catId of categoryIds) {
    const cat = await db
      .select()
      .from(serviceCategory)
      .where(and(eq(serviceCategory.id, catId), eq(serviceCategory.enabled, true)))
      .limit(1);

    if (cat.length === 0) {
      throw new BizError(
        "store.invalid_category",
        `Category with ID '${catId}' does not exist or is disabled`,
        { httpStatus: 400 }
      );
    }
  }
}

async function confirmNewPhotos(db: DatabaseInstance, storeId: string, newPhotos: string[], oldPhotos: string[]) {
  const added = newPhotos.filter((p) => !oldPhotos.includes(p));
  for (const key of added) {
    const records = await db
      .select()
      .from(upload)
      .where(eq(upload.key, key))
      .limit(1);

    if (records.length === 0 || records[0].capability !== "store") {
      throw new BizError(
        "validation.invalid_input",
        `Photo key '${key}' is not a valid upload record for capability 'store'`,
        { httpStatus: 400 }
      );
    }

    const rec = records[0];
    if (rec.status === "pending") {
      await confirmUpload(db, key, storeId, "store");
    } else if (rec.status === "confirmed") {
      if (rec.entityId !== storeId) {
        throw new BizError(
          "validation.invalid_input",
          `Photo key '${key}' is already confirmed and bound to another entity`,
          { httpStatus: 400 }
        );
      }
    }
  }

  const removed = oldPhotos.filter((p) => !newPhotos.includes(p));
  if (removed.length > 0) {
    await db
      .update(upload)
      .set({
        status: "pending",
        entityId: null,
        expiresAt: new Date(0), // Set to epoch so it's guaranteed to be expired and cleaned up
      })
      .where(
        and(
          eq(upload.status, "confirmed"),
          eq(upload.entityId, storeId),
          inArray(upload.key, removed)
        )
      );
  }
}

export async function createStore(
  db: DatabaseInstance,
  data: {
    name: string;
    address: string;
    lat?: number | null;
    lng?: number | null;
    phone: string;
    photos?: string[];
    openAt: string;
    closeAt: string;
    area?: number | null;
    seatCount?: number | null;
    description?: string | null;
    granularityMin?: number;
    maxAdvanceDays?: number;
    minAdvanceMin?: number;
    cancelDeadlineMin?: number;
    noShowThreshold?: number;
    categoryIds?: string[];
  }
): Promise<any> {
  const granularityMin = data.granularityMin ?? 30;
  const maxAdvanceDays = data.maxAdvanceDays ?? 7;
  const minAdvanceMin = data.minAdvanceMin ?? 30;
  const cancelDeadlineMin = data.cancelDeadlineMin ?? 60;
  const noShowThreshold = data.noShowThreshold ?? 3;

  validateReservationRules({
    granularityMin,
    maxAdvanceDays,
    minAdvanceMin,
    cancelDeadlineMin,
  });

  const categoryIds = data.categoryIds ? Array.from(new Set(data.categoryIds)) : [];

  if (categoryIds.length > 0) {
    await validateCategories(db, categoryIds);
  }

  const photosStr = data.photos ? JSON.stringify(data.photos) : "[]";

  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(store)
      .values({
        name: data.name,
        address: data.address,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        phone: data.phone,
        photos: photosStr,
        openAt: data.openAt,
        closeAt: data.closeAt,
        status: "draft",
        area: data.area ?? null,
        seatCount: data.seatCount ?? null,
        description: data.description ?? null,
        granularityMin,
        maxAdvanceDays,
        minAdvanceMin,
        cancelDeadlineMin,
        noShowThreshold,
      })
      .returning();

    const newStore = inserted[0];
    const storeId = newStore.id;

    if (categoryIds.length > 0) {
      await tx.insert(storeCategory).values(
        categoryIds.map((catId) => ({
          storeId,
          categoryId: catId,
        }))
      );
    }

    if (data.photos && data.photos.length > 0) {
      await confirmNewPhotos(tx, storeId, data.photos, []);
    }

    return await getStore(tx, storeId);
  });
}

export async function updateStore(
  db: DatabaseInstance,
  id: string,
  data: {
    name?: string;
    address?: string;
    lat?: number | null;
    lng?: number | null;
    phone?: string;
    photos?: string[];
    openAt?: string;
    closeAt?: string;
    area?: number | null;
    seatCount?: number | null;
    description?: string | null;
    granularityMin?: number;
    maxAdvanceDays?: number;
    minAdvanceMin?: number;
    cancelDeadlineMin?: number;
    noShowThreshold?: number;
    categoryIds?: string[];
  },
  now: Date
): Promise<any> {
  const existing = await db
    .select()
    .from(store)
    .where(eq(store.id, id))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError("store.store_not_found", "Store not found", { httpStatus: 404 });
  }

  const currentStore = existing[0];

  validateReservationRules({
    granularityMin: data.granularityMin,
    maxAdvanceDays: data.maxAdvanceDays,
    minAdvanceMin: data.minAdvanceMin,
    cancelDeadlineMin: data.cancelDeadlineMin,
  });

  const categoryIds = data.categoryIds ? Array.from(new Set(data.categoryIds)) : undefined;

  if (categoryIds && categoryIds.length > 0) {
    await validateCategories(db, categoryIds);
  }

  const updatePayload: any = {};
  if (data.name !== undefined) updatePayload.name = data.name;
  if (data.address !== undefined) updatePayload.address = data.address;
  if (data.lat !== undefined) updatePayload.lat = data.lat;
  if (data.lng !== undefined) updatePayload.lng = data.lng;
  if (data.phone !== undefined) updatePayload.phone = data.phone;
  if (data.openAt !== undefined) updatePayload.openAt = data.openAt;
  if (data.closeAt !== undefined) updatePayload.closeAt = data.closeAt;
  if (data.area !== undefined) updatePayload.area = data.area;
  if (data.seatCount !== undefined) updatePayload.seatCount = data.seatCount;
  if (data.description !== undefined) updatePayload.description = data.description;
  if (data.granularityMin !== undefined) updatePayload.granularityMin = data.granularityMin;
  if (data.maxAdvanceDays !== undefined) updatePayload.maxAdvanceDays = data.maxAdvanceDays;
  if (data.minAdvanceMin !== undefined) updatePayload.minAdvanceMin = data.minAdvanceMin;
  if (data.cancelDeadlineMin !== undefined) updatePayload.cancelDeadlineMin = data.cancelDeadlineMin;
  if (data.noShowThreshold !== undefined) updatePayload.noShowThreshold = data.noShowThreshold;

  if (data.photos !== undefined) {
    updatePayload.photos = JSON.stringify(data.photos);
  }

  updatePayload.updatedAt = now;

  return await db.transaction(async (tx) => {
    await tx
      .update(store)
      .set(updatePayload)
      .where(eq(store.id, id));

    if (categoryIds !== undefined) {
      await tx.delete(storeCategory).where(eq(storeCategory.storeId, id));
      if (categoryIds.length > 0) {
        await tx.insert(storeCategory).values(
          categoryIds.map((catId) => ({
            storeId: id,
            categoryId: catId,
          }))
        );
      }
    }

    if (data.photos !== undefined) {
      let currentPhotos: string[] = [];
      if (currentStore.photos) {
        try {
          currentPhotos = JSON.parse(currentStore.photos);
        } catch {
          currentPhotos = [];
        }
      }
      await confirmNewPhotos(tx, id, data.photos, currentPhotos);
    }

    return await getStore(tx, id);
  });
}

export async function getStore(db: DatabaseInstance, id: string): Promise<any> {
  const existing = await db
    .select()
    .from(store)
    .where(eq(store.id, id))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError("store.store_not_found", "Store not found", { httpStatus: 404 });
  }

  const s = existing[0];

  const categories = await db
    .select({
      id: serviceCategory.id,
      name: serviceCategory.name,
    })
    .from(storeCategory)
    .innerJoin(serviceCategory, eq(storeCategory.categoryId, serviceCategory.id))
    .where(eq(storeCategory.storeId, id));

  return {
    ...s,
    categories,
  };
}

export async function listStores(
  db: DatabaseInstance,
  options?: {
    status?: string;
    categoryId?: string;
    enabledOnly?: boolean;
  }
): Promise<any[]> {
  // Query construction
  const query = db
    .select({
      store,
    })
    .from(store);

  // Apply filters
  const conditions = [];

  if (options?.enabledOnly) {
    conditions.push(eq(store.status, "online"));
  } else if (options?.status) {
    conditions.push(eq(store.status, options.status));
  }

  if (options?.categoryId) {
    // Join with storeCategory
    const storeIdsWithCategory = db
      .select({ storeId: storeCategory.storeId })
      .from(storeCategory)
      .where(eq(storeCategory.categoryId, options.categoryId));

    // We can filter using sql `in` or mapping
    // But in Drizzle, we can do inArray on subquery or dynamic joins.
    conditions.push(inArray(store.id, storeIdsWithCategory));
  }

  // Combine conditions
  let finalQuery;
  if (conditions.length > 0) {
    finalQuery = query.where(and(...conditions));
  } else {
    finalQuery = query;
  }

  const rows = await finalQuery;

  // Map to get categories for each store
  const results = [];
  for (const row of rows) {
    const s = row.store;
    const categories = await db
      .select({
        id: serviceCategory.id,
        name: serviceCategory.name,
      })
      .from(storeCategory)
      .innerJoin(serviceCategory, eq(storeCategory.categoryId, serviceCategory.id))
      .where(eq(storeCategory.storeId, s.id));

    results.push({
      ...s,
      categories,
    });
  }

  return results;
}

export async function updateStoreStatus(
  db: DatabaseInstance,
  id: string,
  status: string,
  now: Date
): Promise<any> {
  if (!["draft", "online", "offline", "frozen"].includes(status)) {
    throw new BizError("validation.invalid_input", "Invalid store status", { httpStatus: 400 });
  }

  const existing = await db
    .select()
    .from(store)
    .where(eq(store.id, id))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError("store.store_not_found", "Store not found", { httpStatus: 404 });
  }

  await db
    .update(store)
    .set({
      status,
      updatedAt: now,
    })
    .where(eq(store.id, id));

  return await getStore(db, id);
}
