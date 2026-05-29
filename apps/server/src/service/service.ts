import { eq, and, asc, desc } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { service, serviceCategory, storeCategory } from "../db/schema.js";
import { BizError } from "../errors.js";

function validateServiceInputs(data: { priceCents?: number; durationMinutes?: number }) {
  if (data.priceCents !== undefined) {
    if (!Number.isInteger(data.priceCents) || data.priceCents < 0) {
      throw new BizError(
        "validation.invalid_input",
        "Price must be a non-negative integer",
        { httpStatus: 400 }
      );
    }
  }
  if (data.durationMinutes !== undefined) {
    if (!Number.isInteger(data.durationMinutes) || data.durationMinutes <= 0) {
      throw new BizError(
        "validation.invalid_input",
        "Duration minutes must be a positive integer",
        { httpStatus: 400 }
      );
    }
  }
}

async function validateServiceCategory(db: DatabaseInstance, storeId: string, categoryId: string) {
  // 1. Check if global category exists and is enabled
  const cat = await db
    .select()
    .from(serviceCategory)
    .where(and(eq(serviceCategory.id, categoryId), eq(serviceCategory.enabled, true)))
    .limit(1);

  if (cat.length === 0) {
    throw new BizError(
      "service.invalid_category",
      `Service category with ID '${categoryId}' does not exist or is disabled`,
      { httpStatus: 400 }
    );
  }

  // 2. Check if it belongs to store's store_category declarations
  const storeCat = await db
    .select()
    .from(storeCategory)
    .where(and(eq(storeCategory.storeId, storeId), eq(storeCategory.categoryId, categoryId)))
    .limit(1);

  if (storeCat.length === 0) {
    throw new BizError(
      "service.category_not_in_store",
      `Category with ID '${categoryId}' is not declared in store's categories`,
      { httpStatus: 400 }
    );
  }
}

export async function createService(
  db: DatabaseInstance,
  storeId: string,
  data: {
    categoryId: string;
    name: string;
    priceCents: number;
    currency?: string;
    durationMinutes: number;
    sortOrder?: number;
    status?: string;
  }
): Promise<any> {
  validateServiceInputs({
    priceCents: data.priceCents,
    durationMinutes: data.durationMinutes,
  });

  await validateServiceCategory(db, storeId, data.categoryId);

  const inserted = await db
    .insert(service)
    .values({
      storeId,
      categoryId: data.categoryId,
      name: data.name,
      priceCents: data.priceCents,
      currency: data.currency ?? "CNY",
      durationMinutes: data.durationMinutes,
      sortOrder: data.sortOrder ?? 0,
      status: data.status ?? "active",
    })
    .returning();

  return inserted[0];
}

export async function updateService(
  db: DatabaseInstance,
  id: string,
  storeId: string,
  data: {
    categoryId?: string;
    name?: string;
    priceCents?: number;
    currency?: string;
    durationMinutes?: number;
    sortOrder?: number;
    status?: string;
  },
  now: Date
): Promise<any> {
  const existing = await db
    .select()
    .from(service)
    .where(and(eq(service.id, id), eq(service.storeId, storeId)))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError("service.service_not_found", "Service item not found", { httpStatus: 404 });
  }

  validateServiceInputs({
    priceCents: data.priceCents,
    durationMinutes: data.durationMinutes,
  });

  if (data.categoryId !== undefined) {
    await validateServiceCategory(db, storeId, data.categoryId);
  }

  const updatePayload: any = {
    updatedAt: now,
  };
  if (data.categoryId !== undefined) updatePayload.categoryId = data.categoryId;
  if (data.name !== undefined) updatePayload.name = data.name;
  if (data.priceCents !== undefined) updatePayload.priceCents = data.priceCents;
  if (data.currency !== undefined) updatePayload.currency = data.currency;
  if (data.durationMinutes !== undefined) updatePayload.durationMinutes = data.durationMinutes;
  if (data.sortOrder !== undefined) updatePayload.sortOrder = data.sortOrder;
  if (data.status !== undefined) updatePayload.status = data.status;

  const updated = await db
    .update(service)
    .set(updatePayload)
    .where(and(eq(service.id, id), eq(service.storeId, storeId)))
    .returning();

  return updated[0];
}

export async function getService(db: DatabaseInstance, id: string, storeId: string): Promise<any> {
  const result = await db
    .select()
    .from(service)
    .where(and(eq(service.id, id), eq(service.storeId, storeId)))
    .limit(1);

  if (result.length === 0) {
    throw new BizError("service.service_not_found", "Service item not found", { httpStatus: 404 });
  }

  return result[0];
}

export async function listServices(
  db: DatabaseInstance,
  storeId: string,
  options?: {
    status?: string;
  }
): Promise<any[]> {
  const conditions = [eq(service.storeId, storeId)];

  if (options?.status) {
    conditions.push(eq(service.status, options.status));
  }

  return await db
    .select()
    .from(service)
    .where(and(...conditions))
    .orderBy(asc(service.sortOrder), desc(service.createdAt));
}

export async function updateServiceStatus(
  db: DatabaseInstance,
  id: string,
  storeId: string,
  status: string,
  now: Date
): Promise<any> {
  if (!["active", "inactive"].includes(status)) {
    throw new BizError("validation.invalid_input", "Invalid service status", { httpStatus: 400 });
  }

  const existing = await db
    .select()
    .from(service)
    .where(and(eq(service.id, id), eq(service.storeId, storeId)))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError("service.service_not_found", "Service item not found", { httpStatus: 404 });
  }

  const updated = await db
    .update(service)
    .set({
      status,
      updatedAt: now,
    })
    .where(and(eq(service.id, id), eq(service.storeId, storeId)))
    .returning();

  return updated[0];
}

export async function deleteService(db: DatabaseInstance, id: string, storeId: string): Promise<void> {
  const existing = await db
    .select()
    .from(service)
    .where(and(eq(service.id, id), eq(service.storeId, storeId)))
    .limit(1);

  if (existing.length === 0) {
    throw new BizError("service.service_not_found", "Service item not found", { httpStatus: 404 });
  }

  await db
    .delete(service)
    .where(and(eq(service.id, id), eq(service.storeId, storeId)));
}
