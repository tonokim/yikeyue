import { z } from "zod";

/**
 * UID validation regular expression.
 * Pattern: EKY + YYYY + at least 6-digit sequence.
 */
export const UID_REGEXP = /^EKY\d{4}\d{6,}$/;

/**
 * Zod schema for validating user UIDs.
 */
export const uidValidationSchema = z
  .string()
  .regex(UID_REGEXP, "UID must be in format EKY + YYYY + at least 6 digits");

/**
 * Schema for WeChat login request.
 */
export const loginRequestSchema = z.object({
  code: z.string().min(1, "code is required"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Schema for user profile details returned in login and me responses.
 */
export const userProfileSchema = z.object({
  uid: z.string(),
  nickname: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  status: z.string(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

/**
 * Schema for login response at boundary (transforms internal camelCase representation to snake_case).
 */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: userProfileSchema,
}).transform((val) => ({
  access_token: val.accessToken,
  user: val.user,
}));

export type LoginResponse = z.output<typeof loginResponseSchema>;

/**
 * Schema for /me response.
 */
export const meResponseSchema = userProfileSchema;

export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * Schema for profile update request.
 */
export const updateProfileRequestSchema = z.object({
  nickname: z.string().min(1, "nickname cannot be empty").optional().nullable(),
  avatar: z.string().url("avatar must be a valid URL").optional().nullable(),
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
