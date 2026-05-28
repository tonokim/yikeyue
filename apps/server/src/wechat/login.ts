import { WeChatHttpClient } from "./http-client.js";
import { config } from "../config.js";
import { WeChatApiError } from "./errors.js";

export interface Code2SessionResult {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

export class WeChatLoginWrapper {
  private client: WeChatHttpClient;
  private appId: string;
  private appSecret: string;

  constructor(
    client: WeChatHttpClient,
    appId = config.WECHAT_APP_ID,
    appSecret = config.WECHAT_APP_SECRET
  ) {
    this.client = client;
    this.appId = appId;
    this.appSecret = appSecret;
  }

  async code2Session(code: string): Promise<Code2SessionResult> {
    const path = `/sns/jscode2session?appid=${this.appId}&secret=${this.appSecret}&js_code=${code}&grant_type=authorization_code`;
    const res = await this.client.requestApi<{
      openid?: string;
      session_key?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    }>(path);

    if (res.errcode || !res.openid || !res.session_key) {
      throw new WeChatApiError(res.errcode || -1, res.errmsg || "Unknown login error");
    }

    return {
      openid: res.openid,
      sessionKey: res.session_key,
      unionid: res.unionid,
    };
  }
}
