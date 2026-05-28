import { eq, and } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { upload } from "../db/schema.js";
import { BizError } from "../errors.js";

/**
 * Confirms an upload by setting its status from 'pending' to 'confirmed'.
 * Optionally associates/backfills the concrete business entity ID.
 */
export async function confirmUpload(
  db: DatabaseInstance,
  key: string,
  entityId?: string | null
): Promise<void> {
  const updateData: Partial<typeof upload.$inferInsert> & { updatedAt: Date } = {
    status: "confirmed",
    updatedAt: new Date(),
  };

  if (entityId !== undefined && entityId !== null) {
    updateData.entityId = entityId;
  }

  const updatedRows = await db
    .update(upload)
    .set(updateData)
    .where(and(eq(upload.key, key), eq(upload.status, "pending")))
    .returning();

  if (updatedRows.length === 0) {
    throw new BizError(
      "storage.intent_not_found",
      "Upload intent not found or already confirmed",
      { httpStatus: 400 }
    );
  }
}
