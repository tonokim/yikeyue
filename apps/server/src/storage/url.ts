import { config } from "../config.js";
import crypto from "crypto";
import { urlsafeBase64Encode } from "./client.js";

/**
 * Generates the public CDN URL for a file in the public bucket.
 */
export function getPublicUrl(key: string): string {
  const domain = config.QINIU_CDN_DOMAIN.endsWith("/")
    ? config.QINIU_CDN_DOMAIN.slice(0, -1)
    : config.QINIU_CDN_DOMAIN;
  return `${domain}/${key}`;
}

/**
 * Generates a short-lived private download URL for a file in the private bucket.
 * Uses HMAC-SHA1 to sign the URL including the deadline parameter 'e'.
 */
export function privateDownloadUrl(
  key: string,
  expiresInSeconds = 300,
  accessKey = config.QINIU_ACCESS_KEY,
  secretKey = config.QINIU_SECRET_KEY
): string {
  const domain = config.QINIU_PRIVATE_CDN_DOMAIN.endsWith("/")
    ? config.QINIU_PRIVATE_CDN_DOMAIN.slice(0, -1)
    : config.QINIU_PRIVATE_CDN_DOMAIN;
  const baseUrl = `${domain}/${key}`;

  const deadline = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const urlWithE = `${baseUrl}?e=${deadline}`;

  const hmac = crypto.createHmac("sha1", secretKey);
  hmac.update(urlWithE);
  const sign = hmac.digest();
  const encodedSign = urlsafeBase64Encode(sign);

  const token = `${accessKey}:${encodedSign}`;
  return `${urlWithE}&token=${token}`;
}
