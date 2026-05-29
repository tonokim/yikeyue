import { z } from "zod";

/**
 * Zod schema for creating a service item.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const createServiceRequestSchema = z
  .object({
    category_id: z.string().min(1, "category_id is required"),
    name: z.string().min(1, "name is required").max(255),
    price_cents: z.number().int().nonnegative("price_cents must be a non-negative integer"),
    currency: z.literal("CNY").default("CNY"),
    duration_minutes: z.number().int().positive("duration_minutes must be a positive integer"),
    sort_order: z.number().int().default(0),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .transform((val) => ({
    categoryId: val.category_id,
    name: val.name,
    priceCents: val.price_cents,
    currency: val.currency,
    durationMinutes: val.duration_minutes,
    sortOrder: val.sort_order,
    status: val.status,
  }));

export type CreateServiceRequest = z.output<typeof createServiceRequestSchema>;

/**
 * Zod schema for updating a service item.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const updateServiceRequestSchema = z
  .object({
    category_id: z.string().min(1).optional(),
    name: z.string().min(1).max(255).optional(),
    price_cents: z.number().int().nonnegative("price_cents must be a non-negative integer").optional(),
    currency: z.literal("CNY").optional(),
    duration_minutes: z.number().int().positive("duration_minutes must be a positive integer").optional(),
    sort_order: z.number().int().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .transform((val) => ({
    categoryId: val.category_id,
    name: val.name,
    priceCents: val.price_cents,
    currency: val.currency,
    durationMinutes: val.duration_minutes,
    sortOrder: val.sort_order,
    status: val.status,
  }));

export type UpdateServiceRequest = z.output<typeof updateServiceRequestSchema>;

/**
 * Zod schema for service item responses.
 * Transforms server camelCase to snake_case for API consumers.
 */
export const serviceResponseSchema = z
  .object({
    id: z.string(),
    storeId: z.string(),
    categoryId: z.string(),
    name: z.string(),
    priceCents: z.number().int(),
    currency: z.string(),
    durationMinutes: z.number().int(),
    status: z.string(),
    sortOrder: z.number().int(),
    createdAt: z.date().or(z.string()),
    updatedAt: z.date().or(z.string()),
  })
  .transform((val) => ({
    id: val.id,
    store_id: val.storeId,
    category_id: val.categoryId,
    name: val.name,
    price_cents: val.priceCents,
    currency: val.currency,
    duration_minutes: val.durationMinutes,
    status: val.status,
    sort_order: val.sortOrder,
    created_at: typeof val.createdAt === "string" ? val.createdAt : val.createdAt.toISOString(),
    updated_at: typeof val.updatedAt === "string" ? val.updatedAt : val.updatedAt.toISOString(),
  }));

export type ServiceResponse = z.output<typeof serviceResponseSchema>;

export const serviceClientResponseSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  category_id: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  currency: z.string(),
  duration_minutes: z.number().int(),
  status: z.string(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ServiceClientResponse = z.infer<typeof serviceClientResponseSchema>;
