import pino from "pino";
import { DatabaseInstance } from "./db/index.js";

export interface UserPayload {
  id: string; // user.id (cuid2)
  uid: string; // EKY...
  role: string; // super_admin, store_owner, store_staff, consultant
  storeId?: string | null;
}

/**
 * AppContextVariables is the shape of Hono request-level variables c.var.
 * Design invariant: 6.1 - now, requestId, log, user, db
 */
export interface AppContextVariables {
  now: Date;
  requestId: string;
  log: pino.Logger;
  user: UserPayload | null;
  db: DatabaseInstance;
}

export interface AppEnv {
  Variables: AppContextVariables;
}
