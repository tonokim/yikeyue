import { createId } from "@paralleldrive/cuid2";

/**
 * Generates a storage key based on capability, entity ID, year-month, and a cuid2.
 * Pattern: <capability>/<entity_id>/<yyyymm>/<cuid2>.<ext>
 */
export function generateStorageKey(
  capability: string,
  entityId: string | null | undefined,
  ext: string
): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const cuid = createId();

  // Normalize extension to remove leading dot
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;

  const entId = entityId && entityId.trim() ? entityId : "temp";

  return `${capability}/${entId}/${yyyymm}/${cuid}.${cleanExt}`;
}
