import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env if present
dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/yikeyue"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().default("test-jwt-secret-key-at-least-32-chars-long"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Validated configuration instance loaded from process.env.
 * Design Invariant: 9.2 - Loads database and redis connections, jwt secret, and node_env.
 */
export const config = configSchema.parse(process.env);
