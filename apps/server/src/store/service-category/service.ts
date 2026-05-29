import { eq, and, asc, desc } from "drizzle-orm";
import { DatabaseInstance } from "../../db/index.js";
import { serviceCategory } from "../../db/schema.js";
import { BizError } from "../../errors.js";

export async function createServiceCategory(
  db: DatabaseInstance,
  data: {
    name: string;
    sortOrder?: number;
    enabled?: boolean;
  }
): Promise<any> {
  // Check unique name
  const existing = await db
    .select()
    .from(serviceCategory)
    .where(eq(serviceCategory.name, data.name))
    .limit(1);

  if (existing.length > 0) {
    throw new BizError(
      "store.category_name_exists",
      `Service category with name '${data.name}' already exists`,
      { httpStatus: 400 }
    );
  }

  try {
    const inserted = await db
      .insert(serviceCategory)
      .values({
        name: data.name,
        sortOrder: data.sortOrder ?? 0,
        enabled: data.enabled ?? true,
      })
      .returning();

    return inserted[0];
  } catch (err: any) {
    if (err && (err.code === "23505" || err.constraint?.includes("name"))) {
      throw new BizError(
        "store.category_name_exists",
        `Service category with name '${data.name}' already exists`,
        { httpStatus: 400 }
      );
    }
    throw err;
  }
}

export async function updateServiceCategory(
  db: DatabaseInstance,
  id: string,
  data: {
    name?: string;
    sortOrder?: number;
    enabled?: boolean;
  },
  now: Date
): Promise<any> {
  const existing = await db
    .select()
    .from(serviceCategory)
    .where(eq(serviceCategory.id, id))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError(
      "store.category_not_found",
      "Service category not found",
      { httpStatus: 404 }
    );
  }

  if (data.name && data.name !== existing[0].name) {
    const duplicate = await db
      .select()
      .from(serviceCategory)
      .where(and(eq(serviceCategory.name, data.name)))
      .limit(1);

    if (duplicate.length > 0) {
      throw new BizError(
        "store.category_name_exists",
        `Service category with name '${data.name}' already exists`,
        { httpStatus: 400 }
      );
    }
  }

  try {
    const updated = await db
      .update(serviceCategory)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(serviceCategory.id, id))
      .returning();

    return updated[0];
  } catch (err: any) {
    if (err && (err.code === "23505" || err.constraint?.includes("name"))) {
      throw new BizError(
        "store.category_name_exists",
        `Service category with name '${data.name}' already exists`,
        { httpStatus: 400 }
      );
    }
    throw err;
  }
}

export async function listServiceCategories(
  db: DatabaseInstance,
  options?: { enabledOnly?: boolean }
): Promise<any[]> {
  const query = db
    .select()
    .from(serviceCategory)
    .orderBy(asc(serviceCategory.sortOrder), desc(serviceCategory.createdAt));

  if (options?.enabledOnly) {
    return await query.where(eq(serviceCategory.enabled, true));
  }

  return await query;
}
