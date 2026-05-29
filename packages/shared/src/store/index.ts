import { z } from "zod";

/**
 * Zod schema for creating a service category.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const createCategoryRequestSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255),
    sort_order: z.number().int().default(0),
    enabled: z.boolean().default(true),
  })
  .transform((val) => ({
    name: val.name,
    sortOrder: val.sort_order,
    enabled: val.enabled,
  }));

export type CreateCategoryRequest = z.output<typeof createCategoryRequestSchema>;

/**
 * Zod schema for updating a service category.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const updateCategoryRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    sort_order: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .transform((val) => ({
    name: val.name,
    sortOrder: val.sort_order,
    enabled: val.enabled,
  }));

export type UpdateCategoryRequest = z.output<typeof updateCategoryRequestSchema>;

/**
 * Zod schema for service category responses.
 * Transforms server camelCase to snake_case for API consumers.
 */
export const categoryResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sortOrder: z.number(),
    enabled: z.boolean(),
    createdAt: z.date().or(z.string()),
    updatedAt: z.date().or(z.string()),
  })
  .transform((val) => ({
    id: val.id,
    name: val.name,
    sort_order: val.sortOrder,
    enabled: val.enabled,
    created_at: typeof val.createdAt === "string" ? val.createdAt : val.createdAt.toISOString(),
    updated_at: typeof val.updatedAt === "string" ? val.updatedAt : val.updatedAt.toISOString(),
  }));

export type CategoryResponse = z.output<typeof categoryResponseSchema>;

/**
 * Zod schema for admin creating a store.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const adminCreateStoreRequestSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255),
    address: z.string().min(1, "Address is required").max(500),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    phone: z.string().min(1, "Phone is required").max(50),
    photos: z.array(z.string()).default([]),
    open_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid open_at format (HH:MM or HH:MM:SS)"),
    close_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid close_at format (HH:MM or HH:MM:SS)"),
    area: z.number().int().nullable().optional(),
    seat_count: z.number().int().nullable().optional(),
    description: z.string().nullable().optional(),
    granularity_min: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
    max_advance_days: z.number().int().min(1).max(30).default(7),
    min_advance_min: z.number().int().min(0).default(30),
    cancel_deadline_min: z.number().int().min(0).max(1440).default(60),
    no_show_threshold: z.number().int().min(0).default(3),
    category_ids: z.array(z.string()).default([]),
  })
  .transform((val) => ({
    name: val.name,
    address: val.address,
    lat: val.lat ?? null,
    lng: val.lng ?? null,
    phone: val.phone,
    photos: val.photos,
    openAt: val.open_at,
    closeAt: val.close_at,
    area: val.area ?? null,
    seatCount: val.seat_count ?? null,
    description: val.description ?? null,
    granularityMin: val.granularity_min,
    maxAdvanceDays: val.max_advance_days,
    minAdvanceMin: val.min_advance_min,
    cancelDeadlineMin: val.cancel_deadline_min,
    noShowThreshold: val.no_show_threshold,
    categoryIds: val.category_ids,
  }));

export type AdminCreateStoreRequest = z.output<typeof adminCreateStoreRequestSchema>;

/**
 * Zod schema for admin updating a store.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const adminUpdateStoreRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    address: z.string().min(1).max(500).optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    phone: z.string().min(1).max(50).optional(),
    photos: z.array(z.string()).optional(),
    open_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    close_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    area: z.number().int().nullable().optional(),
    seat_count: z.number().int().nullable().optional(),
    description: z.string().nullable().optional(),
    granularity_min: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
    max_advance_days: z.number().int().min(1).max(30).optional(),
    min_advance_min: z.number().int().min(0).optional(),
    cancel_deadline_min: z.number().int().min(0).max(1440).optional(),
    no_show_threshold: z.number().int().min(0).optional(),
    category_ids: z.array(z.string()).optional(),
  })
  .transform((val) => ({
    name: val.name,
    address: val.address,
    lat: val.lat,
    lng: val.lng,
    phone: val.phone,
    photos: val.photos,
    openAt: val.open_at,
    closeAt: val.close_at,
    area: val.area,
    seatCount: val.seat_count,
    description: val.description,
    granularityMin: val.granularity_min,
    maxAdvanceDays: val.max_advance_days,
    minAdvanceMin: val.min_advance_min,
    cancelDeadlineMin: val.cancel_deadline_min,
    noShowThreshold: val.no_show_threshold,
    categoryIds: val.category_ids,
  }));

export type AdminUpdateStoreRequest = z.output<typeof adminUpdateStoreRequestSchema>;

export const storeOwnerUpdateStoreRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    address: z.string().min(1).max(500).optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    phone: z.string().min(1).max(50).optional(),
    photos: z.array(z.string()).optional(),
    open_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    close_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    area: z.number().int().nullable().optional(),
    seat_count: z.number().int().nullable().optional(),
    description: z.string().nullable().optional(),
    granularity_min: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
    max_advance_days: z.number().int().min(1).max(30).optional(),
    min_advance_min: z.number().int().min(0).optional(),
    cancel_deadline_min: z.number().int().min(0).max(1440).optional(),
    no_show_threshold: z.number().int().min(0).optional(),
    category_ids: z.array(z.string()).optional(),
    status: z.never({
      invalid_type_error: "Status updates are not allowed for store owners",
    }).optional(),
  })
  .transform((val) => ({
    name: val.name,
    address: val.address,
    lat: val.lat,
    lng: val.lng,
    phone: val.phone,
    photos: val.photos,
    openAt: val.open_at,
    closeAt: val.close_at,
    area: val.area,
    seatCount: val.seat_count,
    description: val.description,
    granularityMin: val.granularity_min,
    maxAdvanceDays: val.max_advance_days,
    minAdvanceMin: val.min_advance_min,
    cancelDeadlineMin: val.cancel_deadline_min,
    noShowThreshold: val.no_show_threshold,
    categoryIds: val.category_ids,
  }));
export type StoreOwnerUpdateStoreRequest = z.output<typeof storeOwnerUpdateStoreRequestSchema>;

/**
 * Zod schema for store responses.
 * Transforms server camelCase to snake_case for API consumers.
 */
