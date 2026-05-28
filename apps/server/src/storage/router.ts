import { Hono } from "hono";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { requireAuth } from "../middleware/jwt.js";
import { uploadTokenRequestSchema } from "@yikey/shared";
import { getUploadPolicy } from "./policy.js";
import { generateStorageKey } from "./key.js";
import { generateUploadToken } from "./token.js";
import { upload } from "../db/schema.js";
import { config } from "../config.js";

function getUploadHost(region: string): string {
  const regionMap: Record<string, string> = {
    z0: "https://upload.qiniup.com",
    z1: "https://upload-z1.qiniup.com",
    z2: "https://upload-z2.qiniup.com",
    na0: "https://upload-na0.qiniup.com",
    as0: "https://upload-as0.qiniup.com",
  };
  return regionMap[region] || "https://upload.qiniup.com";
}

export function createStorageRouter() {
  const router = new Hono<AppEnv>();

  router.post("/token", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));

    // Validate request using shared Zod schema
    const parseResult = uploadTokenRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BizError("validation.invalid_input", "Invalid upload token request payload", {
        httpStatus: 400,
        details: parseResult.error.format(),
      });
    }

    const { capability, entityId, mimeType, ext } = parseResult.data;

    // Retrieve upload policy
    let policy;
    try {
      policy = getUploadPolicy(capability);
    } catch {
      throw new BizError("storage.capability_not_registered", `Upload capability '${capability}' is not registered`, {
        httpStatus: 400,
      });
    }

    // Validate MIME type against policy
    const isAllowedMime = policy.allowedMime.includes(mimeType);
    if (!isAllowedMime) {
      throw new BizError(
        "storage.mime_type_not_allowed",
        `MIME type '${mimeType}' is not allowed for capability '${capability}'`,
        { httpStatus: 400 }
      );
    }

    // Generate unique storage key
    const key = generateStorageKey(capability, entityId, ext);

    // Save pending upload intent record
    const db = c.var.db;
    const expiresAt = new Date(c.var.now.getTime() + 24 * 60 * 60 * 1000); // 24h expiration

    await db.insert(upload).values({
      status: "pending",
      key,
      capability,
      entityId: entityId || null,
      expiresAt,
    });

    // Generate scoped upload token
    const token = generateUploadToken({
      bucket: policy.bucket,
      key,
      expiresInSeconds: 300, // 5 min deadline
      fsizeLimit: policy.maxSizeBytes,
      mimeLimit: policy.allowedMime,
    });

    // Determine upload host
    const isTest = process.env.NODE_ENV === "test";
    const uploadHost = isTest ? "http://mock-upload.qiniup.com" : getUploadHost(config.QINIU_REGION);

    return c.json({
      token,
      key,
      upload_host: uploadHost,
    });
  });

  return router;
}
