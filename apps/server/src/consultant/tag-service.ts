import { eq, and, asc, desc, ne, inArray } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { tag } from "../db/schema.js";
import { BizError } from "../errors.js";

export async function createTag(
  db: DatabaseInstance,
  data: {
    name: string;
    type: "consultant" | "review";
    sortOrder?: number;
    enabled?: boolean;
  }
): Promise<any> {
  // Check unique (type, name)
  const existing = await db
    .select()
    .from(tag)
    .where(and(eq(tag.type, data.type), eq(tag.name, data.name)))
    .limit(1);

  if (existing.length > 0) {
    throw new BizError("tag.name_exists", `Tag name '${data.name}' already exists for type '${data.type}'`, {
      httpStatus: 400,
    });
  }

  const inserted = await db
    .insert(tag)
    .values({
      name: data.name,
      type: data.type,
      sortOrder: data.sortOrder ?? 0,
      enabled: data.enabled ?? true,
    })
    .returning();

  return inserted[0];
}

export async function updateTag(
  db: DatabaseInstance,
  id: string,
  data: {
    name?: string;
    type?: "consultant" | "review";
    sortOrder?: number;
    enabled?: boolean;
  },
  now: Date
): Promise<any> {
  const existing = await db.select().from(tag).where(eq(tag.id, id)).limit(1);
  if (existing.length === 0) {
    throw new BizError("tag.tag_not_found", "Tag not found", { httpStatus: 404 });
  }

  const name = data.name ?? existing[0].name;
  const type = data.type ?? (existing[0].type as "consultant" | "review");

  if (data.name !== undefined || data.type !== undefined) {
    const duplicate = await db
      .select()
      .from(tag)
      .where(and(eq(tag.type, type), eq(tag.name, name), ne(tag.id, id)))
      .limit(1);

    if (duplicate.length > 0) {
      throw new BizError("tag.name_exists", `Tag name '${name}' already exists for type '${type}'`, {
        httpStatus: 400,
      });
    }
  }

  const updatePayload: any = {
    updatedAt: now,
  };
  if (data.name !== undefined) updatePayload.name = data.name;
  if (data.type !== undefined) updatePayload.type = data.type;
  if (data.sortOrder !== undefined) updatePayload.sortOrder = data.sortOrder;
  if (data.enabled !== undefined) updatePayload.enabled = data.enabled;

  const updated = await db
    .update(tag)
    .set(updatePayload)
    .where(eq(tag.id, id))
    .returning();

  return updated[0];
}

export async function listTags(
  db: DatabaseInstance,
  options?: {
    type?: "consultant" | "review";
    enabled?: boolean;
  }
): Promise<any[]> {
  const conditions = [];
  if (options?.type) {
    conditions.push(eq(tag.type, options.type));
  }
  if (options?.enabled !== undefined) {
    conditions.push(eq(tag.enabled, options.enabled));
  }

  return await db
    .select()
    .from(tag)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(tag.sortOrder), desc(tag.createdAt));
}

/**
 * Validates list of tag IDs for consultant binding.
 * Tag must exist, be enabled, and be of type = consultant.
 */
export async function validateConsultantTags(db: DatabaseInstance, tagIds: string[]): Promise<void> {
  if (!tagIds || tagIds.length === 0) return;

  const rows = await db
    .select()
    .from(tag)
    .where(inArray(tag.id, tagIds));

  const valid = new Set(rows.filter((t) => t.enabled && t.type === "consultant").map((t) => t.id));
  const invalid = tagIds.find((id) => !valid.has(id));
  if (invalid) {
    throw new BizError("consultant.invalid_tag", `Tag ID '${invalid}' is invalid, disabled, or not a consultant tag`, {
      httpStatus: 400,
    });
  }
}
