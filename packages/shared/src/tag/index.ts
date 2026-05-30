import { z } from "zod";

/**
 * Zod schema for creating a tag.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const createTagRequestSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255),
    type: z.enum(["consultant", "review"]),
    sort_order: z.number().int().default(0),
    enabled: z.boolean().default(true),
  })
  .transform((val) => ({
    name: val.name,
    type: val.type,
    sortOrder: val.sort_order,
    enabled: val.enabled,
  }));

export type CreateTagRequest = z.output<typeof createTagRequestSchema>;

/**
 * Zod schema for updating a tag.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const updateTagRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    type: z.enum(["consultant", "review"]).optional(),
    sort_order: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .transform((val) => ({
    name: val.name,
    type: val.type,
    sortOrder: val.sort_order,
    enabled: val.enabled,
  }));

export type UpdateTagRequest = z.output<typeof updateTagRequestSchema>;

/**
 * Zod schema for tag responses.
 * Transforms server camelCase to snake_case for API consumers.
 */
export const tagResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    sortOrder: z.number().int(),
    enabled: z.boolean(),
    createdAt: z.date().or(z.string()),
    updatedAt: z.date().or(z.string()),
  })
  .transform((val) => ({
    id: val.id,
    name: val.name,
    type: val.type,
    sort_order: val.sortOrder,
    enabled: val.enabled,
    created_at: typeof val.createdAt === "string" ? val.createdAt : val.createdAt.toISOString(),
    updated_at: typeof val.updatedAt === "string" ? val.updatedAt : val.updatedAt.toISOString(),
  }));

export type TagResponse = z.output<typeof tagResponseSchema>;

export const tagClientResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  sort_order: z.number().int(),
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type TagClientResponse = z.infer<typeof tagClientResponseSchema>;
