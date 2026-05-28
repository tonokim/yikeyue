import { z } from "zod";

/**
 * Zod schema for Admin login request.
 */
export const adminLoginRequestSchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(1, "Password is required"),
});

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

/**
 * Zod schema for Admin login response.
 * Transforms internal camelCase keys to snake_case at boundary.
 */
export const adminLoginResponseSchema = z
  .object({
    token: z.string(),
    role: z.string(),
    storeId: z.string().nullable().optional(),
  })
  .transform((val) => ({
    token: val.token,
    role: val.role,
    store_id: val.storeId ?? undefined,
  }));

export type AdminLoginResponse = z.output<typeof adminLoginResponseSchema>;

/**
 * Zod schema for admin password change request.
 * Transforms incoming snake_case parameters to camelCase for server use.
 */
export const changePasswordRequestSchema = z
  .object({
    old_password: z.string().min(1, "old_password is required"),
    new_password: z.string().min(6, "new_password must be at least 6 characters"),
  })
  .transform((val) => ({
    oldPassword: val.old_password,
    newPassword: val.new_password,
  }));

export type ChangePasswordRequest = z.output<typeof changePasswordRequestSchema>;

/**
 * Zod schema for user details returned by UID search under store-admin.
 */
export const adminUserQueryResponseSchema = z.object({
  uid: z.string(),
  nickname: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  status: z.string(),
});

export type AdminUserQueryResponse = z.infer<typeof adminUserQueryResponseSchema>;
