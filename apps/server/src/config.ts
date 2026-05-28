import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env if present
dotenv.config();

const isTest = process.env.NODE_ENV === "test";

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/yikeyue"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().default("test-jwt-secret-key-at-least-32-chars-long"),

  WECHAT_APP_ID: isTest ? z.string().default("mock_app_id") : z.string(),
  WECHAT_APP_SECRET: isTest ? z.string().default("mock_app_secret") : z.string(),
  WECHAT_MCH_ID: isTest ? z.string().default("mock_mch_id") : z.string(),
  WECHAT_API_V3_KEY: isTest ? z.string().default("mock_api_v3_key_32_chars_long_12") : z.string().length(32),
  WECHAT_CERT_SERIAL_NO: isTest ? z.string().default("mock_cert_serial_no") : z.string(),
  WECHAT_PRIVATE_KEY: isTest ? z.string().default("mock_private_key") : z.string(),

  QINIU_ACCESS_KEY: isTest ? z.string().default("mock_qiniu_ak") : z.string(),
  QINIU_SECRET_KEY: isTest ? z.string().default("mock_qiniu_sk") : z.string(),
  QINIU_PUBLIC_BUCKET: z.string().default("yikey-public"),
  QINIU_PRIVATE_BUCKET: z.string().default("yikey-private"),
  QINIU_CDN_DOMAIN: isTest ? z.string().default("http://mock-cdn.yikeyue.com") : z.string(),
  QINIU_PRIVATE_CDN_DOMAIN: isTest ? z.string().default("http://mock-private-cdn.yikeyue.com") : z.string(),
  QINIU_REGION: z.string().default("z0"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Validated configuration instance loaded from process.env.
 * Design Invariant: 9.2 - Loads database and redis connections, jwt secret, and node_env.
 */
export const config = configSchema.parse(process.env);
