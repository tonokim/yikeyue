import { WeChatHttpClient } from "./http-client.js";
import { WeChatAccessTokenManager } from "./access-token.js";
import { WeChatApiError } from "./errors.js";
import { logger } from "../logger/index.js";
import { getTemplateConfig } from "./templates.js";
import { enqueue } from "../queue/scheduler.js";
import { getWeChatService } from "./index.js";

export interface SendSubscribeMessageParams {
  touser: string;
  templateId: string;
  page?: string;
  data: Record<string, { value: any }>;
  miniprogramState?: "developer" | "trial" | "formal";
  lang?: string;
}

export class WeChatSubscribeWrapper {
  private client: WeChatHttpClient;
  private tokenManager: WeChatAccessTokenManager;

  constructor(client: WeChatHttpClient, tokenManager: WeChatAccessTokenManager) {
    this.client = client;
    this.tokenManager = tokenManager;
  }

  async sendSubscribeMessage(params: SendSubscribeMessageParams): Promise<void> {
    const token = await this.tokenManager.getAccessToken();
    const path = `/cgi-bin/message/subscribe/send?access_token=${token}`;

    const res = await this.client.requestApi<{
      errcode?: number;
      errmsg?: string;
    }>(path, {
      method: "POST",
      body: JSON.stringify({
        touser: params.touser,
        template_id: params.templateId,
        page: params.page,
        data: params.data,
        miniprogram_state: params.miniprogramState,
        lang: params.lang,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (res.errcode) {
      throw new WeChatApiError(res.errcode, res.errmsg || "Failed to send subscribe message");
    }

    logger.info({ openid: params.touser, templateId: params.templateId }, "Successfully sent WeChat subscribe message");
  }
}

export const notify = {
  async send(event: string, user: string, data: Record<string, any>): Promise<boolean> {
    // 1. Validate template registration
    getTemplateConfig(event);

    const service = getWeChatService();
    const redis = service.redis;

    // 2. 5min deduplication in Redis (with optional business suffixes)
    let suffix = "";
    if (data.storeId) {
      suffix = `:${data.storeId}`;
    } else if (data.dedupSuffix) {
      suffix = `:${data.dedupSuffix}`;
    }
    const dedupKey = `notify:dedup:${event}:${user}${suffix}`;
    const acquired = await redis.set(dedupKey, "1", "EX", 300, "NX");
    if (acquired !== "OK") {
      logger.info({ event, openid: user, suffix }, "Duplicate notification skipped (deduplicated)");
      return false; // deduplicated, skipped
    }

    try {
      // 3. Enqueue to notify:wechat-subscribe
      await enqueue("notify:wechat-subscribe", {
        event,
        touser: user,
        data,
      }, {
        retryCategory: "external-api",
      });
    } catch (err) {
      await redis.del(dedupKey).catch((delErr) => {
        logger.error({ err: delErr }, "Failed to delete dedup key on enqueue failure");
      });
      throw err;
    }

    logger.info({ event, openid: user }, "Notification enqueued successfully");
    return true; // enqueued successfully
  }
};
