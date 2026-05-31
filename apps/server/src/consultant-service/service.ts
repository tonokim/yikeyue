import { eq, and, inArray, asc } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { consultant, service, consultantService, store } from "../db/schema.js";
import { ERROR_CODES } from "@yikey/shared";
import { BizError } from "../errors.js";

/**
 * Service representing a service item with standard properties.
 */
export interface ServiceItemDetail {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  durationMinutes: number;
  categoryId: string;
  status: string;
}

/**
 * Consultant detail for listing
 */
export interface ConsultantItemDetail {
  id: string;
  name: string;
  avatar: string | null;
  level: string;
}

/**
 * Replace a consultant's bound services.
 * Performs differential updates (insert new, delete removed) inside a single transaction.
 */
export async function replaceServices(
  db: DatabaseInstance,
  storeId: string,
  consultantId: string,
  serviceIds: string[]
): Promise<ServiceItemDetail[]> {
  const uniqueServiceIds = Array.from(new Set(serviceIds));

  return await db.transaction(async (tx) => {
    // 1. Verify consultant exists, belongs to this store and has not left
    const cResult = await tx
      .select({
        id: consultant.id,
        storeId: consultant.storeId,
        status: consultant.status,
      })
      .from(consultant)
      .where(and(eq(consultant.id, consultantId), eq(consultant.storeId, storeId)))
      .limit(1);

    if (cResult.length === 0) {
      throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_CONSULTANT_NOT_FOUND, "Consultant not found", { httpStatus: 404 });
    }
    if (cResult[0].status === "left") {
      throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_CONSULTANT_LEFT, "Consultant has left", { httpStatus: 409 });
    }

    // 2. Verify all target services exist, belong to this store and are active
    if (uniqueServiceIds.length > 0) {
      const services = await tx
        .select({
          id: service.id,
          storeId: service.storeId,
          status: service.status,
        })
        .from(service)
        .where(inArray(service.id, uniqueServiceIds));

      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const missingIds: string[] = [];
      const inactiveIds: string[] = [];

      for (const sId of uniqueServiceIds) {
        const sObj = serviceMap.get(sId);
        if (!sObj || sObj.storeId !== storeId) {
          missingIds.push(sId);
        } else if (sObj.status !== "active") {
          inactiveIds.push(sId);
        }
      }

      if (missingIds.length > 0) {
        throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_SERVICE_NOT_FOUND, "Service not found", {
          httpStatus: 404,
          details: { missing_ids: missingIds },
        });
      }
      if (inactiveIds.length > 0) {
        throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_SERVICE_INACTIVE, "Service is inactive", {
          httpStatus: 409,
          details: { inactive_ids: inactiveIds },
        });
      }
    }

    // 3. Diff existing bindings
    const existing = await tx
      .select({
        serviceId: consultantService.serviceId,
      })
      .from(consultantService)
      .where(eq(consultantService.consultantId, consultantId));

    const existingServiceIds = existing.map((e) => e.serviceId);

    const toAdd = uniqueServiceIds.filter((id) => !existingServiceIds.includes(id));
    const toDelete = existingServiceIds.filter((id) => !uniqueServiceIds.includes(id));

    // 4. Update Database
    if (toDelete.length > 0) {
      await tx
        .delete(consultantService)
        .where(and(eq(consultantService.consultantId, consultantId), inArray(consultantService.serviceId, toDelete)));
    }

    if (toAdd.length > 0) {
      await tx.insert(consultantService).values(
        toAdd.map((sId) => ({
          consultantId,
          serviceId: sId,
        }))
      ).onConflictDoNothing();
    }

    // 5. Query and return the final bindings list
    return await tx
      .select({
        id: service.id,
        name: service.name,
        priceCents: service.priceCents,
        currency: service.currency,
        durationMinutes: service.durationMinutes,
        categoryId: service.categoryId,
        status: service.status,
      })
      .from(consultantService)
      .innerJoin(service, eq(consultantService.serviceId, service.id))
      .where(eq(consultantService.consultantId, consultantId))
      .orderBy(asc(service.sortOrder), asc(service.id));
  });
}

/**
 * Remove a single service binding for a consultant.
 */
export async function unbind(
  db: DatabaseInstance,
  storeId: string,
  consultantId: string,
  serviceId: string
): Promise<void> {
  // Verify consultant belongs to this store
  const cResult = await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
    })
    .from(consultant)
    .where(and(eq(consultant.id, consultantId), eq(consultant.storeId, storeId)))
    .limit(1);

  if (cResult.length === 0) {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_CONSULTANT_NOT_FOUND, "Consultant not found", { httpStatus: 404 });
  }

  // Verify service belongs to this store
  const sResult = await db
    .select({
      id: service.id,
      storeId: service.storeId,
    })
    .from(service)
    .where(and(eq(service.id, serviceId), eq(service.storeId, storeId)))
    .limit(1);

  if (sResult.length === 0) {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_SERVICE_NOT_FOUND, "Service not found", { httpStatus: 404 });
  }

  await db
    .delete(consultantService)
    .where(and(eq(consultantService.consultantId, consultantId), eq(consultantService.serviceId, serviceId)));
}

