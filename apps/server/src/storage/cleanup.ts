import { eq, and, lt } from "drizzle-orm";
import { DatabaseInstance } from "../db/index.js";
import { upload } from "../db/schema.js";
import { QiniuClient } from "./client.js";
import { getUploadPolicy } from "./policy.js";
import { logger } from "../logger/index.js";

/**
 * Service to clean up expired pending upload intent records (orphans).
 * Deletes corresponding files from Qiniu Kodo using the injected QiniuClient,
 * and removes the intent records from the database.
 */
export async function cleanupOrphanUploads(
  db: DatabaseInstance,
  qiniuClient: QiniuClient,
  now: Date
): Promise<void> {
  logger.info({ now }, "Starting storage orphan cleanup job...");

  // Query pending intents that have expired (expiresAt < now)
  const expiredIntents = await db
    .select()
    .from(upload)
    .where(and(eq(upload.status, "pending"), lt(upload.expiresAt, now)));

  logger.info({ count: expiredIntents.length }, `Found ${expiredIntents.length} expired pending upload intents`);

  for (const intent of expiredIntents) {
    try {
      // Find the policy to look up the bucket
      const policy = getUploadPolicy(intent.capability);

      logger.info({ key: intent.key, bucket: policy.bucket }, "Deleting orphan file from Qiniu Kodo...");
      await qiniuClient.delete(policy.bucket, intent.key);

      logger.info({ key: intent.key }, "Deleting upload intent record from database...");
      await db.delete(upload).where(eq(upload.id, intent.id));

      logger.info({ key: intent.key }, "Orphan file cleanup completed successfully");
    } catch (err) {
      logger.error({ err, intent }, `Failed to clean up orphan upload intent: key=${intent.key}`);
    }
  }

  logger.info("Storage orphan cleanup job completed.");
}
