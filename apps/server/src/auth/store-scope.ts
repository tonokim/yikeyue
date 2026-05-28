import { and, eq } from "drizzle-orm";

/**
 * withStore helper to automatically scope queries for store roles.
 * Appends 'storeId = user.storeId' to the query's where condition
 * if the user has a store-level role (store_owner or store_staff).
 * Preserves any existing where conditions.
 */
export function withStore<T extends { where: any; config: any }>(
  ctx: any,
  query: T,
  table: { storeId: any }
): T {
  const user = ctx.var.user;
  if (!user) {
    return query;
  }

  if (user.role === "store_owner" || user.role === "store_staff") {
    if (user.storeId) {
      const existingWhere = query.config?.where;
      if (existingWhere) {
        return query.where(and(existingWhere, eq(table.storeId, user.storeId)));
      } else {
        return query.where(eq(table.storeId, user.storeId));
      }
    }
  }

  return query;
}
