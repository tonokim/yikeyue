import { createId } from "@paralleldrive/cuid2";

/**
 * Factory patterns skeleton.
 * Design Invariant: 10.6 - Minimal valid set conventions.
 * This change has no business tables, but establishes user/store factory patterns
 * as placeholders and coding conventions for subsequent changes.
 */

export interface TestUserOptions {
  id?: string;
  uid?: string;
  role?: "super_admin" | "store_owner" | "store_staff" | "consultant";
  phone?: string;
}

/**
 * Example User Factory.
 * Builds minimal valid parameters for a user record.
 */
export function buildTestUser(overrides: TestUserOptions = {}) {
  const currentYear = new Date().getFullYear();
  // Standard UID format: EKY + Year + 6 digits
  const random6Digits = Math.floor(100000 + Math.random() * 900000);
  const defaultUid = `EKY${currentYear}${random6Digits}`;

  return {
    id: overrides.id || createId(),
    uid: overrides.uid || defaultUid,
    role: overrides.role || "store_staff",
    phone: overrides.phone || "13800138000",
  };
}