export const storeResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    address: z.string(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    phone: z.string(),
    photos: z.array(z.string()).nullable().optional().or(z.string()),
    openAt: z.string(),
    closeAt: z.string(),
    status: z.string(),
    area: z.number().nullable().optional(),
    seatCount: z.number().nullable().optional(),
    description: z.string().nullable().optional(),
    granularityMin: z.number(),
    maxAdvanceDays: z.number(),
    minAdvanceMin: z.number(),
    cancelDeadlineMin: z.number(),
    noShowThreshold: z.number(),
    createdAt: z.date().or(z.string()),
    updatedAt: z.date().or(z.string()),
    categories: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
        })
      )
      .optional(),
  })
  .transform((val) => {
    let photosArr: string[] = [];
    if (Array.isArray(val.photos)) {
      photosArr = val.photos;
    } else if (typeof val.photos === "string" && val.photos) {
      try {
        photosArr = JSON.parse(val.photos);
      } catch {
        photosArr = [];
      }
    }
    return {
      id: val.id,
      name: val.name,
      address: val.address,
      lat: val.lat ?? undefined,
      lng: val.lng ?? undefined,
      phone: val.phone,
      photos: photosArr,
      open_at: val.openAt,
      close_at: val.closeAt,
      status: val.status,
      area: val.area ?? undefined,
      seat_count: val.seatCount ?? undefined,
      description: val.description ?? undefined,
      granularity_min: val.granularityMin,
      max_advance_days: val.maxAdvanceDays,
      min_advance_min: val.minAdvanceMin,
      cancel_deadline_min: val.cancelDeadlineMin,
      no_show_threshold: val.noShowThreshold,
      created_at: typeof val.createdAt === "string" ? val.createdAt : val.createdAt.toISOString(),
      updated_at: typeof val.updatedAt === "string" ? val.updatedAt : val.updatedAt.toISOString(),
      categories: val.categories?.map((c) => ({ id: c.id, name: c.name })) ?? [],
    };
  });

export type StoreResponse = z.output<typeof storeResponseSchema>;
