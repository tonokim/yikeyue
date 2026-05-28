import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a Drizzle database client instance, injecting either a pool or a single client connection.
 * Design invariant: D2 - No global singletons, instances are constructed per request context.
 */
export function createDb(connectionOrPool: pg.Pool | pg.Client | pg.PoolClient): DatabaseInstance {
  return drizzle(connectionOrPool, { schema });
}
