import { z } from "zod";

/**
 * Zod schema for replacing services bound to a consultant.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const replaceServicesRequestSchema = z
  .object({
    service_ids: z.array(z.string().min(1, "Service ID cannot be empty")).max(200, "Cannot bind more than 200 services at once"),
  })
  .transform((val) => ({
    serviceIds: val.service_ids,
  }));

export type ReplaceServicesRequest = z.output<typeof replaceServicesRequestSchema>;

/**
 * Zod schema for store-admin services list item (contains status/inactive info).
 * Transforms server camelCase to snake_case for API consumers.
 */
export const serviceListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    priceCents: z.number().int(),
    currency: z.string(),
    durationMinutes: z.number().int(),
    categoryId: z.string(),
    status: z.string(),
  })
  .transform((val) => ({
    id: val.id,
    name: val.name,
    price_cents: val.priceCents,
    currency: val.currency,
    duration_minutes: val.durationMinutes,
    category_id: val.categoryId,
    status: val.status,
  }));

export type ServiceListItem = z.output<typeof serviceListItemSchema>;

export const serviceListItemClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  currency: z.string(),
  duration_minutes: z.number().int(),
  category_id: z.string(),
  status: z.string(),
});

export type ServiceListItemClient = z.infer<typeof serviceListItemClientSchema>;

/**
 * Zod schema for weapp services list item (does not contain status field).
 * Transforms server camelCase to snake_case for API consumers.
 */
export const weappServiceListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    priceCents: z.number().int(),
    currency: z.string(),
    durationMinutes: z.number().int(),
    categoryId: z.string(),
  })
  .transform((val) => ({
    id: val.id,
    name: val.name,
    price_cents: val.priceCents,
    currency: val.currency,
    duration_minutes: val.durationMinutes,
    category_id: val.categoryId,
  }));

export type WeappServiceListItem = z.output<typeof weappServiceListItemSchema>;

export const weappServiceListItemClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  currency: z.string(),
  duration_minutes: z.number().int(),
  category_id: z.string(),
});

export type WeappServiceListItemClient = z.infer<typeof weappServiceListItemClientSchema>;

/**
 * Zod schema for store-admin consultant list item.
 * Excludes user.id and openid, returns standard fields.
 * Transforms server camelCase to snake_case for API consumers.
 */
export const consultantListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatar: z.string().nullable(),
    level: z.string(),
  })
  .transform((val) => ({
    id: val.id,
    name: val.name,
    avatar: val.avatar ?? null,
    level: val.level,
  }));

export type ConsultantListItem = z.output<typeof consultantListItemSchema>;

export const consultantListItemClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  level: z.string(),
});

export type ConsultantListItemClient = z.infer<typeof consultantListItemClientSchema>;

/**
 * Zod schema for weapp consultant list item.
 * Excludes user.id and openid.
 * Transforms server camelCase to snake_case for API consumers.
 */
export const weappConsultantListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatar: z.string().nullable(),
    level: z.string(),
  })
  .transform((val) => ({
    id: val.id,
    name: val.name,
    avatar: val.avatar ?? null,
    level: val.level,
  }));

export type WeappConsultantListItem = z.output<typeof weappConsultantListItemSchema>;

export const weappConsultantListItemClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  level: z.string(),
});

export type WeappConsultantListItemClient = z.infer<typeof weappConsultantListItemClientSchema>;
