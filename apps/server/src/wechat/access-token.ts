import crypto from "crypto";
import { RedisClient } from "../redis.js";
import { WeChatHttpClient } from "./http-client.js";
import { config } from "../config.js";
import { logger } from "../logger/index.js";

export class WeChatAccessTokenManager {
  private redis: RedisClient;
  private client: WeChatHttpClient;
  private appId: string;
  private appSecret: string;
  private cacheKey = "wechat:access_token";
  private lockKey = "wechat:access_token:lock";

  // Expose lock TTL to allow test overrides (defaults to 10 seconds)
  public lockTtl = 10;

  constructor(
    redis: RedisClient,
    client: WeChatHttpClient,
    appId = config.WECHAT_APP_ID,
    appSecret = config.WECHAT_APP_SECRET
  ) {
    this.redis = redis;
    this.client = client;
    this.appId = appId;
    this.appSecret = appSecret;
  }

  async getAccessToken(): Promise<string> {
    const cached = await this.redis.get(this.cacheKey);
    if (cached) {
      return cached;
    }

    const ownerToken = crypto.randomUUID();

    // Try to acquire lock to fetch
    const lockAcquired = await this.redis.set(this.lockKey, ownerToken, "EX", this.lockTtl, "NX");
    if (lockAcquired === "OK") {
      try {
        const token = await this.refreshAccessToken();
        return token;
      } finally {
        await this.releaseLock(ownerToken);
      }
    }

    // Lock is held, poll until the token is refreshed
    const maxAttempts = Math.ceil((this.lockTtl + 1) * 10);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const val = await this.redis.get(this.cacheKey);
      if (val) {
        return val;
      }

      // If lock has expired and still no token, try to acquire lock again
      const newOwnerToken = crypto.randomUUID();
      const lockAcquiredAgain = await this.redis.set(this.lockKey, newOwnerToken, "EX", this.lockTtl, "NX");
      if (lockAcquiredAgain === "OK") {
        try {
          const token = await this.refreshAccessToken();
          return token;
        } finally {
          await this.releaseLock(newOwnerToken);
        }
      }
    }

    throw new Error("Timeout waiting for WeChat access_token refresh");
  }

  private async releaseLock(ownerToken: string): Promise<void> {
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(releaseScript, 1, this.lockKey, ownerToken);
    } catch (err) {
      logger.error({ err }, "Failed to release WeChat access_token lock via Lua");
    }
  }

  private async refreshAccessToken(): Promise<string> {
    const path = `/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;

    // Set request timeout to be strictly less than the lock TTL (e.g., lockTtl - 2, minimum 1 second)
    const timeoutMs = Math.max((this.lockTtl - 2) * 1000, 1000);
    const signal = AbortSignal.timeout(timeoutMs);

    const res = await this.client.requestApi<{
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    }>(path, { signal });

    if (res.errcode || !res.access_token) {
      throw new Error(`WeChat access_token fetch failed: errcode=${res.errcode}, errmsg=${res.errmsg}`);
    }

    // Cache in Redis. TTL = expires_in - buffer (buffer = 300 seconds)
    const buffer = 300;
    const ttl = Math.max((res.expires_in || 7200) - buffer, 60);

    await this.redis.set(this.cacheKey, res.access_token, "EX", ttl);
    logger.info("Successfully refreshed WeChat access_token");
    return res.access_token;
  }
}
