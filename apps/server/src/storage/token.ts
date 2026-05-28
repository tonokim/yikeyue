import crypto from "crypto";
import { config } from "../config.js";
import { urlsafeBase64Encode } from "./client.js";

export interface UploadTokenOptions {
  bucket: string;
  key: string;
  expiresInSeconds?: number; // Must be <= 300 (5 minutes)
  fsizeLimit?: number;
  mimeLimit?: string[]; // e.g. ["image/jpeg", "image/png"]
}

/**
 * Generates a scoped upload token for client-side direct upload to Qiniu.
 * Ensures the token is restricted by scope (bucket:key), size, mime types, and short deadline.
 */
export function generateUploadToken(
  options: UploadTokenOptions,
  accessKey = config.QINIU_ACCESS_KEY,
  secretKey = config.QINIU_SECRET_KEY
): string {
  const ttl = options.expiresInSeconds !== undefined ? options.expiresInSeconds : 300;
  if (ttl > 300) {
    throw new Error("Upload token deadline cannot exceed 5 minutes (300 seconds)");
  }

  const deadline = Math.floor(Date.now() / 1000) + ttl;

  const policy: Record<string, any> = {
    scope: `${options.bucket}:${options.key}`,
    deadline,
  };

  if (options.fsizeLimit !== undefined) {
    policy.fsizeLimit = options.fsizeLimit;
  }

  if (options.mimeLimit && options.mimeLimit.length > 0) {
    policy.mimeLimit = options.mimeLimit.join(";");
  }

  const policyStr = JSON.stringify(policy);
  const encodedPolicy = urlsafeBase64Encode(policyStr);

  const hmac = crypto.createHmac("sha1", secretKey);
  hmac.update(encodedPolicy);
  const sign = hmac.digest();
  const encodedSign = urlsafeBase64Encode(sign);

  return `${accessKey}:${encodedSign}:${encodedPolicy}`;
}
