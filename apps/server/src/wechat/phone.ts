import { WeChatHttpClient } from "./http-client.js";
import { WeChatAccessTokenManager } from "./access-token.js";
import { WeChatApiError } from "./errors.js";
import { logger } from "../logger/index.js";

function maskPhone(phone: string): string {
  if (!phone) return "";
  if (phone.length <= 7) return "****";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export class WeChatPhoneWrapper {
  private client: WeChatHttpClient;
  private tokenManager: WeChatAccessTokenManager;

  constructor(client: WeChatHttpClient, tokenManager: WeChatAccessTokenManager) {
    this.client = client;
    this.tokenManager = tokenManager;
  }

  async getPhoneNumber(code: string): Promise<string> {
    const token = await this.tokenManager.getAccessToken();
    const path = `/wxa/business/getuserphonenumber?access_token=${token}`;

    const res = await this.client.requestApi<{
      errcode?: number;
      errmsg?: string;
      phone_info?: {
        phoneNumber?: string;
        purePhoneNumber?: string;
        countryCode?: string;
      };
    }>(path, {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (res.errcode || !res.phone_info || !res.phone_info.phoneNumber) {
      throw new WeChatApiError(res.errcode || -1, res.errmsg || "Unknown getPhoneNumber error");
    }

    const phone = res.phone_info.phoneNumber;
    logger.info({ maskedPhone: maskPhone(phone) }, "Successfully retrieved user phone number");

    return phone;
  }
}
