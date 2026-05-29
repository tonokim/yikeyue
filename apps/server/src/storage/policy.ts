import { config } from "../config.js";

export type StorageCapability = string;

export interface UploadPolicy {
  capability: StorageCapability;
  bucket: string;        // The concrete bucket name (config.QINIU_PUBLIC_BUCKET or config.QINIU_PRIVATE_BUCKET)
  allowedMime: string[]; // e.g. ["image/jpeg", "image/png"]
  maxSizeBytes: number;  // Max size in bytes
}

// Registry mapping capability names to upload policies.
// Initialized with a 'demo' policy for testing and system verification.
export const UPLOAD_POLICIES: Record<string, UploadPolicy> = {
  demo: {
    capability: "demo",
    bucket: config.QINIU_PUBLIC_BUCKET,
    allowedMime: ["image/jpeg", "image/png", "image/gif"],
    maxSizeBytes: 2 * 1024 * 1024, // 2MB
  },
  store: {
    capability: "store",
    bucket: config.QINIU_PUBLIC_BUCKET,
    allowedMime: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
  },
};

/**
 * Gets a registered upload policy for a capability.
 * Throws if the capability is not registered.
 */
export function getUploadPolicy(capability: string): UploadPolicy {
  const policy = UPLOAD_POLICIES[capability];
  if (!policy) {
    throw new Error(`Upload policy for capability '${capability}' is not registered`);
  }
  return policy;
}

/**
 * Registers a new upload policy dynamically.
 */
export function registerUploadPolicy(policy: UploadPolicy): void {
  UPLOAD_POLICIES[policy.capability] = policy;
}
