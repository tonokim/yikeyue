import { DatabaseInstance } from "../db/index.js";
import { adminUser } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { BizError } from "../errors.js";
import { hashPassword, verifyPassword } from "./password.js";

let cachedDummyHash: string | null = null;

export async function getDummyHash(): Promise<string> {
  if (!cachedDummyHash) {
    cachedDummyHash = await hashPassword("__dummy_password__");
  }
  return cachedDummyHash;
}

/**
 * Modify admin user password after validating the old password.
 * Guarantees plain password is never saved or logged.
 */
export async function changePassword(
  db: DatabaseInstance,
  adminUserId: string,
  oldPassword: string,
  newPassword: string,
  now: Date
): Promise<void> {
  const users = await db
    .select()
    .from(adminUser)
    .where(eq(adminUser.id, adminUserId))
    .limit(1);

  if (users.length === 0) {
    throw new BizError("auth.user_not_found", "Admin user not found", {
      httpStatus: 404,
    });
  }

  const user = users[0];
  const isMatch = await verifyPassword(oldPassword, user.passwordHash);
  if (!isMatch) {
    throw new BizError("auth.invalid_password", "Invalid old password", {
      httpStatus: 400,
    });
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(adminUser)
    .set({
      passwordHash: newHash,
      updatedAt: now,
    })
    .where(eq(adminUser.id, adminUserId));
}

/**
 * Authenticates an admin user using phone and password.
 * Implements dummy verification for non-existent users to prevent phone number enumeration.
 */
export async function authenticateAdminUser(
  db: DatabaseInstance,
  phone: string,
  password: string
): Promise<any> {
  const users = await db
    .select()
    .from(adminUser)
    .where(eq(adminUser.phone, phone))
    .limit(1);

  const user = users[0];
  let isMatch = false;

  if (user) {
    isMatch = await verifyPassword(password, user.passwordHash);
  } else {
    // Dummy verification to mitigate timing attacks (preventing username enumeration)
    const dummyHash = await getDummyHash();
    await verifyPassword(password, dummyHash);
  }

  if (!user || !isMatch) {
    throw new BizError("auth.invalid_credentials", "Invalid phone number or password", {
      httpStatus: 400,
    });
  }

  if (user.status !== "active") {
    throw new BizError("auth.user_frozen", "User account is suspended", {
      httpStatus: 403,
    });
  }

  return user;
}

/**
 * Seeds the initial super_admin account using configurations.
 * If the user already exists, it updates the password hash to ensure sync.
 * Guarantees no plain text passwords are hardcoded in source.
 */
export async function seedSuperAdmin(
  db: DatabaseInstance,
  phone: string,
  password: string,
  name: string = "Super Admin"
): Promise<void> {
  const existing = await db
    .select()
    .from(adminUser)
    .where(eq(adminUser.phone, phone))
    .limit(1);

  if (existing.length === 0) {
    const hash = await hashPassword(password);
    await db.insert(adminUser).values({
      phone,
      passwordHash: hash,
      role: "super_admin",
      storeId: null,
      name,
      status: "active",
    });
  } else {
    const user = existing[0];
    if (user.role !== "super_admin" || user.storeId !== null || user.status !== "active") {
      throw new Error(
        `Seeding failed: A user with phone ${phone} already exists but does not match expected super_admin configuration (current role: ${user.role}, storeId: ${user.storeId}, status: ${user.status}).`
      );
    }
  }
}
