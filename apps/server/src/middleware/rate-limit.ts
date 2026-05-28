import { createMiddleware } from "hono/factory";
import { Redis } from "ioredis";
import { AppEnv } from "../types.js";
import { BizError } from "../errors.js";
import { ERROR_CODES } from "@yikey/shared";

export interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
}

/**
 * Rate Limiting Middleware.
 * Design Invariant: 7.7, D11 - Redis-based sliding/fixed window counter.
 * Identity prioritized by c.var.user.id, falls back to IP address.
 * Throws 429 rate_limit.exceeded with 'Retry-After' header on limit breach.
 * Opt-in per route, excluded from /health.
 */
export function createRateLimitMiddleware(redis: Redis, options: RateLimitOptions) {
  const { windowSeconds, maxRequests } = options;

  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown-ip";
    
    // Identity resolution: ctx.user priority, IP fallback
    const identity = user ? `usr:${user.id}` : `ip:${ip}`;
    const endpoint = c.req.path;
    const redisKey = `ratelimit:${endpoint}:${identity}`;

    try {
      const current = await redis.incr(redisKey);
      
      // If it's a new window, set the TTL
      if (current === 1) {
        await redis.expire(redisKey, windowSeconds);
      }

      // Check current TTL to calculate retry-after duration
      const ttl = await redis.ttl(redisKey);
      const retryAfter = ttl > 0 ? ttl : windowSeconds;

      if (current > maxRequests) {
        c.header("Retry-After", retryAfter.toString());
        throw new BizError(ERROR_CODES.RATE_LIMIT_EXCEEDED, "Rate limit exceeded. Please try again later.", {
          httpStatus: 429,
        });
      }
    } catch (err) {
      if (err instanceof BizError) {
        throw err;
      }
      // If Redis fails, log a warning and let the request proceed (soft-fail)
      const log = c.var.log;
      if (log) {
        log.warn({ err }, "Redis error encountered in rate limiter middleware");
      }
    }

    await next();
  });
}