/**
 * List store-admin bound services for a consultant.
 */
export async function listServicesByConsultantForStoreAdmin(
  db: DatabaseInstance,
  storeId: string,
  consultantId: string
): Promise<ServiceItemDetail[]> {
  const cResult = await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
    })
    .from(consultant)
    .where(and(eq(consultant.id, consultantId), eq(consultant.storeId, storeId)))
    .limit(1);

  if (cResult.length === 0) {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_CONSULTANT_NOT_FOUND, "Consultant not found", { httpStatus: 404 });
  }

  return await db
    .select({
      id: service.id,
      name: service.name,
      priceCents: service.priceCents,
      currency: service.currency,
      durationMinutes: service.durationMinutes,
      categoryId: service.categoryId,
      status: service.status,
    })
    .from(consultantService)
    .innerJoin(service, eq(consultantService.serviceId, service.id))
    .where(eq(consultantService.consultantId, consultantId))
    .orderBy(asc(service.sortOrder), asc(service.id));
}

/**
 * List store-admin active consultants bound to a service.
 */
export async function listConsultantsByServiceForStoreAdmin(
  db: DatabaseInstance,
  storeId: string,
  serviceId: string
): Promise<ConsultantItemDetail[]> {
  const sResult = await db
    .select({
      id: service.id,
      storeId: service.storeId,
    })
    .from(service)
    .where(and(eq(service.id, serviceId), eq(service.storeId, storeId)))
    .limit(1);

  if (sResult.length === 0) {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_SERVICE_NOT_FOUND, "Service not found", { httpStatus: 404 });
  }

  return await db
    .select({
      id: consultant.id,
      name: consultant.name,
      avatar: consultant.avatar,
      level: consultant.level,
    })
    .from(consultantService)
    .innerJoin(consultant, eq(consultantService.consultantId, consultant.id))
    .where(and(eq(consultantService.serviceId, serviceId), eq(consultant.status, "active")))
    .orderBy(asc(consultant.id));
}

/**
 * List active bound consultants for a service on weapp.
 */
export async function listConsultantsByServiceForWeapp(
  db: DatabaseInstance,
  storeId: string,
  serviceId: string
): Promise<ConsultantItemDetail[]> {
  const storeResult = await db
    .select({
      id: store.id,
      status: store.status,
    })
    .from(store)
    .where(eq(store.id, storeId))
    .limit(1);

  if (storeResult.length === 0 || storeResult[0].status !== "online") {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_SERVICE_NOT_FOUND, "Service not found", { httpStatus: 404 });
  }

  const sResult = await db
    .select({
      id: service.id,
      storeId: service.storeId,
      status: service.status,
    })
    .from(service)
    .where(and(eq(service.id, serviceId), eq(service.storeId, storeId), eq(service.status, "active")))
    .limit(1);

  if (sResult.length === 0) {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_SERVICE_NOT_FOUND, "Service not found", { httpStatus: 404 });
  }

  return await db
    .select({
      id: consultant.id,
      name: consultant.name,
      avatar: consultant.avatar,
      level: consultant.level,
    })
    .from(consultantService)
    .innerJoin(consultant, eq(consultantService.consultantId, consultant.id))
    .where(and(eq(consultantService.serviceId, serviceId), eq(consultant.status, "active")))
    .orderBy(asc(consultant.id));
}

/**
 * List active bound services for a consultant on weapp.
 */
export async function listServicesByConsultantForWeapp(
  db: DatabaseInstance,
  consultantId: string
): Promise<Omit<ServiceItemDetail, "status">[]> {
  const cResult = await db
    .select({
      id: consultant.id,
      storeId: consultant.storeId,
      status: consultant.status,
    })
    .from(consultant)
    .where(eq(consultant.id, consultantId))
    .limit(1);

  if (cResult.length === 0 || cResult[0].status !== "active") {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_CONSULTANT_NOT_FOUND, "Consultant not found", { httpStatus: 404 });
  }

  const storeResult = await db
    .select({
      id: store.id,
      status: store.status,
    })
    .from(store)
    .where(eq(store.id, cResult[0].storeId))
    .limit(1);

  if (storeResult.length === 0 || storeResult[0].status !== "online") {
    throw new BizError(ERROR_CODES.CONSULTANT_SERVICE_CONSULTANT_NOT_FOUND, "Consultant not found", { httpStatus: 404 });
  }

  return await db
    .select({
      id: service.id,
      name: service.name,
      priceCents: service.priceCents,
      currency: service.currency,
      durationMinutes: service.durationMinutes,
      categoryId: service.categoryId,
    })
    .from(consultantService)
    .innerJoin(service, eq(consultantService.serviceId, service.id))
    .where(and(eq(consultantService.consultantId, consultantId), eq(service.status, "active")))
    .orderBy(asc(service.sortOrder), asc(service.id));
}
