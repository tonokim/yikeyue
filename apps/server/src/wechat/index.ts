import { RedisClient } from "../redis.js";
import { WeChatHttpClient, WeChatClientOptions } from "./http-client.js";
import { WeChatAccessTokenManager } from "./access-token.js";
import { WeChatLoginWrapper } from "./login.js";
import { WeChatPhoneWrapper } from "./phone.js";
import { WeChatSubscribeWrapper } from "./subscribe.js";
import { WeChatPayWrapper } from "./pay.js";

export class WeChatService {
  public redis: RedisClient;
  public client: WeChatHttpClient;
  public tokenManager: WeChatAccessTokenManager;
  public login: WeChatLoginWrapper;
  public phone: WeChatPhoneWrapper;
  public subscribe: WeChatSubscribeWrapper;
  public pay: WeChatPayWrapper;

  constructor(redis: RedisClient, options?: WeChatClientOptions) {
    this.redis = redis;
    this.client = new WeChatHttpClient(options);
    this.tokenManager = new WeChatAccessTokenManager(redis, this.client);
    this.login = new WeChatLoginWrapper(this.client);
    this.phone = new WeChatPhoneWrapper(this.client, this.tokenManager);
    this.subscribe = new WeChatSubscribeWrapper(this.client, this.tokenManager);
    this.pay = new WeChatPayWrapper(this.client);
  }
}

let wechatInstance: WeChatService | null = null;

export function getWeChatService(): WeChatService {
  if (!wechatInstance) {
    throw new Error("WeChatService has not been initialized. Call initWeChatService() first.");
  }
  return wechatInstance;
}

export function initWeChatService(redis: RedisClient, options?: WeChatClientOptions): WeChatService {
  wechatInstance = new WeChatService(redis, options);
  return wechatInstance;
}

export function setWeChatService(service: WeChatService) {
  wechatInstance = service;
}
export * from "./errors.js";
export * from "./http-client.js";
export * from "./access-token.js";
export * from "./login.js";
export * from "./phone.js";
export * from "./subscribe.js";
export * from "./templates.js";
export * from "./pay.js";
