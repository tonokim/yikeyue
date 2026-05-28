import pino from "pino";
import { DatabaseInstance } from "./db/index.js";

export interface UserPayload {
  id: string; // user.id or admin_user.id (cuid2)
  uid?: string; // EKY... (optional for admin_user)
  role: string; // super_admin, store_owner, store_staff, consultant, user
  storeId?: string | null;
  typ?: string; // 'admin' | 'weapp'
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
