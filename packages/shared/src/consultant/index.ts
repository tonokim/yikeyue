import { z } from "zod";

/**
 * Zod schema for adding a consultant.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const addConsultantRequestSchema = z
  .object({
    uid: z.string().min(1, "User UID is required"),
    name: z.string().min(1, "Name is required").max(255),
    avatar: z.string().url().nullable().optional(),
    experience_years: z.number().int().nonnegative("experience_years must be a non-negative integer"),
    level: z.string().min(1, "Level is required").max(100),
    tag_ids: z.array(z.string()).default([]),
  })
  .transform((val) => ({
    uid: val.uid,
    name: val.name,
    avatar: val.avatar ?? null,
    experienceYears: val.experience_years,
    level: val.level,
    tagIds: val.tag_ids,
  }));

export type AddConsultantRequest = z.output<typeof addConsultantRequestSchema>;

/**
 * Zod schema for updating a consultant.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const updateConsultantRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    avatar: z.string().url().nullable().optional(),
    experience_years: z.number().int().nonnegative().optional(),
    level: z.string().min(1).max(100).optional(),
    tag_ids: z.array(z.string()).optional(),
  })
  .transform((val) => ({
    name: val.name,
    avatar: val.avatar,
    experienceYears: val.experience_years,
    level: val.level,
    tagIds: val.tag_ids,
  }));

export type UpdateConsultantRequest = z.output<typeof updateConsultantRequestSchema>;

/**
 * Zod schema for consultant responses.
 * Transforms server camelCase to snake_case for API consumers.
 * Excludes user.id/openid and includes public user_uid.
 */
export const consultantResponseSchema = z
  .object({
    id: z.string(),
    storeId: z.string(),
    name: z.string(),
    avatar: z.string().nullable().optional(),
    experienceYears: z.number().int(),
    level: z.string(),
    rating: z.coerce.number(),
    status: z.string(),
    autoConfirm: z.boolean(),
    createdAt: z.date().or(z.string()),
    updatedAt: z.date().or(z.string()),
    userUid: z.string().optional(),
    tags: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum(["consultant", "review"]),
          sortOrder: z.number().int(),
          enabled: z.boolean(),
        })
      )
      .optional(),
    store: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional()
      .nullable(),
  })
  .transform((val) => ({
    id: val.id,
    store_id: val.storeId,
    name: val.name,
    avatar: val.avatar || null,
    experience_years: val.experienceYears,
    level: val.level,
    rating: val.rating,
    status: val.status,
    auto_confirm: val.autoConfirm,
    created_at: typeof val.createdAt === "string" ? val.createdAt : val.createdAt.toISOString(),
    updated_at: typeof val.updatedAt === "string" ? val.updatedAt : val.updatedAt.toISOString(),
    user_uid: val.userUid,
    tags: val.tags?.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      sort_order: t.sortOrder,
      enabled: t.enabled,
    })) ?? [],
    store: val.store ? { id: val.store.id, name: val.store.name } : undefined,
  }));

export type ConsultantResponse = z.output<typeof consultantResponseSchema>;

export const consultantClientResponseSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  name: z.string(),
  avatar: z.string().nullable().optional(),
  experience_years: z.number().int(),
  level: z.string(),
  rating: z.coerce.number(),
  status: z.string(),
  auto_confirm: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  user_uid: z.string().optional(),
  tags: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(["consultant", "review"]),
        sort_order: z.number().int(),
        enabled: z.boolean(),
      })
    )
    .optional(),
  store: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional()
    .nullable(),
});

export type ConsultantClientResponse = z.infer<typeof consultantClientResponseSchema>;
