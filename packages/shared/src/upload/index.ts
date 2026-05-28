import { z } from "zod";

export const uploadTokenRequestSchema = z.object({
  capability: z.string().min(1, "capability is required"),
  entityId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "entityId must only contain alphanumeric characters, underscores, or dashes")
    .optional()
    .nullable(),
  mimeType: z.string().min(1, "mimeType is required"),
  ext: z
    .string()
    .regex(/^(jpg|jpeg|png|gif|webp)$/i, "ext must be a valid short file extension (jpg, jpeg, png, gif, webp)")
    .transform((val) => val.toLowerCase()),
});

export type UploadTokenRequest = z.infer<typeof uploadTokenRequestSchema>;

export const uploadTokenResponseSchema = z.object({
  token: z.string(),
  key: z.string(),
  upload_host: z.string(),
});

export type UploadTokenResponse = z.infer<typeof uploadTokenResponseSchema>;
